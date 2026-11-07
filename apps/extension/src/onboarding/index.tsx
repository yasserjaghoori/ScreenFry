import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { endOfLocalDay } from '@core/date';
import { detectBrowser } from '@browser/platform';
import type { AppState, WebsiteRule } from '@shared/index';
import { Icon } from '../ui/Icon';
import { PinInput } from '../ui/PinInput';
import { formatDate } from '../ui/format';
import { PrivateAccessGuide } from '../ui/PrivateAccessGuide';
import '../styles/global.css';
import '../styles/focus.css';

const browser = detectBrowser();
const steps = ['Welcome', 'PIN', 'Private browsing', 'Restrictions', 'Activate'];

interface QuickRule { key: string; label: string; domain: string; enabled: boolean; minutes: number }
const quickDefaults: QuickRule[] = [
  { key: 'youtube', label: 'YouTube', domain: 'youtube.com', enabled: true, minutes: 30 },
  { key: 'x', label: 'X', domain: 'x.com', enabled: false, minutes: 15 },
  { key: 'reddit', label: 'Reddit', domain: 'reddit.com', enabled: false, minutes: 20 },
  { key: 'instagram', label: 'Instagram', domain: 'instagram.com', enabled: false, minutes: 15 }
];
type Commitment = 'none' | 'today' | 'week' | 'month';
const commitmentEnd = (choice: Commitment, now = Date.now()) => ({ none: undefined, today: endOfLocalDay(new Date(now)), week: now + 7 * 86_400_000, month: now + 30 * 86_400_000 })[choice];

function Onboarding() {
  const [step, setStep] = useState(0);
  const [state, setState] = useState<AppState>();
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [quick, setQuick] = useState(quickDefaults);
  const [feeds, setFeeds] = useState(true);
  const [commitment, setCommitment] = useState<Commitment>('none');

  useEffect(() => {
    void send<AppState>({ type: 'GET_STATE' }).then((result) => {
      if (!result.ok) return;
      if (result.data.onboardingComplete) location.replace(chrome.runtime.getURL('dashboard.html'));
      setState(result.data);
      setFeeds(result.data.feedSettings.globalEnabled);
      if (result.data.pin) setStep((current) => Math.max(current, 2));
    });
  }, []);

  async function checkProtection() {
    const result = await send<AppState>({ type: 'REFRESH_PROTECTION' });
    if (result.ok) setState(result.data);
  }
  useEffect(() => { if (step === 2) void checkProtection(); }, [step]);

  async function next() {
    setError('');
    if (step === 1) {
      if (state?.pin) { setStep(2); return; }
      if (pin.length !== 6) return setError('Enter exactly six digits.');
      if (pin !== confirm) { setConfirm(''); return setError('The two PINs don’t match. Enter the confirmation again.'); }
      if (!acknowledged) return setError('Please confirm you understand there is no PIN recovery.');
      setBusy(true);
      const result = await send<AppState>({ type: 'CREATE_PIN', pin });
      setBusy(false); setPin(''); setConfirm('');
      if (!result.ok) return setError(result.error);
      setState(result.data);
    }
    if (step === 4) {
      setBusy(true);
      const done = await send<AppState>({ type: 'COMPLETE_ONBOARDING' });
      if (!done.ok) { setBusy(false); return setError(done.error); }
      await send({ type: 'SET_FEEDS', feedSettings: { ...done.data.feedSettings, globalEnabled: feeds } });
      const now = Date.now();
      for (const item of quick.filter((candidate) => candidate.enabled)) {
        const rule: WebsiteRule = { id: crypto.randomUUID(), label: item.label, domains: [item.domain], enabled: true, dailyAllowance: { defaultMinutes: item.minutes }, schedules: [], commitmentEndsAt: commitmentEnd(commitment, now), enforcementMode: 'pin', createdAt: now, updatedAt: now };
        const saved = await send({ type: 'SAVE_RULE', rule });
        if (!saved.ok) { setBusy(false); return setError(`${item.label}: ${saved.error}`); }
      }
      location.replace(chrome.runtime.getURL('dashboard.html'));
      return;
    }
    setStep((value) => value + 1);
  }

  const enabledQuick = quick.filter((item) => item.enabled);
  const end = commitmentEnd(commitment);

  return <main className="focus-page"><section className="card focus-card onboarding">
    <ol className="steps" aria-label="Setup progress">{steps.map((name, index) => <li key={name} className={index <= step ? 'active' : ''} aria-current={index === step ? 'step' : undefined}><span className="sr-only">{name}</span></li>)}</ol>

    {step === 0 && <>
      <div className="seal"><Icon name="lock" size={30}/></div>
      <h1>Make space for what matters.</h1>
      <p className="muted">Screentime turns your intentions into commitments: daily limits, scheduled focus time and quieter feeds. Once you seal a commitment, Screentime won’t let you casually loosen it in a tempting moment.</p>
      <div className="choice-grid">
        <div className="choice"><strong>Sealproof commitments</strong><span className="muted">Make rules stricter anytime. Looser changes wait until the commitment ends.</span></div>
        <div className="choice"><strong>10-minute PIN visits</strong><span className="muted">When you truly need a site, your PIN opens it briefly without changing the rule.</span></div>
        <div className="choice"><strong>Private by design</strong><span className="muted">No account, no analytics. Everything stays in this browser.</span></div>
        <div className="choice"><strong>Honest protection</strong><span className="muted">An extension can be disabled in browser settings. Screentime removes in-product shortcuts and tells you what it covers.</span></div>
      </div>
    </>}

    {step === 1 && <>
      <div className="seal"><Icon name="lock" size={30}/></div>
      <h1>{state?.pin ? 'Your PIN is set.' : 'Create your access PIN.'}</h1>
      {state?.pin ? <p className="muted">You can change it later in Settings using your current PIN.</p> : <>
        <p className="muted">Six digits. It unlocks a site for 10 minutes at a time — it can never remove or permanently loosen a sealed commitment.</p>
        <label className="pin-label">PIN</label>
        <PinInput label="New PIN" value={pin} onChange={setPin} autoFocus/>
        <label className="pin-label">Confirm PIN</label>
        <PinInput label="Confirm PIN" value={confirm} onChange={setConfirm}/>
        <div className="notice">
          <strong>There is no PIN recovery.</strong>
          <p className="muted">Screentime stores only a salted, slow verifier on this device — never the PIN itself — so it can’t show or email it to you. If you forget it, you won’t be able to start temporary visits, and active commitments simply run until they end. Removing the extension erases all Screentime data, including your rules.</p>
          <label className="check"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)}/> I understand and will keep my PIN somewhere safe.</label>
        </div>
      </>}
    </>}

    {step === 2 && <>
      <div className="seal"><Icon name="shield" size={30}/></div>
      <h1>Cover private browsing.</h1>
      <p className="muted">Screentime needs access to websites to measure time and enforce your rules. To be Sealproof-ready it must also run in {browser === 'safari' ? 'Private Browsing' : 'Incognito'} windows — otherwise a private window would skip your limits.</p>
      {state && <PrivateAccessGuide protection={state.protection} onCheck={checkProtection}/>}
      <p className="muted small">You can continue without it. Ordinary windows are still protected, but Screentime won’t be marked Sealproof-ready.</p>
    </>}

    {step === 3 && <>
      <div className="seal"><Icon name="limits" size={30}/></div>
      <h1>Choose your first boundaries.</h1>
      <p className="muted">Start with a few daily limits. You can add schedules, weekday rules and more sites from the dashboard.</p>
      <div className="quick-list">
        {quick.map((item, index) => <div className={`quick-row ${item.enabled ? 'on' : ''}`} key={item.key}>
          <label className="check"><input type="checkbox" checked={item.enabled} onChange={(event) => setQuick(quick.map((candidate, i) => (i === index ? { ...candidate, enabled: event.target.checked } : candidate)))}/> <strong>{item.label}</strong></label>
          <div className="row"><input type="number" min={0} max={1440} value={item.minutes} disabled={!item.enabled} aria-label={`${item.label} daily minutes`} onChange={(event) => setQuick(quick.map((candidate, i) => (i === index ? { ...candidate, minutes: Math.max(0, Math.min(1440, Number(event.target.value) || 0)) } : candidate)))}/><span className="muted">min / day</span></div>
        </div>)}
        <div className="quick-row on"><label className="check"><input type="checkbox" checked={feeds} onChange={(event) => setFeeds(event.target.checked)}/> <strong>Hide distracting feeds</strong></label><span className="muted small">YouTube, X, Instagram, Reddit, Facebook, LinkedIn</span></div>
      </div>
      <div className="field left">
        <label htmlFor="commitment">Commitment for these limits</label>
        <select id="commitment" value={commitment} onChange={(event) => setCommitment(event.target.value as Commitment)}>
          <option value="none">No commitment yet</option>
          <option value="today">Until the end of today</option>
          <option value="week">7 days</option>
          <option value="month">30 days</option>
        </select>
      </div>
    </>}

    {step === 4 && <>
      <div className="seal"><Icon name="check" size={30}/></div>
      <h1>Ready when you are.</h1>
      <div className="notice">
        {enabledQuick.length ? <p><strong>{enabledQuick.map((item) => `${item.label} ${item.minutes}m`).join(' · ')}</strong> per day.</p> : <p><strong>No limits yet</strong> — add them from the dashboard.</p>}
        {end && enabledQuick.length > 0 ? <p className="muted">Sealed until <strong>{formatDate(end)}</strong>. Until then you can make these rules stricter, but raising a limit, removing a site, turning a rule off or resetting today’s usage will wait until the commitment ends. Your PIN opens a site for 10 minutes and never changes the rule.</p>
          : <p className="muted">These rules aren’t sealed, so you can edit them freely. Add a commitment from the dashboard whenever you’re ready.</p>}
      </div>
    </>}

    {error && <p className="error" role="alert">{error}</p>}
    <div className="focus-actions">
      {step > 0 && <button className="button secondary" disabled={busy} onClick={() => { setError(''); setStep((value) => value - 1); }}>Back</button>}
      <button className="button" disabled={busy || (step === 1 && !state?.pin && (pin.length !== 6 || confirm.length !== 6))} onClick={next}>
        {busy ? 'Saving…' : step === 1 && !state?.pin ? 'Create PIN' : step === 4 ? 'Activate Screentime' : 'Continue'}
      </button>
    </div>
  </section></main>;
}

createRoot(document.getElementById('root')!).render(<Onboarding/>);
