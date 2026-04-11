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

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Something went wrong.');
  }

  return data;
}
