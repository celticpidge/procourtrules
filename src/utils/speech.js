export function getSpeechRecognitionCtor(win = typeof window !== 'undefined' ? window : null) {
  if (!win) return null;
  return win.SpeechRecognition || win.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(win = typeof window !== 'undefined' ? window : null) {
  return Boolean(getSpeechRecognitionCtor(win));
}