function extensionFromMimeType(mimeType = '') {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return '';
}

function extensionFromAudioBuffer(audioBuffer) {
  if (!audioBuffer || audioBuffer.length < 12) return 'webm';

  // RIFF....WAVE
  if (
    audioBuffer[0] === 0x52 && audioBuffer[1] === 0x49 && audioBuffer[2] === 0x46 && audioBuffer[3] === 0x46
  ) {
    return 'wav';
  }

  // OggS
  if (
    audioBuffer[0] === 0x4f && audioBuffer[1] === 0x67 && audioBuffer[2] === 0x67 && audioBuffer[3] === 0x53
  ) {
    return 'ogg';
  }

  // ID3 (mp3)
  if (
    audioBuffer[0] === 0x49 && audioBuffer[1] === 0x44 && audioBuffer[2] === 0x33
  ) {
    return 'mp3';
  }

  // EBML/WebM header
  if (
    audioBuffer[0] === 0x1a && audioBuffer[1] === 0x45 && audioBuffer[2] === 0xdf && audioBuffer[3] === 0xa3
  ) {
    return 'webm';
  }

  // ISO BMFF (mp4/m4a): bytes 4..7 = 'ftyp'
  if (
    audioBuffer[4] === 0x66 && audioBuffer[5] === 0x74 && audioBuffer[6] === 0x79 && audioBuffer[7] === 0x70
  ) {
    return 'm4a';
  }

  return 'webm';
}

function mimeTypeFromExtension(ext) {
  if (ext === 'm4a') return 'audio/mp4';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'wav') return 'audio/wav';
  return 'audio/webm';
}

export async function handleTranscribeRequest(req, res) {
  const { audioBase64, mimeType } = req.body || {};

  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'Request must include audioBase64.' });
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(audioBase64, 'base64');
  } catch {
    return res.status(400).json({ error: 'Invalid audio payload.' });
  }

  if (!audioBuffer || audioBuffer.length === 0) {
    return res.status(400).json({ error: 'Audio payload is empty.' });
  }

  if (audioBuffer.length > 10 * 1024 * 1024) {
    return res.status(413).json({ error: 'Audio is too large. Keep clips under 10MB.' });
  }

  const ext = extensionFromMimeType(mimeType) || extensionFromAudioBuffer(audioBuffer);
  const fileName = `voice-input.${ext}`;
  const effectiveMimeType = mimeType || mimeTypeFromExtension(ext);

  try {
    const candidateModels = [
      'whisper-1',
      process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    ];

    let lastStatus = null;
    let lastStatusText = '';
    let lastErrorBody = '';

    for (const model of candidateModels) {
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: effectiveMimeType });
      form.append('file', blob, fileName);
      form.append('model', model);

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: form,
      });

      if (response.ok) {
        const data = await response.json();
        const text = (data.text || '').trim();
        return res.status(200).json({ text });
      }

      const errorBody = await response.text().catch(() => '');
      lastStatus = response.status;
      lastStatusText = response.statusText;
      lastErrorBody = errorBody;

      // Fall through for model/media compatibility-style failures.
      const isCompatibilityFailure = [400, 404, 415, 422].includes(response.status);
      if (!isCompatibilityFailure) {
        break;
      }
    }

    console.error(`OpenAI transcription error: ${lastStatus} ${lastStatusText}`, lastErrorBody);
    const statusCode = Number.isInteger(lastStatus) ? lastStatus : 'unknown';
    return res.status(502).json({
      error: 'Transcription service returned an error.',
      code: `openai_${statusCode}_${ext}`,
    });
  } catch {
    return res.status(502).json({ error: 'Transcription service is unavailable.', code: 'openai_unreachable' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return handleTranscribeRequest(req, res);
}
