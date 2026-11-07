import React, { useState } from 'react';
import { send } from '@browser/messages';
import { exportData, hasActiveCommitment } from '@core/actions';
import { localDateKey } from '@core/date';
import type { AppState } from '@shared/index';
import { PinInput } from '../ui/PinInput';
import { PrivateAccessGuide } from '../ui/PrivateAccessGuide';
import { formatCountdown, formatDuration } from '../ui/format';
import type { Notice } from './index';

function Toggle({ on, label, description, onToggle }: { on: boolean; label: string; description: string; onToggle: () => void }) {
  return <div className="setting-row"><div><strong>{label}</strong><p className="muted small">{description}</p></div><button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? 'on' : ''}`} onClick={onToggle}/></div>;
}

function ChangePin({ onNotice }: { onNotice: (notice: Notice) => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<number>();
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setError('');
    if (next !== confirm) return setError('The new PINs don’t match.');
    const result = await send<AppState>({ type: 'CHANGE_PIN', currentPin: current, newPin: next });
    setCurrent('');
    if (!result.ok) { setError(result.error); setCooldownUntil(result.cooldownUntil); return; }
    setNext(''); setConfirm(''); setOpen(false);
    onNotice({ kind: 'success', text: 'PIN changed.' });
  }
  if (!open) return <button className="button secondary" onClick={() => setOpen(true)}>Change PIN</button>;
  const cooling = cooldownUntil && cooldownUntil > Date.now();
  return <form className="pin-change" onSubmit={submit}>
    <label className="pin-label">Current PIN</label><PinInput label="Current PIN" value={current} onChange={setCurrent} autoFocus disabled={Boolean(cooling)}/>
    <label className="pin-label">New PIN</label><PinInput label="New PIN" value={next} onChange={setNext}/>
    <label className="pin-label">Confirm new PIN</label><PinInput label="Confirm new PIN" value={confirm} onChange={setConfirm}/>
    {error && <p className="error" role="alert">{error}{cooling ? ` Try again in ${formatCountdown(cooldownUntil! - Date.now())}.` : ''}</p>}
    <div className="row"><button className="button" disabled={current.length !== 6 || next.length !== 6 || confirm.length !== 6}>Save new PIN</button><button type="button" className="button secondary" onClick={() => setOpen(false)}>Cancel</button></div>
  </form>;
}

function History({ state }: { state: AppState }) {
  const days = Object.keys(state.usage).sort().reverse().slice(0, 14);
  const label = (ruleId: string) => state.rules.find((rule) => rule.id === ruleId)?.label ?? 'Removed rule';
  if (!days.length) return <p className="muted">No usage recorded yet.</p>;
  return <div className="table-wrap"><table className="history">
    <thead><tr><th>Day</th><th>Tracked</th><th>Restricted sites</th><th>PIN visit time</th></tr></thead>
    <tbody>{days.map((key) => {
      const day = state.usage[key];
      const total = Object.values(day.millisecondsByHost).reduce((sum, ms) => sum + ms, 0);
      const rules = Object.entries(day.millisecondsByRule).filter(([, ms]) => ms > 0);
      const overrides = Object.values(day.overrideMillisecondsByRule).reduce((sum, ms) => sum + ms, 0);
      return <tr key={key}>
        <td>{new Date(`${key}T12:00:00`).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}</td>
        <td>{state.trackingEnabled || total ? formatDuration(total) : '—'}</td>
        <td>{rules.length ? rules.map(([id, ms]) => `${label(id)} ${formatDuration(ms)}`).join(' · ') : '—'}</td>
        <td>{overrides ? formatDuration(overrides) : '—'}</td>
      </tr>;
    })}</tbody>
  </table></div>;
}

export function Settings({ state, onState, onNotice }: { state: AppState; onState: (state: AppState) => void; onNotice: (notice: Notice) => void }) {
  const [resetPin, setResetPin] = useState('');
  const [showReset, setShowReset] = useState(false);
  const committed = hasActiveCommitment(state, Date.now());

  async function setPreference(patch: { trackingEnabled?: boolean; warningsEnabled?: boolean }) {
    const result = await send<AppState>({ type: 'SET_PREFERENCES', ...patch });
    if (result.ok) onState(result.data);
  }
  async function refreshProtection() {
    const result = await send<AppState>({ type: 'REFRESH_PROTECTION' });
    if (result.ok) onState(result.data);
  }
  function download() {
    const blob = new Blob([JSON.stringify(exportData(state), null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `screentime-export-${localDateKey(new Date())}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  async function deleteHistory() {
    if (!confirm('Delete usage history and PIN visit history from this browser? Rules, commitments and your PIN are kept. Today’s counted time for sealed limits is kept so those limits stay accurate.')) return;
    const result = await send<AppState>({ type: 'DELETE_HISTORY' });
    if (!result.ok) return onNotice({ kind: 'error', text: result.error });
    onState(result.data);
    onNotice({ kind: 'success', text: 'History deleted.' });
  }
  async function resetAll(event: React.FormEvent) {
    event.preventDefault();
    const result = await send<AppState>({ type: 'RESET_ALL', pin: resetPin });
    setResetPin('');
    if (!result.ok) return onNotice({ kind: 'error', text: result.error });
    location.replace(chrome.runtime.getURL('onboarding.html'));
  }

  return <>
    <section className="card settings-block">
      <h3>Browser protection</h3>
      <p className="muted">Screentime protects only this browser. Private windows are covered only when you allow it, and Screentime marks itself Sealproof-ready only after the browser proves it.</p>
      <PrivateAccessGuide protection={state.protection} onCheck={refreshProtection}/>
    </section>

    <section className="card settings-block">
      <h3>PIN</h3>
      <p className="muted">Your PIN opens a restricted site for 10 minutes at a time. It never edits rules, resets usage or ends a commitment. Only a salted PBKDF2 verifier is stored; after three wrong tries, waiting times grow from 30 seconds up to an hour.</p>
      <p className="muted">There is no recovery. If you forget your PIN, temporary visits aren’t possible and commitments run to their end. Removing the extension erases all Screentime data — browsers don’t let an extension prevent that.</p>
      <ChangePin onNotice={onNotice}/>
    </section>

    <section className="card settings-block">
      <h3>Notifications</h3>
      <Toggle on={state.warningsEnabled} label="Time-remaining reminders" description="A small in-page notice when 5 minutes and 1 minute of a daily allowance remain." onToggle={() => setPreference({ warningsEnabled: !state.warningsEnabled })}/>
    </section>

    <section className="card settings-block">
      <h3>Tracking & privacy</h3>
      <Toggle on={state.trackingEnabled} label="Record general browsing history" description="Keeps per-website focused time for the overview (domain names and durations only, never page addresses or content). Sites with limits are always measured, because limits depend on it." onToggle={() => setPreference({ trackingEnabled: !state.trackingEnabled })}/>
      <p className="muted small">No account, server, analytics or third-party code. Usage is kept for 120 days, then removed automatically.</p>
    </section>

    <section className="card settings-block">
      <h3>Usage history</h3>
      <History state={state}/>
    </section>

    <section className="card settings-block">
      <h3>Your data</h3>
      <div className="setting-row"><div><strong>Export</strong><p className="muted small">Download rules, usage and PIN visit history as JSON. Your PIN verifier isn’t included.</p></div><button className="button secondary" onClick={download}>Export JSON</button></div>
      <div className="setting-row"><div><strong>Delete history</strong><p className="muted small">Erases usage and PIN visit history. Rules, commitments and your PIN stay. Today’s counted time for sealed limits is kept, because erasing it would reset an active limit.</p></div><button className="button secondary danger" onClick={deleteHistory}>Delete history</button></div>
      <div className="setting-row"><div><strong>Reset Screentime</strong><p className="muted small">{committed ? 'Unavailable while a commitment is active. It becomes available once every commitment has ended.' : 'Removes all rules, history and your PIN, and restarts setup. Requires your PIN.'}</p></div>
        {!showReset ? <button className="button secondary danger" disabled={committed} onClick={() => setShowReset(true)}>Reset…</button> : null}
      </div>
      {showReset && !committed && <form className="pin-change" onSubmit={resetAll}>
        <label className="pin-label">Enter your PIN to reset</label><PinInput label="PIN" value={resetPin} onChange={setResetPin} autoFocus/>
        <div className="row"><button className="button danger-fill" disabled={resetPin.length !== 6}>Reset everything</button><button type="button" className="button secondary" onClick={() => setShowReset(false)}>Cancel</button></div>
      </form>}
    </section>

    <section className="card settings-block">
      <h3>What Screentime can and can’t do</h3>
      <ul className="plain-list muted">
        <li>It blocks restricted sites in this browser while the extension is installed and enabled.</li>
        <li>It can’t stop anyone from disabling or removing the extension in browser settings, using another browser or device, or changing the system clock.</li>
        <li>Data lives in this browser’s extension storage, which someone with full control of the device could edit. The PIN is a self-control tool, not a security boundary.</li>
        <li>Chrome and Safari keep separate rules, usage and PINs in this version.</li>
      </ul>
    </section>
  </>;
}
