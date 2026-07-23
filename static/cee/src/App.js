import React, { useState, useEffect, useCallback } from 'react';
import { invoke } from '@forge/bridge';

function App() {
  const [createResult, setCreateResult] = useState(null);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [tracker, setTracker] = useState(null);
  const [trackerLoading, setTrackerLoading] = useState(false);
  const [trackerError, setTrackerError] = useState(null);

  const [deletingId, setDeletingId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const loadTracker = useCallback(async () => {
    setTrackerLoading(true);
    setTrackerError(null);
    try {
      const result = await invoke('getRequestTypeTracker');
      setTracker(result);
    } catch (err) {
      setTrackerError(String(err));
    } finally {
      setTrackerLoading(false);
    }
  }, []);

  // Load request type status on mount, and again after any create/delete
  // action below, so the tracker shown always reflects the latest state.
  useEffect(() => {
    loadTracker();
  }, [loadTracker]);

  // Calls the real Forms API create-form call (currently authenticated with
  // the developer's personal credentials while the workflow is being proven
  // out - see the TODO near the top of README.md). The resolver auto-picks
  // whichever of AAR #1/#2/#3 is currently open - see getRequestTypeTracker.
  const handleCreateForm = async () => {
    setCreateLoading(true);
    setCreateError(null);
    try {
      const result = await invoke('createEvaluationForm');
      setCreateResult(result);
      await loadTracker();
    } catch (err) {
      setCreateError(String(err));
    } finally {
      setCreateLoading(false);
    }
  };

  const handleDeleteForm = async (requestTypeId) => {
    setDeletingId(requestTypeId);
    setDeleteError(null);
    try {
      const result = await invoke('deleteEvaluationForm', { requestTypeId });
      if (!result.ok) {
        setDeleteError(result.error || `Failed to delete form (status ${result.status}).`);
      }
      await loadTracker();
    } catch (err) {
      setDeleteError(String(err));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <button onClick={handleCreateForm} disabled={createLoading}>
        {createLoading ? 'Loading...' : 'Create Form'}
      </button>
      {createError && <p style={{ color: 'red' }}>{createError}</p>}
      {deleteError && <p style={{ color: 'red' }}>{deleteError}</p>}

      <h3>Request Type Status</h3>
      {trackerError && <p style={{ color: 'red' }}>{trackerError}</p>}
      {trackerLoading && !tracker && <p>Loading...</p>}
      {tracker && (
        <ul>
          {tracker.map((rt) => (
            <li key={rt.id}>
              <strong>{rt.name}</strong>:{' '}
              {rt.inUse ? (
                <>
                  in use ({rt.formName || 'unknown form'})
                  {' '}
                  {rt.formLink && (
                    <>
                      <a href={rt.formLink} target="_blank" rel="noopener noreferrer">
                        link
                      </a>
                      {' '}
                    </>
                  )}
                  <button
                    onClick={() => handleDeleteForm(rt.id)}
                    disabled={deletingId === rt.id}
                  >
                    {deletingId === rt.id ? 'Deleting...' : 'Delete Form'}
                  </button>
                </>
              ) : (
                'open'
              )}
            </li>
          ))}
        </ul>
      )}

      {createResult && (
        <div>
          <p>Form name: {createResult.formName}</p>
          {createResult.requestTypeName && (
            <p>
              Published to request type: {createResult.requestTypeName} ({createResult.requestTypeId})
            </p>
          )}
          {createResult.formLink && (
            <p>
              Form link:{' '}
              <a href={createResult.formLink} target="_blank" rel="noopener noreferrer">
                {createResult.formLink}
              </a>
            </p>
          )}
          {createResult.error && <p style={{ color: 'red' }}>{createResult.error}</p>}
        </div>
      )}
    </div>
  );
}

export default App;
