import React, { useState } from 'react';
import { Check, X, FileDiff } from 'lucide-react';
import './ReviewPane.css';

export default function ReviewPane({ activeDiffs = [], sessionUuid, onClearDiffs }) {
  const [isApproving, setIsApproving] = useState(false);

  const handleApprove = () => {
    if (!sessionUuid) return;
    setIsApproving(true);
    fetch('/api/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionUuid })
    }).then(() => {
      setIsApproving(false);
      if (onClearDiffs) onClearDiffs();
    }).catch(() => setIsApproving(false));
  };

  const handleReject = () => {
    if (onClearDiffs) onClearDiffs();
  };

  if (activeDiffs.length === 0) {
    return (
      <div className="review-pane" style={{justifyContent: 'center', alignItems: 'center', opacity: 0.5}}>
        <FileDiff size={48} style={{marginBottom: '16px'}} />
        <p>No active diffs to review.</p>
      </div>
    );
  }

  return (
    <div className="review-pane">
      <div className="review-header">
        <div className="review-title">
          <FileDiff size={18} className="icon" />
          <span>Reviewing {activeDiffs.length} Change(s)</span>
        </div>
        <div className="review-actions">
          <button className="btn btn-reject" onClick={handleReject} disabled={isApproving}>
            <X size={16} /> Reject
          </button>
          <button className="btn btn-accept" onClick={handleApprove} disabled={isApproving}>
            <Check size={16} /> {isApproving ? 'Approving...' : 'Accept All'}
          </button>
        </div>
      </div>

      <div className="diff-container" style={{overflowY: 'auto'}}>
        {activeDiffs.map((diffObj, i) => (
          <div key={i} style={{marginBottom: '24px'}}>
            <div className="diff-file-header">
              <span>{diffObj.file || 'Unknown File'}</span>
            </div>
            <div className="diff-viewer">
              {(diffObj.diffLines || []).map((line, j) => {
                let lineClass = '';
                if (line.startsWith('+')) lineClass = 'diff-new';
                else if (line.startsWith('-')) lineClass = 'diff-old';
                
                return (
                  <div key={j} className={`diff-line ${lineClass}`}>
                    <span className="line-num">{j + 1}</span>
                    <span className="line-content">{line}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
