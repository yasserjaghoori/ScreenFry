import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import '../styles/global.css';
import '../styles/focus.css';

function Blocked() {
  const query = useMemo(() => new URLSearchParams(location.search), []);
  const label = query.get('label') || 'This website';
  const ruleId = query.get('ruleId') || '';
  // DNR appends the original URL as the final raw value so its own query string is preserved.
  const rawUrlIndex = location.search.indexOf('&url=');
  const original = rawUrlIndex >= 0 ? location.search.slice(rawUrlIndex + 5) : query.get('url') || '';
  const next = Number(query.get('next'));
  const reasons = (query.get('reasons') || '').split(',');
  const [showPin, setShowPin] = useState(false);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [cooldownUntil, setCooldownUntil] = useState<number>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const cooldown = cooldownUntil ? Math.max(0, Math.ceil((cooldownUntil - now) / 1000)) : 0;
  const reason = reasons.includes('daily-limit') && reasons.includes('schedule') ? 'Your daily limit is complete, and a scheduled block is active.' : reasons.includes('daily-limit') ? 'You’ve reached the daily limit you chose.' : 'This website is unavailable during your scheduled focus time.';
  async function unlock(event: React.FormEvent) {
    event.preventDefault(); setError('');
    const result = await send<{ expiresAt: number }>({ type: 'VERIFY_AND_OVERRIDE', pin, ruleId });
    setPin('');
    if (!result.ok) { setError(result.error ?? 'Unable to unlock.'); setCooldownUntil(result.cooldownUntil); return; }
    location.replace(original);
  }
  return <main className="focus-page"><section className="card focus-card"><div className="seal">⌑</div><span className="eyebrow">Screentime</span><h1>{label} is sealed.</h1><p>{reason}</p>{next > 0 && <p className="muted">Available again <strong>{new Date(next).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</strong>.</p>}{!showPin ? <div className="focus-actions"><button className="button" onClick={() => setShowPin(true)}>Unlock for 10 minutes with PIN</button></div> : <form onSubmit={unlock}><input autoFocus inputMode="numeric" type="password" maxLength={6} className="pin-input" aria-label="PIN" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))} disabled={cooldown > 0}/>{error && <p className="error">{error}</p>}{cooldown > 0 && <p className="countdown">Try again in {cooldown}s</p>}<div className="focus-actions"><button className="button" disabled={pin.length !== 6 || cooldown > 0}>Begin 10-minute visit</button><button type="button" className="button secondary" onClick={() => setShowPin(false)}>Cancel</button></div></form>}<p className="muted" style={{ marginTop: 28, fontSize: 13 }}>The temporary visit does not change your rule or reset today’s usage.</p></section></main>;
}

createRoot(document.getElementById('root')!).render(<Blocked/>);
