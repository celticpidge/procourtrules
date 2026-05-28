import { describe, it, expect } from 'vitest';
import { getSpeechRecognitionCtor, isSpeechRecognitionSupported } from './speech.js';

describe('getSpeechRecognitionCtor', () => {
  it('returns SpeechRecognition constructor when available', () => {
    function SpeechRecognitionCtor() {}
    const mockWindow = { SpeechRecognition: SpeechRecognitionCtor };
    expect(getSpeechRecognitionCtor(mockWindow)).toBe(SpeechRecognitionCtor);
  });

  it('returns webkitSpeechRecognition constructor when available', () => {
    function WebkitCtor() {}
    const mockWindow = { webkitSpeechRecognition: WebkitCtor };
    expect(getSpeechRecognitionCtor(mockWindow)).toBe(WebkitCtor);
  });

  it('returns null when constructors are unavailable', () => {
    expect(getSpeechRecognitionCtor({})).toBe(null);
  });
});

describe('isSpeechRecognitionSupported', () => {
  it('returns true when SpeechRecognition exists', () => {
    const mockWindow = { SpeechRecognition: function Mock() {} };
    expect(isSpeechRecognitionSupported(mockWindow)).toBe(true);
  });

  it('returns true when webkitSpeechRecognition exists', () => {
    const mockWindow = { webkitSpeechRecognition: function Mock() {} };
    expect(isSpeechRecognitionSupported(mockWindow)).toBe(true);
  });

  it('returns false when neither API exists', () => {
    const mockWindow = {};
    expect(isSpeechRecognitionSupported(mockWindow)).toBe(false);
  });

  it('returns false when window is unavailable', () => {
    expect(isSpeechRecognitionSupported(null)).toBe(false);
  });
});