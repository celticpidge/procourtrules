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
  const [voiceRearmAt, setVoiceRearmAt] = useState(0);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);
  const messagesEndRef = useRef(null);
  const messageAnchorRefs = useRef(new Map());
  const inputRef = useRef(null);
  const recognitionRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const recorderMimeTypeRef = useRef('');
  const inputBeforeVoiceRef = useRef('');
  const finalTranscriptRef = useRef('');
  const livePreviewRecognitionRef = useRef(null);
  const livePreviewStartupTimeoutRef = useRef(null);
  const livePreviewFinalTranscriptRef = useRef('');
  const livePreviewHasResultsRef = useRef(false);
  const progressivePreviewEnabledRef = useRef(false);
  const previewTranscriptionInFlightRef = useRef(false);
  const previewTranscriptionLastAtRef = useRef(0);
  const progressiveErrorLoggedRef = useRef(false);
  const audioContextRef = useRef(null);
  const silenceIntervalRef = useRef(null);
  const silenceMsRef = useRef(0);
  const hasDetectedSpeechRef = useRef(false);
  const autoStopTimeoutRef = useRef(null);
  const autoStopReasonRef = useRef('unknown');
  const voiceRearmTimeoutRef = useRef(null);
  const voiceRearmFailureCountRef = useRef(0);
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
  const IOS_RECORDER_TIMESLICE_MS = 1000;
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
    clearVoiceRearmGate();
    progressivePreviewEnabledRef.current = false;
    previewTranscriptionInFlightRef.current = false;
    previewTranscriptionLastAtRef.current = 0;
    progressiveErrorLoggedRef.current = false;
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
    const ua = navigator.userAgent || '';
    const isIOSLike = /iPhone|iPad|iPod/i.test(ua)
      || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
    const preferredTypes = isIOSLike
      ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (const type of preferredTypes) {
      if (MediaRecorder.isTypeSupported?.(type)) {
        return { mimeType: type, audioBitsPerSecond: AUDIO_BITRATE };
      }
    }
    return { audioBitsPerSecond: AUDIO_BITRATE };
  }

  function isIOSLikeBrowser() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  }

  function resolveRecordingMimeType(recorder, chunks) {
    const firstChunkWithType = chunks?.find((chunk) => chunk?.type);
    return firstChunkWithType?.type || recorder?.mimeType || recorderMimeTypeRef.current || '';
  }

  function supportsProgressivePreviewForMimeType() {
    // With a recorder timeslice, MediaRecorder emits fragmented MP4 where the
    // first chunk carries the init segment, so the accumulated blob (always
    // built from chunk 0) is a decodable fMP4 stream. Progressive uploads of
    // these growing blobs are therefore supported across containers, including
    // iOS/WebKit, enabling near real-time previews.
    return true;
  }

  function looksLikeTranscriptionHallucination(text) {
    // Transcription models invent repeated characters/words when given a short,
    // near-silent clip (e.g. the instant right after the mic is tapped). Suppress
    // those so the live preview doesn't flash garbage before real speech arrives.
    const trimmed = (text || '').trim();
    if (!trimmed) return true;
    const compact = trimmed.replace(/[^\p{L}\p{N}]/gu, '');
    if (compact.length < 2) return true; // mostly punctuation/symbols
    if (/^(.)\1+$/u.test(compact)) return true; // a single character repeated
    // Non-speech sounds (sighs, breaths) make the model emit non-Latin scripts
    // such as CJK characters. We only support English, so treat those as noise.
    if (/[^\p{Script=Latin}\p{N}\p{P}\p{Z}\p{M}]/u.test(trimmed)) return true;
    const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
    if (words.length >= 3 && new Set(words).size === 1) return true; // "you you you"
    // Known phantom phrases the model emits for silence/breath. Match only when
    // the whole transcript is one of these (so real questions are untouched).
    const PHANTOM_PHRASES = new Set([
      'you', 'thank you', 'thank you.', 'thanks', 'thanks for watching',
      'thanks for watching.', 'bye', 'bye.', 'bye bye', 'bye-bye', 'bye bye.',
      'ok bye bye', 'ok bye bye.', 'okay', 'ok', 'ok.', 'okay.', 'so', 'um',
      'uh', 'hmm', 'mm', 'mhm', 'yeah', 'oh', 'please subscribe', 'subscribe',
    ]);
    const normalized = trimmed.toLowerCase().replace(/[.,!?…\s]+/g, ' ').trim();
    if (PHANTOM_PHRASES.has(normalized)) return true;
    return false;
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
      if (voiceRearmTimeoutRef.current) { clearTimeout(voiceRearmTimeoutRef.current); voiceRearmTimeoutRef.current = null; }
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

  function clearVoiceRearmGate() {
    if (voiceRearmTimeoutRef.current) {
      clearTimeout(voiceRearmTimeoutRef.current);
      voiceRearmTimeoutRef.current = null;
    }
    setVoiceRearmAt(0);
  }

  function scheduleVoiceRearmGate(reason = 'success') {
    if (!isIOSLikeBrowser()) return;

    const baseDelays = {
      success: 1200,
      submitted: 1200,
      manual: 1200,
      silence: 1500,
      no_speech: 1200,
      recording_failed: 4000,
      no_results: 2800,
      startup_timeout: 2200,
    };

    // A no-speech result (a sigh, breath, or silence) isn't a real failure and
    // the UI invites the user to tap again immediately, so don't escalate the
    // re-arm delay for it the way we do for genuine recording/start failures.
    const isSoftReason = reason === 'success' || reason === 'no_speech' || reason === 'silence';
    const baseDelay = baseDelays[reason] ?? 1800;
    const failureBonus = isSoftReason
      ? 0
      : Math.min(voiceRearmFailureCountRef.current * 750, 3500);

    if (isSoftReason) {
      voiceRearmFailureCountRef.current = 0;
    } else {
      voiceRearmFailureCountRef.current += 1;
    }

    const delay = baseDelay + failureBonus;
    clearVoiceRearmGate();
    setVoiceRearmAt(Date.now() + delay);
    voiceRearmTimeoutRef.current = setTimeout(() => {
      voiceRearmTimeoutRef.current = null;
      setVoiceRearmAt(0);
    }, delay);
  }

  function releaseVoiceSessionResources() {
    stopLivePreviewRecognition();
    stopAutoStopWatchers();
    if (mediaRecorderRef.current?.state === 'recording') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // Ignore stop failures during cleanup.
      }
    }
    mediaRecorderRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
    mediaStreamRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsVoiceListening(false);
    setIsVoiceRecordingFallback(false);
  }

  function flushAndStopRecorder(reason = 'manual') {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;
    autoStopReasonRef.current = reason;
    try { recorder.requestData?.(); } catch { /* best-effort flush for WebKit */ }
    recorder.stop();
  }

  function beginAutoStopWatchers(stream, recorder) {
    stopAutoStopWatchers();
    autoStopTimeoutRef.current = setTimeout(() => {
      if (recorder.state === 'recording') flushAndStopRecorder('max_duration');
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
      const SILENCE_MS_TO_STOP = 1000;
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
        if (silenceMsRef.current >= SILENCE_MS_TO_STOP) flushAndStopRecorder('silence');
      }, CHECK_INTERVAL_MS);
    } catch { /* silence detection unavailable, max-duration still protects */ }
  }

  function startLivePreviewRecognition() {
    if (isIOSLikeBrowser()) return;
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
        const mimeType = resolveRecordingMimeType(mediaRecorderRef.current, recordedChunksRef.current);
        progressivePreviewEnabledRef.current = supportsProgressivePreviewForMimeType(mimeType);
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      recognition.onend = () => {
        if (livePreviewStartupTimeoutRef.current) { clearTimeout(livePreviewStartupTimeoutRef.current); livePreviewStartupTimeoutRef.current = null; }
        if (!livePreviewHasResultsRef.current) {
          trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'no_results' });
          const mimeType = resolveRecordingMimeType(mediaRecorderRef.current, recordedChunksRef.current);
          progressivePreviewEnabledRef.current = supportsProgressivePreviewForMimeType(mimeType);
        }
        if (livePreviewRecognitionRef.current === recognition) livePreviewRecognitionRef.current = null;
      };
      livePreviewRecognitionRef.current = recognition;
      recognition.start();
      // Some browsers report support but delay interim events. Fall back quickly so text appears while speaking.
      livePreviewStartupTimeoutRef.current = setTimeout(() => {
        if (livePreviewHasResultsRef.current || suppressVoicePopulateRef.current) return;
        trackTelemetry('voice_live_preview_failed', { mode: sessionModeRef.current, reason: 'startup_timeout' });
        const mimeType = resolveRecordingMimeType(mediaRecorderRef.current, recordedChunksRef.current);
        progressivePreviewEnabledRef.current = supportsProgressivePreviewForMimeType(mimeType);
      }, 1200);
    } catch { livePreviewRecognitionRef.current = null; }
  }

  async function updateProgressiveTranscript() {
    if (!progressivePreviewEnabledRef.current) return;
    if (suppressVoicePopulateRef.current) return;
    if (previewTranscriptionInFlightRef.current) return;
    // Don't transcribe until the silence analyser has actually detected speech.
    // Sighs/breaths stay below the threshold, so this keeps the model from
    // hallucinating phantom words on non-speech audio.
    if (!hasDetectedSpeechRef.current) return;

    const now = Date.now();
    if (now - previewTranscriptionLastAtRef.current < 1200) return;

    const chunks = recordedChunksRef.current;
    if (!chunks.length) return;

    const mimeType = resolveRecordingMimeType(mediaRecorderRef.current, chunks);
    const audioBlob = new Blob(chunks, { type: mimeType });
    // Wait for ~2s of audio (≈6KB at 24kbps) before the first preview so we
    // don't transcribe the near-silent moment right after the mic is tapped,
    // which is what makes the model hallucinate repeated characters.
    if (audioBlob.size < 6000) return;

    previewTranscriptionInFlightRef.current = true;
    previewTranscriptionLastAtRef.current = now;

    try {
      const transcript = (await sendTranscription(audioBlob)).trim();
      if (!transcript || suppressVoicePopulateRef.current) return;
      if (looksLikeTranscriptionHallucination(transcript)) return;
      const baseText = inputBeforeVoiceRef.current;
      const nextValue = baseText ? `${baseText} ${transcript}` : transcript;
      setInput(nextValue);
      setHasVoiceDraft(true);
      queueGrowTextarea();
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

  async function startRecorderTranscription() {
    if (!recorderSupported) { setVoiceError('Voice recording is not available in this browser.'); return false; }
    let stream = null;
    try {
      releaseVoiceSessionResources();
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorderOptions = getRecorderOptions();
      const requestedMimeType = recorderOptions?.mimeType || '';
      const recorder = new MediaRecorder(stream, recorderOptions);
      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorderMimeTypeRef.current = recorder.mimeType || requestedMimeType || '';
      recordedChunksRef.current = [];
      autoStopReasonRef.current = 'manual';
      setVoiceInfo('');
      recorder.ondataavailable = async (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
          await updateProgressiveTranscript();
        }
      };
      recorder.onstop = async () => {
        const chunks = recordedChunksRef.current;
        const mimeType = resolveRecordingMimeType(recorder, chunks);
        const stopReason = autoStopReasonRef.current || 'unknown';
        const totalBytes = chunks.reduce((sum, chunk) => sum + (chunk?.size || 0), 0);
        // Diagnostic snapshot to disambiguate empty-recording vs empty-transcript failures.
        const recordingDiagnostics = {
          mode: sessionModeRef.current,
          stop_reason: stopReason,
          chunk_count: chunks.length,
          total_bytes: totalBytes,
          mime_type: mimeType || 'unknown',
          ios_like: isIOSLikeBrowser(),
          session_ms: voiceSessionStartAtRef.current ? Date.now() - voiceSessionStartAtRef.current : 0,
        };
        console.info('[voice] recorder stopped', recordingDiagnostics);
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
          scheduleVoiceRearmGate('submitted');
          return;
        }
        if (stopReason === 'max_duration') {
          setVoiceInfo('Recording auto-stopped at 45 seconds. For best accuracy, speak in shorter clips.');
        }
        if (!chunks.length) {
          setIsVoiceFinalizing(false);
          console.warn('[voice] no audio captured (empty recording)', recordingDiagnostics);
          trackTelemetry('voice_no_speech', { ...recordingDiagnostics, reason: 'empty_recording' });
          setVoiceInfo('Didn’t catch that. Tap the mic and try again.');
          scheduleVoiceRearmGate('no_speech');
          return;
        }
        setIsVoiceFinalizing(true);
        try {
          const audioBlob = new Blob(chunks, { type: mimeType });
          const transcript = (await sendTranscription(audioBlob)).trim();
          if (suppressVoicePopulateRef.current) return;
          if (!transcript || looksLikeTranscriptionHallucination(transcript)) {
            console.warn('[voice] audio sent but transcript was empty', { ...recordingDiagnostics, blob_bytes: audioBlob.size });
            trackTelemetry('voice_no_speech', { ...recordingDiagnostics, blob_bytes: audioBlob.size, reason: 'empty_transcript' });
            setVoiceInfo('Didn’t catch that. Tap the mic and try again.');
            scheduleVoiceRearmGate('no_speech');
            return;
          }
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
          scheduleVoiceRearmGate('success');
          inputRef.current?.focus();
        } catch (err) {
          trackTelemetry('voice_transcribe_error', { mode: sessionModeRef.current, stage: 'final', code: classifyTranscriptionError(err?.message || '') });
          setVoiceError(err.message || 'Audio transcription failed. Please try again.');
          scheduleVoiceRearmGate('recording_failed');
        } finally {
          setIsVoiceFinalizing(false);
        }
      };
      recorder.onerror = () => {
        releaseVoiceSessionResources();
        setIsVoiceFinalizing(false);
        setVoiceError('Audio recording failed. Please try again.');
        scheduleVoiceRearmGate('recording_failed');
      };
      // iOS WebKit only emits a final blob on stop() when started with no
      // timeslice, and that early-stop emit is frequently empty for mp4/AAC.
      // Passing a timeslice forces periodic dataavailable events so chunks
      // accumulate; the final blob is rebuilt from all chunks. The same
      // fragmented-mp4 chunks also power near real-time progressive previews.
      const recorderTimeslice = isIOSLikeBrowser() ? IOS_RECORDER_TIMESLICE_MS : RECORDER_TIMESLICE_MS;
      recorder.start(recorderTimeslice);
      startVoiceSession('recorder');
      // Browser speech preview is unavailable on iOS (mic conflicts with the
      // recorder), so drive live updates from recorder chunks instead.
      if (!speechSupported || isIOSLikeBrowser()) {
        const initialMimeType = recorder.mimeType || recorderMimeTypeRef.current || '';
        progressivePreviewEnabledRef.current = supportsProgressivePreviewForMimeType(initialMimeType);
      }
      startLivePreviewRecognition();
      beginAutoStopWatchers(stream, recorder);
      setIsVoiceListening(true);
      setIsVoiceRecordingFallback(true);
      return true;
    } catch {
      stream?.getTracks().forEach((track) => track.stop());
      setVoiceError('Unable to access microphone for voice recording.');
      return false;
    }
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
        if (isElectronBrowser) {
          setVoiceInfo('Voice input is limited in the VS Code embedded browser. Open this app in Chrome or Edge for best results.');
          return;
        }
        setVoiceInfo('Voice input is temporarily unavailable. Please try again.');
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
      flushAndStopRecorder('submitted');
    }
    releaseVoiceSessionResources();
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
    if (voiceRearmAt && Date.now() < voiceRearmAt) return;
    if (isVoiceListening) {
      if (isVoiceRecordingFallback && mediaRecorderRef.current?.state === 'recording') {
        flushAndStopRecorder('manual');
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
    const recorderStarted = await startRecorderTranscription();
    if (recorderStarted) return;
    const speechStarted = startSpeechRecognitionFallback();
    if (speechStarted) return;
    if (!recorderSupported && !speechSupported) { setVoiceError('Voice input is not supported in this browser.'); return; }
    setVoiceError('Voice input failed to start. Check microphone permissions and try again.');
  }

  const voiceStatus = voiceError
    ? { type: 'error', text: voiceError }
    : isVoiceFinalizing
      ? { type: 'note', text: 'Finalizing transcript...' }
    : voiceInfo
      ? { type: 'note', text: voiceInfo }
      : (voiceRearmAt && Date.now() < voiceRearmAt)
        ? { type: 'note', text: 'Mic is rearming. Please wait a moment before speaking again.' }
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
            className="message-anchor"
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

      <div className="chat-footer">
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
          className={`chat-voice ${isVoiceListening ? 'chat-voice-listening' : ''} ${(voiceRearmAt && Date.now() < voiceRearmAt) ? 'chat-voice-rearming' : ''}`}
          onClick={handleVoiceToggle}
          disabled={isLoading || !voiceSupported || isVoiceFinalizing || (voiceRearmAt && Date.now() < voiceRearmAt)}
          aria-label={isVoiceListening ? 'Stop voice input' : 'Start voice input'}
          aria-pressed={isVoiceListening}
          title={
            !voiceSupported
              ? 'Voice input is not supported in this browser'
              : (voiceRearmAt && Date.now() < voiceRearmAt)
                ? 'Mic is rearming. Please wait a moment.'
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
    </div>
  );
}
