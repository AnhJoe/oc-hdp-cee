import React, { useState } from 'react';
import { invoke } from '@forge/bridge';

// Renders one metadata field's value based on the `kind` the resolver
// tagged it with (plain text, a parsed date, or taskList-based choices).
function renderFieldValue(value) {
  if (!value) return '(blank)';
  if (value.kind === 'text') return value.text || '(blank)';
  if (value.kind === 'date') {
    return value.date ? new Date(value.date).toLocaleDateString() : '(no date)';
  }
  if (value.kind === 'choices') {
    const checked = value.choices
      .filter((choice) => choice.checked)
      .map((choice) => choice.label)
      .filter(Boolean);
    return checked.length ? checked.join(', ') : '(none selected)';
  }
  return '';
}

function App() {
  const [pageInfo, setPageInfo] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleClick = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await invoke('getPageInfo');
      setPageInfo(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <button onClick={handleClick} disabled={loading}>
        {loading ? 'Loading...' : 'Generate Evaluation Form'}
      </button>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {pageInfo && (
        <div>
          <p>Page ID: {pageInfo.id}</p>
          <p>Title: {pageInfo.title}</p>
          <p>Status: {pageInfo.status}</p>

          <h3>Exercise Metadata</h3>
          <ul>
            {Object.entries(pageInfo.metadata || {}).map(([label, value]) => (
              <li key={label}>
                <strong>{label}:</strong> {renderFieldValue(value)}
              </li>
            ))}
          </ul>

          <h3>
            Selected Capabilities (
            {(pageInfo.capabilities || []).filter((c) => c.selected).length})
          </h3>
          <ul>
            {(pageInfo.capabilities || [])
              .filter((c) => c.selected)
              .map((c) => (
                <li key={c.name}>{c.name}</li>
              ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default App;