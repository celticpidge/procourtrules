import { useEffect, useState } from 'react';
import { sendFeedback } from '../utils/api.js';

const SOURCES = [
  {
    name: 'PNW League Regulations',
    description: 'Pacific Northwest Section league rules (August 2025)',
    url: 'https://www.usta.com/content/dam/usta/sections/pacific-northwest/pdfs/play/league-regulations/pnw-league-regulations-august-2025.pdf',
  },
  {
    name: 'USTA National League Regulations',
    description: 'National regulations with Q&A interpretations (2025)',
    url: 'https://www.usta.com/content/dam/usta/2025-pdfs/2025-national-regulations-with-q-a-interpretations.pdf',
  },
  {
    name: 'The Code',
    description: 'The players\u2019 guide for unofficiated matches',
    url: 'https://www.usta.com/content/dam/usta/pdfs/2015_Code.pdf',
  },
  {
    name: 'Friend at Court',
    description: 'USTA handbook of rules and regulations',
    url: 'https://www.usta.com/content/dam/usta/coach-organize/content-fragments/resource-library/assets/pdfs/friend-at-court.pdf',
  },
  {
    name: 'ITF Rules of Tennis',
    description: 'Official international rules of tennis (2026)',
    url: 'https://www.itftennis.com/media/7221/2026-rules-of-tennis-english.pdf',
  },
];

export default function SourcesModal({ onClose }) {
  const [suggestion, setSuggestion] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);

  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  async function handleSuggest(e) {
    e.preventDefault();
    if (!suggestion.trim()) return;
    setSubmitting(true);
    try {
      await sendFeedback({
        rating: 'source-suggestion',
        query: 'Source suggestion',
        response: suggestion.trim(),
        email: email.trim() || undefined,
      });
      setSubmitted(true);
    } catch {
      // silently fail
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Sources</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">&times;</button>
        </div>
        <p className="modal-description">
          Answers are generated from these five official tennis regulation documents:
        </p>
        <ul className="sources-list">
          {SOURCES.map((s) => (
            <li key={s.name} className="source-item">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="source-link">
                {s.name}
              </a>
              <span className="source-desc">{s.description}</span>
            </li>
          ))}
        </ul>

        <div className="source-suggest">
          <button className="source-suggest-toggle" onClick={() => setShowSuggest(!showSuggest)}>
            {showSuggest ? '▾' : '▸'} Suggest a source
          </button>
          {showSuggest && (submitted ? (
            <p className="source-suggest-thanks">Thanks for your suggestion!</p>
          ) : (
            <form onSubmit={handleSuggest} className="source-suggest-form">
              <textarea
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                placeholder="Know a document we should include? Tell us about it..."
                rows={2}
                maxLength={500}
                className="feedback-comment"
              />
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Email for follow-up (optional)"
                maxLength={200}
                className="feedback-email"
              />
              <button type="submit" className="feedback-submit" disabled={submitting || !suggestion.trim()}>
                {submitting ? 'Sending...' : 'Submit'}
              </button>
            </form>
          ))}
        </div>
      </div>
    </div>
  );
}
