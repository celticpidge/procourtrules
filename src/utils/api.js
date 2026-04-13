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
