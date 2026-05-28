function extensionFromMimeType(mimeType = '') {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'webm';
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

  const ext = extensionFromMimeType(mimeType);
  const fileName = `voice-input.${ext}`;

  try {
    const candidateModels = [
      process.env.TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
      'whisper-1',
    ];

    let lastStatus = null;
    let lastStatusText = '';
    let lastErrorBody = '';

    for (const model of candidateModels) {
      const form = new FormData();
      const blob = new Blob([audioBuffer], { type: mimeType || 'audio/webm' });
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

      // Only fall through to the next model for compatibility-style failures.
      const isCompatibilityFailure = response.status === 400 || response.status === 404;
      if (!isCompatibilityFailure) {
        break;
      }
    }

    console.error(`OpenAI transcription error: ${lastStatus} ${lastStatusText}`, lastErrorBody);
    return res.status(502).json({ error: 'Transcription service returned an error.' });
  } catch {
    return res.status(502).json({ error: 'Transcription service is unavailable.' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  return handleTranscribeRequest(req, res);
}