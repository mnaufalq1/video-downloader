import { useState } from 'react';

/**
 * Formula input URL + tombol "Ambil Info".
 * status: idle | loading | loaded | error
 */
export default function UrlForm({ status, onFetch, onReset }) {
  const [input, setInput] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || status === 'loading') return;
    onFetch(trimmed);
  };

  return (
    <form className="url-form" onSubmit={handleSubmit}>
      <input
        type="url"
        className="url-input"
        placeholder="Paste link video here... https://www.youtube.com/watch?v=..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        disabled={status === 'loading'}
        autoFocus
      />
      {status === 'loaded' ? (
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          Load ↺
        </button>
      ) : (
        <button type="submit" className="btn btn-primary" disabled={!input.trim() || status === 'loading'}>
          {status === 'loading' ? 'Loading...' : 'Ambil Info'}
        </button>
      )}
    </form>
  );
}