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
  const [isVoiceFinalizing, setIsVoiceFinalizing] = useState(false);
  const [hasVoiceDraft, setHasVoiceDraft] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const [voiceInfo, setVoiceInfo] = useState('');
  const [isVoiceRecordingFallback, setIsVoiceRecordingFallback] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messagesEndRef = useRef(null);
  const messageAnchorRefs = useRef(new Map());
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const inputBeforeVoiceRef = useRef('');
  const finalTranscriptRef = useRef('');
  const livePreviewRecognitionRef = useRef(null);
  const livePreviewStartupTimeoutRef = useRef(null);
  const livePreviewFinalTranscriptRef = useRef('');
  const livePreviewHasResultsRef = useRef(false);
  const audioContextRef = useRef(null);
  const silenceIntervalRef = useRef(null);
  const silenceMsRef = useRef(0);
  const hasDetectedSpeechRef = useRef(false);
  const autoStopTimeoutRef = useRef(null);
  const autoStopReasonRef = useRef('unknown');
  const voiceSessionStartAtRef = useRef(0);
  const firstTextLoggedRef = useRef(false);
  const sessionModeRef = useRef('');
  const suppressVoicePopulateRef = useRef(false);
  const growRafRef = useRef(null);
  const lastMessageCountRef = useRef(messages.length);
  const shouldFollowOutputRef = useRef(true);
  const latestAssistantIndexRef = useRef(-1);
  const recorderSupported = Boolean(navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined');
  const speechSupported = isSpeechRecognitionSupported();
  const voiceSupported = recorderSupported || speechSupported;
  const isElectronBrowser = /Electron/i.test(navigator.userAgent || '');
  const MAX_RECORDING_MS = 45000;
  const AUTO_SCROLL_THRESHOLD_PX = 140;
  const RECORDER_TIMESLICE_MS = 450;
  const AUDIO_BITRATE = 24000;
  const INPUT_MAX_HEIGHT_PX = 220;

  function isNearBottom() {
    const doc = document.documentElement;
    const gap = doc.scrollHeight - (window.scrollY + window.innerHeight);
    return gap <= AUTO_SCROLL_THRESHOLD_PX;
  }

  function scrollToBottom(behavior = 'smooth') {
    messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
  }

  function scrollToAssistantStart(index, behavior = 'smooth') {
    const anchor = messageAnchorRefs.current.get(index);
    if (anchor) {
      anchor.scrollIntoView({ behavior, block: 'start' });
      return;
    }
    scrollToBottom(behavior);
  }

  function growTextarea(el) {
    if (!el) return;
    const computedMaxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight);
    const effectiveMaxHeight = Number.isFinite(computedMaxHeight) ? computedMaxHeight : INPUT_MAX_HEIGHT_PX;
    el.style.height = 'auto';
    const nextHeight = Math.min(el.scrollHeight, effectiveMaxHeight);
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > effectiveMaxHeight ? 'auto' : 'hidden';
  }

  function resetTextarea() {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.overflowY = 'hidden';
    }
  }

  function queueGrowTextarea() {
    if (!inputRef.current) return;
    if (growRafRef.current) cancelAnimationFrame(growRafRef.current);
    growRafRef.current = requestAnimationFrame(() => {
      growTextarea(inputRef.current);
      growRafRef.current = null;
    });
  }

  useEffect(() => {
    queueGrowTextarea();
  }, [input]);

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
    suppressVoicePopulateRef.current = false;
    setIsVoiceFinalizing(false);
    setHasVoiceDraft(false);
    sessionModeRef.current = mode;
    voiceSessionStartAtRef.current = Date.now();
    firstTextLoggedRef.current = false;
    trackTelemetry('voice_start', { mode });
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
        return { mimeType: type, audioBitsPerSecond: AUDIO_BITRATE };
      }
    }
    return { audioBitsPerSecond: AUDIO_BITRATE };
  }

  useEffect(() => {
    const onScroll = () => {
      const nearBottom = isNearBottom();
      shouldFollowOutputRef.current = nearBottom;
      if (nearBottom) setShowJumpToLatest(false);
    };

    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const nextCount = messages.length;
    const prevCount = lastMessageCountRef.current;
    if (nextCount <= prevCount) {
      lastMessageCountRef.current = nextCount;
      return;
    }

    const latestIndex = nextCount - 1;
    const latestMessage = messages[latestIndex];
    if (!latestMessage) {
      lastMessageCountRef.current = nextCount;
      return;
    }

    if (latestMessage.role === 'assistant') {
      latestAssistantIndexRef.current = latestIndex;
      if (shouldFollowOutputRef.current) {
        setShowJumpToLatest(false);
        scrollToAssistantStart(latestIndex, 'smooth');
      } else {
        setShowJumpToLatest(true);
      }
    } else if (shouldFollowOutputRef.current) {
      scrollToBottom('smooth');
    }

    lastMessageCountRef.current = nextCount;
  }, [messages]);

  useEffect(() => {
    if (!isLoading || !shouldFollowOutputRef.current) return;
    scrollToBottom('smooth');
  }, [isLoading]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
      livePreviewRecognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      if (silenceIntervalRef.current) { clearInterval(silenceIntervalRef.current); silenceIntervalRef.current = null; }
      if (autoStopTimeoutRef.current) { clearTimeout(autoStopTimeoutRef.current); autoStopTimeoutRef.current = null; }
      if (livePreviewStartupTimeoutRef.current) { clearTimeout(livePreviewStartupTimeoutRef.current); livePreviewStartupTimeoutRef.current = null; }
      if (growRafRef.current) { cancelAnimationFrame(growRafRef.current); growRafRef.current = null; }
      audioContextRef.current?.close();
      audioContextRef.current = null;
    };
  }, []);

  function stopLivePreviewRecognition() {
    if (livePreviewStartupTimeoutRef.current) { clearTimeout(livePreviewStartupTimeoutRef.current); livePreviewStartupTimeoutRef.current = null; }
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

  function startLivePreviewRecognition() {
    if (!speechSupported) return;
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
        if (suppressVoicePopulateRef.current) return;
        livePreviewHasResultsRef.current = true;
        if (livePreviewStartupTimeoutRef.current) { clearTimeout(livePreviewStartupTimeoutRef.current); livePreviewStartupTimeoutRef.current = null; }
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i += 1) {
          const text = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) { livePreviewFinalTranscriptRef.current += `${text} `; } else { interim += text; }
        }
        const spoken = `${livePreviewFinalTranscriptRef.current}${interim}`.trim();
        const base = inputBeforeVoiceRef.current;
        setInput(spoken ? (base ? `${base} ${spoken}` : spoken) : base);
        setHasVoiceDraft(true);
        queueGrowTextarea();
        trackFirstText('browser_live_preview');
      };
      recognition.onerror = () => {
        trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'speech_error' });
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      recognition.onend = () => {
        if (livePreviewStartupTimeoutRef.current) { clearTimeout(livePreviewStartupTimeoutRef.current); livePreviewStartupTimeoutRef.current = null; }
        if (!livePreviewHasResultsRef.current) {
          trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'no_results' });
        }
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      livePreviewRecognitionRef.current = recognition;
      recognition.start();
      // Some browsers report support but delay interim events. Fall back quickly so text appears while speaking.
      livePreviewStartupTimeoutRef.current = setTimeout(() => {
        if (livePreviewHasResultsRef.current || suppressVoicePopulateRef.current) return;
        trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'startup_timeout' });
      }, 1200);
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
      autoStopReasonRef.current = 'manual';
      setVoiceInfo('');
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
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
        if (stopReason === 'submitted' || suppressVoicePopulateRef.current) {
          setIsVoiceFinalizing(false);
          setHasVoiceDraft(false);
          return;
        }
        if (stopReason === 'max_duration') {
          setVoiceInfo('Recording auto-stopped at 45 seconds. For best accuracy, speak in shorter clips.');
        }
        if (!chunks.length) { setIsVoiceFinalizing(false); setVoiceError('No speech detected. Try again and speak clearly.'); return; }
        setIsVoiceFinalizing(true);
        try {
          const audioBlob = new Blob(chunks, { type: mimeType });
          const transcript = (await sendTranscription(audioBlob)).trim();
          if (suppressVoicePopulateRef.current) return;
          if (!transcript) { setVoiceError('No speech detected. Try again and speak clearly.'); return; }
          const baseText = inputBeforeVoiceRef.current;
          const nextValue = baseText ? `${baseText} ${transcript}` : transcript;
          setInput(nextValue);
          setHasVoiceDraft(false);
          queueGrowTextarea();
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
        } finally {
          setIsVoiceFinalizing(false);
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
        setIsVoiceFinalizing(false);
        setVoiceError('Audio recording failed. Please try again.');
      };
      recorder.start(RECORDER_TIMESLICE_MS);
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
      if (suppressVoicePopulateRef.current) return;
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = event.results[i][0]?.transcript || '';
        if (event.results[i].isFinal) { finalTranscriptRef.current += `${text} `; } else { interim += text; }
      }
      const spoken = `${finalTranscriptRef.current}${interim}`.trim();
      const base = inputBeforeVoiceRef.current;
      setInput(spoken ? (base ? `${base} ${spoken}` : spoken) : base);
      setHasVoiceDraft(true);
      queueGrowTextarea();
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

  function cancelVoiceInputForSend() {
    suppressVoicePopulateRef.current = true;
    setIsVoiceFinalizing(false);
    setHasVoiceDraft(false);
    inputBeforeVoiceRef.current = '';
    livePreviewFinalTranscriptRef.current = '';
    finalTranscriptRef.current = '';
    if (isVoiceRecordingFallback && mediaRecorderRef.current?.state === 'recording') {
      autoStopReasonRef.current = 'submitted';
      mediaRecorderRef.current.stop();
    }
    recognitionRef.current?.stop();
    stopLivePreviewRecognition();
    setIsVoiceListening(false);
    setIsVoiceRecordingFallback(false);
  }

  function handleChange(e) {
    setInput(e.target.value);
    queueGrowTextarea();
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!input.trim() || isLoading) return;
      const outbound = input.trim();
      cancelVoiceInputForSend();
      setInput('');
      resetTextarea();
      onSend(outbound);
    }
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const outbound = input.trim();
    cancelVoiceInputForSend();
    setInput('');
    resetTextarea();
    onSend(outbound);
  }

  function handleSuggestion(question) {
    onSend(question);
  }

  function handleJumpToLatest() {
    if (latestAssistantIndexRef.current >= 0) {
      scrollToAssistantStart(latestAssistantIndexRef.current, 'smooth');
    } else {
      scrollToBottom('smooth');
    }
    setShowJumpToLatest(false);
    shouldFollowOutputRef.current = true;
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
      setIsVoiceFinalizing(false);
      setIsVoiceListening(false);
      return;
    }
    suppressVoicePopulateRef.current = false;
    setVoiceError('');
    setVoiceInfo('');
    inputBeforeVoiceRef.current = input.trim();
    const speechStarted = startSpeechRecognitionFallback();
    if (speechStarted) return;
    const recorderStarted = await startRecorderTranscription();
    if (recorderStarted) return;
    if (!recorderSupported && !speechSupported) { setVoiceError('Voice input is not supported in this browser.'); return; }
    setVoiceError('Voice input failed to start. Check microphone permissions and try again.');
  }

  const voiceStatus = voiceError
    ? { type: 'error', text: voiceError }
    : isVoiceFinalizing
      ? { type: 'note', text: 'Finalizing transcript...' }
    : voiceInfo
      ? { type: 'note', text: voiceInfo }
      : (!voiceSupported
        ? { type: 'note', text: 'Voice input is not supported in this browser.' }
        : (isVoiceListening
          ? {
            type: 'note',
            text: hasVoiceDraft
              ? 'Listening... draft transcript appears live.'
              : isVoiceRecordingFallback
                ? 'Recording voice... draft text appears as you speak.'
              : 'Listening... speak now.',
          }
          : null));

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
          <div
            key={i}
            ref={(node) => {
              if (node) messageAnchorRefs.current.set(i, node);
              else messageAnchorRefs.current.delete(i);
            }}
          >
            <MessageBubble
              role={msg.role}
              content={msg.content}
              query={msg.role === 'assistant' && i > 0 ? messages[i - 1].content : undefined}
            />
          </div>
        ))}

        {isLoading && <TypingIndicator />}

        {error && (
          <div className="chat-error">{error}</div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {showJumpToLatest && (
        <button
          type="button"
          className="chat-jump-latest"
          onClick={handleJumpToLatest}
          aria-label="Jump to latest response"
        >
          Jump to latest response
        </button>
      )}

      <div className="chat-status-slot" aria-live="polite">
        {voiceStatus && (
          <div className={voiceStatus.type === 'error' ? 'chat-voice-error' : 'chat-voice-note'} role={voiceStatus.type === 'error' ? 'alert' : 'status'}>
            {voiceStatus.text}
          </div>
        )}
      </div>

      <form className={`chat-input-form ${(isVoiceListening || isVoiceFinalizing) ? 'chat-input-form-voice-active' : ''}`} onSubmit={handleSubmit}>
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

      {remaining !== null && (
        <div className="chat-remaining">
          {50 - remaining} of 50 questions used today
        </div>
      )}
    </div>
  );
}
