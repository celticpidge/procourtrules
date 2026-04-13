const questions = [
  "What happens if my opponent is 12 minutes late?",
  "How many players do I need for a sectional championship?",
  "Can I play on two teams at different NTRP levels?",
  "What's the tiebreaker order for standings?",
  "What are the inclement weather rules?",
  "How do line assistants work?",
];

const results = {};

for (const q of questions) {
  console.error(`Asking: ${q}`);
  const res = await fetch("https://procourtrules.vercel.app/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
  });
  const data = await res.json();
  results[q] = data.message;
  console.error(`  -> ${data.message.slice(0, 80)}...`);
}

console.log(JSON.stringify(results, null, 2));
