import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble.jsx';
import TypingIndicator from './TypingIndicator.jsx';
import SuggestedQuestions from './SuggestedQuestions.jsx';
import { getSpeechRecognitionCtor, isSpeechRecognitionSupported } from '../utils/speech.js';
import { sendTranscription } from '../utils/api.js';
import { trackTelemetry } from '../utils/telemetry.js';

export default function ChatWindow({ messages, isLoading, error, remaining, onSend }) {
  const [input, setInput] = useState('');
  const [isVoiceListening, setIsVoiceListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceInfo, setVoiceInfo] = useState('');
  const [isVoiceRecordingFallback, setIsVoiceRecordingFallback] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const previewTranscriptionInFlightRef = useRef(false);
  const previewTranscriptionLastAtRef = useRef(0);
  const inputBeforeVoiceRef = useRef('');
  const finalTranscriptRef = useRef('');
  const livePreviewRecognitionRef = useRef(null);
  const livePreviewFinalTranscriptRef = useRef('');
  const livePreviewHasResultsRef = useRef(false);
  const forceProgressivePreviewRef = useRef(false);
  const audioContextRef = useRef(null);
  const silenceIntervalRef = useRef(null);
  const silenceMsRef = useRef(0);
  const hasDetectedSpeechRef = useRef(false);
  const autoStopTimeoutRef = useRef(null);
  const autoStopReasonRef = useRef('unknown');
  const voiceSessionStartAtRef = useRef(0);
  const firstTextLoggedRef = useRef(false);
  const sessionModeRef = useRef('');
  const progressiveErrorLoggedRef = useRef(false);
  const recorderSupported = Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  const speechSupported = isSpeechRecognitionSupported();
  const voiceSupported = recorderSupported || speechSupported;
  const isElectronBrowser = /Electron/i.test(navigator.userAgent || '');
  const MAX_RECORDING_MS = 45000;

  function growTextarea(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }

  function resetTextarea() {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
    }
  }

  function classifyTranscriptionError(errorMessage = '') {
    const msg = errorMessage.toLowerCase();
    if (msg.includes('connection failed')) return 'network';
    if (msg.includes('not running in this dev server')) return 'missing_endpoint';
    if (msg.includes('too large')) return 'payload_too_large';
    if (msg.includes('unexpected transcription response')) return 'bad_response';
    if (msg.includes('transcription service')) return 'service_error';
    return 'unknown';
  }

  function startVoiceSession(mode) {
    sessionModeRef.current = mode;
    voiceSessionStartAtRef.current = Date.now();
    firstTextLoggedRef.current = false;
    progressiveErrorLoggedRef.current = false;
    trackTelemetry('voice_start', { mode, forced_progressive: forceProgressivePreviewRef.current });
  }

  function trackFirstText(source) {
    if (firstTextLoggedRef.current || !voiceSessionStartAtRef.current) return;
    firstTextLoggedRef.current = true;
    trackTelemetry('voice_first_text', {
      mode: sessionModeRef.current,
      source,
      first_text_ms: Date.now() - voiceSessionStartAtRef.current,
    });
  }

  function getRecorderOptions() {
    const preferredTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported?.(type)) {
        return { mimeType: type, audioBitsPerSecond: 32000 };
      }
    }
    return { audioBitsPerSecond: 32000 };
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      livePreviewRecognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null; }
      if (autoStopTimeoutRef.current) { clearTimeout(autoStopTimeoutRef.current); autoStopTimeoutRef.current = null; }
      audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  function stopLivePreviewRecognition() {
    livePreviewRecognitionRef.current?.stop();
    livePreviewRecognitionRef.current = null;
    livePreviewFinalTranscriptRef.current = '';
    livePreviewHasResultsRef.current = false;
  }

  function stopAutoStopWatchers() {
    if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null; }
    if (autoStopTimeoutRef.current) { clearTimeout(autoStopTimeoutRef.current); autoStopTimeoutRef.current = null; }
    silenceMsRef.current = 0;
    hasDetectedSpeechRef.current = false;
    audioContextRef.current?.close();
    audioContextRef.current = null;
  }

  function beginAutoStopWatchers(stream, recorder) {
    stopAutoStopWatchers();
    autoStopTimeoutRef.current = setTimeout(() => {
      if (recorder.state === 'recording') { autoStopReasonRef.current = 'max_duration'; recorder.stop(); }
    }, MAX_RECORDING_MS);

    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    try {
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 2048;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      audioContextRef.current = audioContext;
      const data = new Uint8Array(analyser.fftSize);
      const SILENCE_THRESHOLD = 0.02;
      const SILENCE_MS_TO_STOP = 1800;
      const CHECK_INTERVAL_MS = 200;
      silenceIntervalRef.current = setInterval(() => {
        if (recorder.state !== 'recording') return;
        analyser.getByteTimeDomainData(data);
        let sumSquares = 0;
        for (let i = 0; i < data.length; i += 1) { const n = (data[i] - 128) / 128; sumSquares += n * n; }
        const rms = Math.sqrt(sumSquares / data.length);
        if (rms > SILENCE_THRESHOLD) { hasDetectedSpeechRef.current = true; silenceMsRef.current = 0; return; }
        if (!hasDetectedSpeechRef.current) return;
        silenceMsRef.current += CHECK_INTERVAL_MS;
        if (silenceMsRef.current >= SILENCE_MS_TO_STOP) { autoStopReasonRef.current = 'silence'; recorder.stop(); }
      }, CHECK_INTERVAL_MS);
    } catch { /* silence detection unavailable, max-duration still protects */ }
  }

  async function updateProgressiveTranscript() {
    if (speechSupported && livePreviewHasResultsRef.current) return;
    if (previewTranscriptionInFlightRef.current) return;
    const now = Date.now();
    if (now - previewTranscriptionLastAtRef.current < 1400) return;
    const chunks = recordedChunksRef.current;
    if (!chunks.length) return;
    const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
    const audioBlob = new Blob(chunks, { type: mimeType });
    if (audioBlob.size < 2500) return;
    previewTranscriptionInFlightRef.current = true;
    previewTranscriptionLastAtRef.current = now;
    try {
      const transcript = (await sendTranscription(audioBlob)).trim();
      if (!transcript) return;
      const baseText = inputBeforeVoiceRef.current;
      setInput(baseText ? `${baseText} ${transcript}` : transcript);
      growTextarea(inputRef.current);
      trackFirstText('progressive_transcription');
    } catch {
      if (!progressiveErrorLoggedRef.current) {
        progressiveErrorLoggedRef.current = true;
        trackTelemetry('voice_transcribe_error', { mode: sessionModeRef.current, stage: 'progressive', code: 'progressive_failed' });
      }
    } finally {
      previewTranscriptionInFlightRef.current = false;
    }
  }

  function startLivePreviewRecognition() {
    if (!speechSupported || forceProgressivePreviewRef.current) return;
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return;
    try {
      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = true;
      recognition.continuous = true;
      recognition.maxAlternatives = 1;
      livePreviewFinalTranscriptRef.current = '';
      livePreviewHasResultsRef.current = false;
      recognition.onresult = (event) => {
        livePreviewHasResultsRef.current = true;
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) { livePreviewFinalTranscriptRef.current += `${text} `; } else { interim += text; }
        }
        const spoken = `${livePreviewFinalTranscriptRef.current}${interim}`.trim();
        const base = inputBeforeVoiceRef.current;
        setInput(spoken ? (base ? `${base} ${spoken}` : spoken) : base);
        growTextarea(inputRef.current);
        trackFirstText('browser_live_preview');
      };
      recognition.onerror = () => {
        forceProgressivePreviewRef.current = true;
        trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'speech_error' });
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      recognition.onend = () => {
        if (!livePreviewHasResultsRef.current) {
          forceProgressivePreviewRef.current = true;
          trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'no_results' });
        }
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      livePreviewRecognitionRef.current = recognition;
      recognition.start();
    } catch { livePreviewRecognitionRef.current = null; }
  }

  async function startRecorderTranscription() {
    if (!recorderSupported) { setVoiceError('Voice recording is not available in this browser.'); return false; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, getRecorderOptions());
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recordedChunksRef.current = [];
      previewTranscriptionInFlightRef.current = false;
      previewTranscriptionLastAtRef.current = 0;
      autoStopReasonRef.current = 'manual';
      setVoiceInfo('');
      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) { recordedChunksRef.current.push(event.data); await updateProgressiveTranscript(); }
      };
      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        const mimeType = recorder.mimeType || 'audio/webm';
        const stopReason = autoStopReasonRef.current || 'unknown';
        stopLivePreviewRecognition();
        stopAutoStopWatchers();
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsVoiceListening(false);
        setIsVoiceRecordingFallback(false);
        trackTelemetry('voice_auto_stop', { mode: sessionModeRef.current, reason: stopReason });
        if (stopReason === 'max_duration') {
          setVoiceInfo('Recording auto-stopped at 45 seconds. For best accuracy, speak in shorter clips.');
        }
        if (!chunks.length) { setVoiceError('No speech detected. Try again and speak clearly.'); return; }
        try {
          const audioBlob = new Blob(chunks, { type: mimeType });
          const transcript = (await sendTranscription(audioBlob)).trim();
          if (!transcript) { setVoiceError('No speech detected. Try again and speak clearly.'); return; }
          const baseText = inputBeforeVoiceRef.current;
          const nextValue = baseText ? `${baseText} ${transcript}` : transcript;
          setInput(nextValue);
          growTextarea(inputRef.current);
          trackFirstText('final_transcription');
          trackTelemetry('voice_final_transcript', {
            mode: sessionModeRef.current,
            final_transcript_ms: Date.now() - voiceSessionStartAtRef.current,
            text_chars: transcript.length,
          });
          setVoiceError('');
          inputRef.current?.focus();
        } catch (err) {
          trackTelemetry('voice_transcribe_error', { mode: sessionModeRef.current, stage: 'final', code: classifyTranscriptionError(err?.message || '') });
          setVoiceError(err.message || 'Audio transcription failed. Please try again.');
        }
      };
      recorder.onerror = () => {
        stopLivePreviewRecognition();
        stopAutoStopWatchers();
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setIsVoiceListening(false);
        setIsVoiceRecordingFallback(false);
        setVoiceError('Audio recording failed. Please try again.');
      };
      recorder.start(900);
      startVoiceSession('recorder');
      startLivePreviewRecognition();
      beginAutoStopWatchers(stream, recorder);
      setIsVoiceListening(true);
      setIsVoiceRecordingFallback(true);
      return true;
    } catch { setVoiceError('Unable to access microphone for voice recording.'); return false; }
  }

  function startSpeechRecognitionFallback() {
    stopLivePreviewRecognition();
    if (!speechSupported) return false;
    const SpeechRecognitionCtor = getSpeechRecognitionCtor();
    if (!SpeechRecognitionCtor) return false;
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    finalTranscriptRef.current = '';
    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) { finalTranscriptRef.current += `${text} `; } else { interim += text; }
      }
      const spoken = `${finalTranscriptRef.current}${interim}`.trim();
      const base = inputBeforeVoiceRef.current;
      setInput(spoken ? (base ? `${base} ${spoken}` : spoken) : base);
      growTextarea(inputRef.current);
      trackFirstText('speech_fallback');
    };
    recognition.onstart = () => { startVoiceSession('speech_fallback'); setIsVoiceListening(true); setIsVoiceRecordingFallback(false); };
    recognition.onend = () => { setIsVoiceListening(false); recognitionRef.current = null; inputRef.current?.focus(); };
    recognition.onerror = (event) => {
      setIsVoiceListening(false);
      recognitionRef.current = null;
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed') { setVoiceError('Microphone access was denied by the browser or OS. Check site and system microphone settings.'); return; }
      if (event.error === 'audio-capture') { setVoiceError('No microphone was detected on this device.'); return; }
      if (event.error === 'no-speech') { setVoiceError('No speech detected. Try again and speak clearly.'); return; }
      if (event.error === 'network') {
        if (!navigator.onLine) { setVoiceError('You appear to be offline. Reconnect to the internet and try voice input again.'); return; }
        if (isElectronBrowser) { setVoiceError('Speech recognition network service is unavailable in the VS Code embedded browser. Open this app in Chrome or Edge and try again.'); return; }
        setVoiceError('Speech recognition service is unreachable. Try disabling VPN/ad blocker/firewall, then retry.');
        return;
      }
      if (event.error === 'aborted') return;
      setVoiceError('Voice input could not start in this browser session.');
    };
    try { recognitionRef.current = recognition; recognition.start(); return true; }
    catch { recognitionRef.current = null; setIsVoiceListening(false); return false; }
  }

  function handleChange(e) {
    setInput(e.target.value);
    growTextarea(e.target);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      onSend(input.trim());
      setInput('');
      resetTextarea();
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    resetTextarea();
  }

  function handleSuggestion(question) {
    onSend(question);
  }

  async function handleVoiceToggle() {
    if (isLoading || !voiceSupported) return;
    if (isVoiceListening) {
      if (isVoiceRecordingFallback && mediaRecorderRef.current?.state === 'recording') {
        autoStopReasonRef.current = 'manual';
        mediaRecorderRef.current.stop();
        return;
      }
      recognitionRef.current?.stop();
      setIsVoiceListening(false);
      return;
    }
    setVoiceError('');
    setVoiceInfo('');
    inputBeforeVoiceRef.current = input.trim();
    const recorderStarted = await startRecorderTranscription();
    if (recorderStarted) return;
    const speechStarted = startSpeechRecognitionFallback();
    if (speechStarted) return;
    if (!recorderSupported && !speechSupported) { setVoiceError('Voice input is not supported in this browser.'); return; }
    setVoiceError('Voice input failed to start. Check microphone permissions and try again.');
  }

  return (
    <div className="chat-window">
      <div className="chat-messages">
        {messages.length === 0 && !isLoading && (
          <div className="chat-empty">
            <p className="chat-welcome">
              Ask me anything about PNW tennis league regulations.
            </p>
            <SuggestedQuestions onSelect={handleSuggestion} />
          </div>
        )}

        {messages.map((msg, i) => (
          <MessageBubble
            key={i}
            role={msg.role}
            content={msg.content}
            query={msg.role === 'assistant' && i > 0 ? messages[i - 1].content : undefined}
          />
        ))}

        {isLoading && <TypingIndicator />}

        {error && (
          <div className="chat-error">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <form className="chat-input-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask a question about the rules..."
          disabled={isLoading}
          aria-label="Ask a question"
          rows={1}
        />
        <button
          type="button"
          className={`chat-voice ${isVoiceListening ? 'chat-voice-listening' : ''}`}
          onClick={handleVoiceToggle}
          disabled={isLoading || !voiceSupported}
          aria-label={isVoiceListening ? 'Stop voice input' : 'Start voice input'}
          aria-pressed={isVoiceListening}
          title={
            !voiceSupported
              ? 'Voice input is not supported in this browser'
              : isVoiceListening
                ? (isVoiceRecordingFallback ? 'Recording voice...' : 'Listening...')
                : 'Start voice input'
          }
        >
          <svg
            className="chat-voice-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 11a7 7 0 0 1-14 0" />
            <path d="M12 18v4" />
            <path d="M8 22h8" />
          </svg>
        </button>
        <button
          type="submit"
          className="chat-send"
          disabled={isLoading || !input.trim()}
          aria-label="Send"
        >
          ➤
        </button>
      </form>

      {!voiceSupported && (
        <div className="chat-voice-note" role="status" aria-live="polite">
          Voice input is not supported in this browser.
        </div>
      )}

      {voiceSupported && isVoiceListening && (
        <div className="chat-voice-note" role="status" aria-live="polite">
          {isVoiceRecordingFallback
            ? 'Recording voice... auto-stop after a pause or at 45 seconds.'
            : 'Listening... speak now.'}
        </div>
      )}

      {voiceInfo && (
        <div className="chat-voice-note" role="status" aria-live="polite">
          {voiceInfo}
        </div>
      )}

      {voiceError && (
        <div className="chat-voice-error" role="alert">
          {voiceError}
        </div>
      )}

      {remaining !== null && (
        <div className="chat-remaining">
          {50 - remaining} of 50 questions used today
        </div>
      )}
    </div>
  );
}
