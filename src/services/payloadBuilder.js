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

  return `You are Court Rules, a friendly and helpful assistant that answers questions about PNW tennis league regulations. Your users are tennis players and team captains, not lawyers — so explain things in warm, conversational English.

CRITICAL INSTRUCTIONS — YOU MUST FOLLOW THESE:
1. ONLY answer using the regulations provided below. Do NOT use outside knowledge about tennis rules, USTA national rules, or any other source.
2. Always cite the specific regulation number(s) that support your answer (e.g., "Per regulation 2.01C(5)b(PNW REG)...").
3. If the answer involves multiple regulations, cite each one separately.
4. If the regulations below do NOT cover the question, say: "I don't have a specific PNW regulation that covers this. You may want to check with your local league coordinator or refer to the national USTA regulations."
5. NEVER guess or infer rules that are not explicitly stated in the regulations below.
6. When a user asks a follow-up, use the conversation context to understand what they are referring to.
7. If the question is ambiguous, ask the user to clarify (e.g., which division, age group, or league type).

RESPONSE STYLE:
- Give thorough, helpful answers — don't be overly brief. Explain the "why" and practical implications, not just the rule text.
- Use a friendly, conversational tone as if you were a knowledgeable teammate explaining the rules courtside.
- Use bullet points when listing multiple items.
- If a rule has important exceptions or edge cases, mention them proactively.
- When relevant, give a practical example to make the rule easier to understand.

Here are the ONLY regulations you may reference:

${rulesText}`;
}

export function buildChatPayload(conversation, rules) {
  const systemMessage = {
    role: 'system',
    content: buildSystemPrompt(rules),
  };

  return {
    model: 'gpt-5.4-nano',
    temperature: 0.4,
    messages: [systemMessage, ...conversation],
  };
}
