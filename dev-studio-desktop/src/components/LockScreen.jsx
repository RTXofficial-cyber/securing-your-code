import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Gate shown before anything else when a PIN is set.
 * First run with no PIN offers to create one (optional but recommended).
 */
export default function LockScreen({ onUnlocked }) {
  const [mode, setMode] = useState('loading'); // loading | create | unlock
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [skip, setSkip] = useState(false);

  useEffect(() => {
    api.lockState().then((r) => setMode(r?.set ? 'unlock' : 'create')).catch(() => setMode('create'));
  }, []);

  const submit = async () => {
    setError('');
    if (mode === 'unlock') {
      const r = await api.lockVerify(pin);
      if (r?.ok) onUnlocked();
      else setError('Wrong PIN. This attempt was recorded in the audit log.');
      return;
    }
    if (pin.length < 4) { setError('PIN must be at least 4 characters.'); return; }
    if (pin !== confirm) { setError('PINs do not match.'); return; }
    const r = await api.lockSet(pin);
    if (r?.ok) onUnlocked();
    else setError(r?.error || 'Could not set PIN');
  };

  return (
    <div className="lockscreen">
      <div className="lock-card">
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 6 }}>
          <span className="brand-mark">D</span> Dev Studio
        </div>
        <h2 className="lock-title">{mode === 'unlock' ? 'Locked' : 'Protect this app'}</h2>
        <p className="lock-sub">
          {mode === 'unlock'
            ? 'Enter your PIN to open your workspace. Only you can get in.'
            : 'Set a PIN so nobody else can open your projects, keys or terminal. You can skip this and add it later in Settings → Security.'}
        </p>

        {mode !== 'loading' && (
          <>
            <input
              className="lock-input"
              type="password"
              inputMode="numeric"
              autoFocus
              placeholder="PIN"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && (mode === 'unlock' ? submit() : document.getElementById('lock-confirm')?.focus())}
            />
            {mode === 'create' && (
              <input
                id="lock-confirm"
                className="lock-input"
                type="password"
                inputMode="numeric"
                placeholder="Confirm PIN"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
              />
            )}
            {error && <div className="lock-error">{error}</div>}
            <div className="lock-actions">
              {mode === 'unlock' ? (
                <button className="btn btn-solid btn-lg" onClick={submit} disabled={!pin}>Unlock →</button>
              ) : (
                <>
                  <button className="btn btn-solid btn-lg" onClick={submit} disabled={!pin || !confirm}>Set PIN &amp; enter</button>
                  {!skip && (
                    <button className="btn btn-lg" onClick={() => { setSkip(true); onUnlocked(); }}>Skip for now</button>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
