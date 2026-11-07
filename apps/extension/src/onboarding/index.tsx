import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import type { AppState } from '@shared/index';
import '../styles/global.css';
import '../styles/focus.css';

const copy = [
  { title: 'Make space for what matters.', body: 'Screentime turns your intentions into commitments. Limit distracting sites, quiet noisy feeds, and keep useful parts of the web within reach.' },
  { title: 'Create your access PIN.', body: 'Your PIN allows a temporary 10-minute visit. It never removes or permanently loosens a sealed commitment.' },
  { title: 'Cover private browsing.', body: 'For complete browser coverage, Chrome must allow Screentime in Incognito. Only you can enable this browser permission.' },
  { title: 'Choose your first boundaries.', body: 'After setup, add daily limits, recurring schedules, and feed controls from your private dashboard.' },
  { title: 'Ready when you are.', body: 'Once a commitment begins, stricter changes are welcome. Weaker changes wait until the commitment period ends.' }
];

function Onboarding() {
  const [step, setStep] = useState(0);
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [protection, setProtection] = useState<AppState['protection']>();
  async function next() {
    setError('');
    if (step === 1) {
      if (!/^\d{6}$/.test(pin)) return setError('Enter exactly six digits.');
      if (pin !== confirm) return setError('The PINs do not match.');
      const result = await send({ type: 'CREATE_PIN', pin });
      setPin(''); setConfirm('');
      if (!result.ok) return setError(result.error ?? 'Unable to save PIN.');
    }
    if (step === 2) {
      const result = await send<AppState>({ type: 'REFRESH_PROTECTION' });
      if (result.data) setProtection(result.data.protection);
    }
    if (step === 4) {
      const result = await send({ type: 'COMPLETE_ONBOARDING' });
      if (!result.ok) return setError(result.error ?? 'Setup is incomplete.');
      location.href = chrome.runtime.getURL('dashboard.html');
      return;
    }
    setStep((value) => value + 1);
  }
  return <main className="focus-page"><section className="card focus-card"><div className="steps">{copy.map((_, index) => <i key={index} className={index <= step ? 'active' : ''}/>)}</div><div className="seal">{step === 0 ? '◌' : step === 1 ? '••' : step === 2 ? '◇' : step === 3 ? '◷' : '✓'}</div><h1>{copy[step].title}</h1><p className="muted">{copy[step].body}</p>{step === 0 && <div className="choice-grid"><div className="choice"><strong>Private by design</strong><span className="muted">No account, analytics, or remote browsing history.</span></div><div className="choice"><strong>Honest protection</strong><span className="muted">Extensions can be disabled; Screentime removes casual in-product bypasses.</span></div></div>}{step === 1 && <><input autoFocus inputMode="numeric" type="password" maxLength={6} className="pin-input" aria-label="Create PIN" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}/><input inputMode="numeric" type="password" maxLength={6} className="pin-input" aria-label="Confirm PIN" value={confirm} onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}/><div className="notice"><strong>Keep this PIN safe.</strong><br/><span className="muted">There is no recovery shortcut. The verifier remains local, but reinstalling the extension can clear local protection and data.</span></div></>}{step === 2 && <div className="notice"><strong>Enable Chrome → Extensions → Screentime → Allow in Incognito.</strong><p className="muted">Chrome does not let an extension grant itself this access. Ordinary-window blocking still works without it.</p>{protection && <span className={`pill ${protection.privateAccess !== 'verified' ? 'warn' : ''}`}>{protection.privateAccess === 'verified' ? 'Incognito verified' : 'Not yet verified'}</span>}</div>}{step === 3 && <div className="choice-grid"><div className="choice"><strong>Daily limits</strong><span className="muted">Count focused, active browsing only.</span></div><div className="choice"><strong>Schedules</strong><span className="muted">Recurring and overnight windows.</span></div><div className="choice"><strong>Feed controls</strong><span className="muted">Hide feeds without blocking search.</span></div><div className="choice"><strong>Commitments</strong><span className="muted">Lock rules for a chosen duration.</span></div></div>}{error && <p className="error">{error}</p>}<div className="focus-actions">{step > 0 && <button className="button secondary" onClick={() => setStep((value) => value - 1)}>Back</button>}<button className="button" onClick={next}>{step === 2 ? 'Check and continue' : step === 4 ? 'Open dashboard' : 'Continue'}</button></div></section></main>;
}

createRoot(document.getElementById('root')!).render(<Onboarding/>);
