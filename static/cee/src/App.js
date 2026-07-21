import React, { useState } from 'react';
import { invoke } from '@forge/bridge';

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
        </div>
      )}
    </div>
  );
}

export default App;