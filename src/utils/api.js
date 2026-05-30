export async function sendMessage(messages) {
  let response;
  try {
    response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages }),
    });
  } catch {
    throw new Error('Connection failed. Please check your network and try again.');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    if (!response.ok) {
      throw new Error('Server error. Please try again later.');
    }
    throw new Error('Unexpected response from server.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}

export async function sendFeedback({ rating, query, response, comment, email }) {
  const res = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, query, response, comment, email }),
  });

  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Failed to submit feedback.');
  }

  return true;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read audio data.'));
        return;
      }
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read audio data.'));
    reader.readAsDataURL(blob);
  });
}

const RETRYABLE_TRANSCRIPTION_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createRetryableTranscriptionError(message, options = {}) {
  const error = new Error(message);
  error.retryable = Boolean(options.retryable);
  error.status = options.status;
  return error;
}

async function postTranscriptionRequest(payload) {
  let response;
  try {
    response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw createRetryableTranscriptionError(
      'Connection failed while transcribing audio.',
      { retryable: true }
    );
  }

  let data;
  const contentType = response.headers?.get?.('content-type') || '';
  try {
    if (!contentType.includes('application/json')) {
      throw new Error('non-json-response');
    }
    data = await response.json();
  } catch {
    if (contentType.includes('text/javascript') || contentType.includes('text/html')) {
      throw createRetryableTranscriptionError(
        'Local /api/transcribe endpoint is not running in this dev server. Start a serverless API runtime (for example `vercel dev`) to use transcription locally.',
        { retryable: false, status: response.status }
      );
    }
    throw createRetryableTranscriptionError(
      'Unexpected transcription response from server.',
      { retryable: false, status: response.status }
    );
  }

  if (!response.ok) {
    throw createRetryableTranscriptionError(
      data.error || 'Transcription failed.',
      {
        retryable: RETRYABLE_TRANSCRIPTION_STATUS_CODES.has(response.status),
        status: response.status,
      }
    );
  }

  return data.text || '';
}

export async function sendTranscription(audioBlob) {
  if (!audioBlob || audioBlob.size === 0) {
    throw new Error('No audio recorded. Please try again.');
  }

  const audioBase64 = await blobToBase64(audioBlob);
  const payload = {
    audioBase64,
    mimeType: audioBlob.type || '',
  };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await postTranscriptionRequest(payload);
    } catch (error) {
      if (!error?.retryable || attempt === maxAttempts) {
        throw new Error(error?.message || 'Transcription failed.');
      }

      const baseDelayMs = 250;
      const jitterMs = Math.floor(Math.random() * 120);
      const delayMs = baseDelayMs * (2 ** (attempt - 1)) + jitterMs;
      await sleep(delayMs);
    }
  }

  throw new Error('Transcription failed.');
}
