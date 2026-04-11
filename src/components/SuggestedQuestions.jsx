const SUGGESTIONS = [
  "What happens if my opponent is 12 minutes late?",
  "How many players do I need for a sectional championship?",
  "Can I play on two teams at different NTRP levels?",
  "What's the tiebreaker order for standings?",
  "What are the inclement weather rules?",
  "How do line assistants work?",
];

export default function SuggestedQuestions({ onSelect }) {
  return (
    <div className="suggestions">
      <p className="suggestions-label">Try asking:</p>
      <div className="suggestions-grid">
        {SUGGESTIONS.map((q) => (
          <button key={q} className="suggestion-chip" onClick={() => onSelect(q)}>
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
