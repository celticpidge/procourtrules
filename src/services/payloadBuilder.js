function buildSystemPrompt(rules) {
  const rulesText = rules.categories
    .flatMap((cat) =>
      cat.rules.map(
        (rule) =>
          `[${rule.regulation}] ${rule.title}: ${rule.text}${
            rule.details ? '\n' + rule.details.join('\n') : ''
          }`
      )
    )
    .join('\n\n');

  return `You are Court Rules, a helpful assistant that answers questions about PNW tennis league regulations. You speak in plain, friendly English that non-technical users can understand.

IMPORTANT INSTRUCTIONS:
- Always cite the specific regulation number(s) that support your answer (e.g., "Per regulation 2.01C(5)b(PNW REG)...").
- If the answer involves multiple regulations, cite each one.
- If the rules do not cover the question, say so honestly.
- Keep answers concise but complete.
- When a user asks a follow-up, use the conversation context to understand what they are referring to.

Here are the regulations you must use to answer questions:

${rulesText}`;
}

export function buildChatPayload(conversation, rules) {
  const systemMessage = {
    role: 'system',
    content: buildSystemPrompt(rules),
  };

  return {
    model: 'gpt-4o-mini',
    messages: [systemMessage, ...conversation],
  };
}
