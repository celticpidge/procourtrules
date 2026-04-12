import { useState } from 'react';
import { sendFeedback } from '../utils/api.js';

export default function FeedbackForm({ query, response }) {
  const [rating, setRating] = useState(null);       // 'positive' | 'negative'
  const [showForm, setShowForm] = useState(false);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleRating(value) {
    if (rating === value) {
      setRating(null);
      setShowForm(false);
    } else {
      setRating(value);
      setShowForm(true);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await sendFeedback({
        rating,
        query,
        response,
        comment: comment.trim() || undefined,
        email: email.trim() || undefined,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSkip() {
    setSubmitting(true);
    setError(null);
    try {
      await sendFeedback({ rating, query, response });
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return <div className="feedback-thanks">Thanks for your feedback!</div>;
  }

  return (
    <div className="feedback-container">
      <div className="feedback-buttons">
        <button
          className={`feedback-btn ${rating === 'positive' ? 'feedback-btn-active' : ''}`}
          onClick={() => handleRating('positive')}
          aria-label="Good response"
          disabled={submitting}
        >
          👍
        </button>
        <button
          className={`feedback-btn ${rating === 'negative' ? 'feedback-btn-active' : ''}`}
          onClick={() => handleRating('negative')}
          aria-label="Bad response"
          disabled={submitting}
        >
          👎
        </button>
      </div>

      {showForm && (
        <form className="feedback-form" onSubmit={handleSubmit}>
          <textarea
            className="feedback-comment"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={rating === 'negative'
              ? "What was wrong or missing?"
              : "Any additional comments? (optional)"}
            rows={2}
            maxLength={1000}
          />
          <input
            className="feedback-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email for follow-up (optional)"
            maxLength={200}
          />
          {error && <div className="feedback-error">{error}</div>}
          <div className="feedback-actions">
            <button
              type="button"
              className="feedback-skip"
              onClick={handleSkip}
              disabled={submitting}
            >
              Skip
            </button>
            <button
              type="submit"
              className="feedback-submit"
              disabled={submitting}
            >
              {submitting ? 'Sending...' : 'Send Feedback'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
