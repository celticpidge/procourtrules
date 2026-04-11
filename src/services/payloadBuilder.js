function formatTable(table) {
  if (!table) return '';
  const header = table.columns.join(' | ');
  const separator = table.columns.map(() => '---').join(' | ');
  const rows = table.rows.map((row) => row.join(' | ')).join('\n');
  return `\n${table.title}:\n${header}\n${separator}\n${rows}\n`;
}

function buildSystemPrompt(rules) {
  const rulesText = rules.categories
    .flatMap((cat) =>
      cat.rules.map(
        (rule) =>
          `[${rule.regulation}] ${rule.title}: ${rule.text}${
            rule.details ? '\n' + rule.details.join('\n') : ''
          }${rule.table ? formatTable(rule.table) : ''}`
      )
    )
    .join('\n\n');

  return `You are Court Rules, an assistant that answers questions ONLY about PNW tennis league regulations. You speak in plain, friendly English that non-technical users can understand.

CRITICAL INSTRUCTIONS — YOU MUST FOLLOW THESE:
1. ONLY answer using the regulations provided below. Do NOT use outside knowledge about tennis rules, USTA national rules, or any other source.
2. Always cite the specific regulation number(s) that support your answer (e.g., "Per regulation 2.01C(5)b(PNW REG)..."). Quote the relevant part of the regulation.
3. If the answer involves multiple regulations, cite each one separately.
4. If the regulations below do NOT cover the question, say: "I don't have a specific PNW regulation that covers this. You may want to check with your local league coordinator or refer to the national USTA regulations."
5. NEVER guess or infer rules that are not explicitly stated in the regulations below.
6. When a user asks a follow-up, use the conversation context to understand what they are referring to.
7. If the question is ambiguous, ask the user to clarify (e.g., which division, age group, or league type).
8. Keep answers concise but complete. Use bullet points for lists.

Here are the ONLY regulations you may reference:

${rulesText}`;
}

export function buildChatPayload(conversation, rules) {
  const systemMessage = {
    role: 'system',
    content: buildSystemPrompt(rules),
  };

  return {
    model: 'gpt-4o-mini',
    temperature: 0.2,
    messages: [systemMessage, ...conversation],
  };
}
