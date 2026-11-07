import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { parseWebUrl } from '@core/domains';
import type { PolicyDecision } from '@shared/index';
import { Icon } from '../ui/Icon';
import { PinInput } from '../ui/PinInput';
import { formatCountdown, formatMinutes, formatWhen } from '../ui/format';
import '../styles/global.css';
import '../styles/focus.css';

/** The network rule appends the original URL raw (so its own query survives); pages we redirect from encode it. */
function originalUrl(): string | undefined {
  const raw = location.search.indexOf('&url=') >= 0 ? location.search.slice(location.search.indexOf('&url=') + 5) : new URLSearchParams(location.search).get('url') ?? '';
  const candidate = /^https?%3A/i.test(raw) ? decodeURIComponent(raw) : raw;
  return parseWebUrl(candidate)?.href;
}

function reasonText(decision: PolicyDecision, label: string): string {
  const limit = decision.reasons.includes('daily-limit');
  const schedule = decision.reasons.includes('schedule');
  const minutes = decision.allowanceMinutes;
  const limitText = minutes === 0 ? `You chose not to use ${label} today.` : `You’ve reached your daily ${minutes !== undefined ? `${formatMinutes(minutes)} ` : ''}limit.`;
  if (limit && schedule) return `${limitText} A scheduled block is also active.`;
  if (limit) return limitText;
  return `You scheduled ${label} to be unavailable right now.`;
}

function Blocked() {
  const original = useMemo(originalUrl, []);
  const fallbackLabel = new URLSearchParams(location.search).get('label') || 'This website';
  const [decision, setDecision] = useState<PolicyDecision>();
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number>();
  const [now, setNow] = useState(Date.now());

  const refresh = useCallback(async () => {
    if (!original) return;
    const result = await send<PolicyDecision>({ type: 'GET_POLICY', url: original });
    if (result.ok) setDecision(result.data);
  }, [original]);

  useEffect(() => {
    void refresh();
    void send<{ cooldownUntil?: number }>({ type: 'PIN_STATUS' }).then((result) => result.ok && setCooldownUntil(result.data.cooldownUntil));
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(refresh, 5000);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(tick); clearInterval(poll); document.removeEventListener('visibilitychange', refresh); };
  }, [refresh]);

  const label = decision?.ruleLabel ?? fallbackLabel;
  const cooldown = cooldownUntil && cooldownUntil > now ? cooldownUntil - now : 0;
  document.title = `${label} is sealed · Screentime`;

  async function unlock(value = pin) {
    if (!original || value.length !== 6 || busy) return;
    setBusy(true); setError('');
    const result = await send<{ expiresAt: number }>({ type: 'VERIFY_AND_OVERRIDE', pin: value, url: original });
    setPin(''); setBusy(false);
    if (!result.ok) { setError(result.error); setCooldownUntil(result.cooldownUntil); return; }
    location.replace(original);
  }

  if (!original) {
    return <main className="focus-page"><section className="card focus-card"><div className="seal"><Icon name="lock" size={30}/></div><span className="eyebrow">Screentime</span><h1>This page is sealed.</h1><p className="muted">Screentime couldn’t read the original address. Close this tab or open the site again.</p></section></main>;
  }

  if (decision && decision.status !== 'blocked') {
    const unlocked = decision.status === 'temporarily-unlocked';
    return <main className="focus-page"><section className="card focus-card">
      <div className="seal open"><Icon name="check" size={30}/></div>
      <span className="eyebrow">Screentime</span>
      <h1>{unlocked ? 'Temporary visit active.' : `${label} is available.`}</h1>
      <p className="muted">{unlocked ? <>Your 10-minute visit ends in <strong className="countdown">{formatCountdown(decision.overrideExpiresAt! - now)}</strong>. It applies to every {label} tab.</> : 'All restrictions for this website have ended for now.'}</p>
      <div className="focus-actions"><button className="button" onClick={() => location.replace(original)}>Continue to {label}</button></div>
    </section></main>;
  }

  return <main className="focus-page"><section className="card focus-card">
    <div className="seal"><Icon name="lock" size={30}/></div>
    <span className="eyebrow">Screentime</span>
    <h1>{label} is sealed.</h1>
    {decision ? <>
      <p>{reasonText(decision, label)}</p>
      <p className="muted">Available again <strong>{formatWhen(decision.nextAccessAt, now)}</strong>.</p>
    </> : <p className="muted">Checking your restrictions…</p>}

    {decision?.canOverride !== false && (!showPin ? <div className="focus-actions">
      <button className="button" onClick={() => setShowPin(true)}>Unlock for 10 minutes with PIN</button>
    </div> : <form className="pin-form" onSubmit={(event) => { event.preventDefault(); void unlock(); }}>
      <PinInput label="PIN" value={pin} onChange={setPin} autoFocus disabled={cooldown > 0 || busy} onComplete={(value) => void unlock(value)}/>
      {error && !cooldown && <p className="error" role="alert">{error}</p>}
      {cooldown > 0 && <p className="countdown" role="status">Too many attempts. Try again in {formatCountdown(cooldown)}.</p>}
      <div className="focus-actions">
        <button className="button" disabled={pin.length !== 6 || cooldown > 0 || busy}>{busy ? 'Checking…' : 'Begin 10-minute visit'}</button>
        <button type="button" className="button secondary" onClick={() => { setShowPin(false); setPin(''); setError(''); }}>Cancel</button>
      </div>
    </form>)}
    <p className="fine-print">A temporary visit doesn’t change your rule, reset today’s usage, or shorten your commitment.</p>
  </section></main>;
}

createRoot(document.getElementById('root')!).render(<Blocked/>);
