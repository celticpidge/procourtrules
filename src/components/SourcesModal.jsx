import { useEffect } from 'react';

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
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
      </div>
    </div>
  );
}
