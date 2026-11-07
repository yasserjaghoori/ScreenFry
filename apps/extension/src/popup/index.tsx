import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { isCommitted } from '@core/commitments';
import { displayHost, parseWebUrl } from '@core/domains';
import { localDateKey } from '@core/date';
import { matchingRules } from '@policy/index';
import type { AppState, PolicyDecision } from '@shared/index';
import { Icon } from '../ui/Icon';
import { formatCountdown, formatDate, formatDuration, formatWhen } from '../ui/format';
import '../styles/global.css';
import '../styles/popup.css';

const open = (page: string) => { void chrome.tabs.create({ url: chrome.runtime.getURL(page) }); window.close(); };

/** For a blocked page we show the site behind it, not the extension URL. */
function siteUrl(tabUrl?: string): string | undefined {
  if (!tabUrl) return undefined;
  if (tabUrl.startsWith(chrome.runtime.getURL('blocked.html'))) {
    const search = new URL(tabUrl).search;
    const raw = search.includes('&url=') ? search.slice(search.indexOf('&url=') + 5) : new URLSearchParams(search).get('url') ?? '';
    return parseWebUrl(/^https?%3A/i.test(raw) ? decodeURIComponent(raw) : raw)?.href;
  }
  return parseWebUrl(tabUrl)?.href;
}

function Popup() {
  const [state, setState] = useState<AppState>();
  const [url, setUrl] = useState<string>();
  const [decision, setDecision] = useState<PolicyDecision>();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const site = siteUrl(tab?.url);
      setUrl(site);
      const result = await send<AppState>({ type: 'GET_STATE' });
      if (result.ok) setState(result.data);
      if (site) { const policy = await send<PolicyDecision>({ type: 'GET_POLICY', url: site }); if (policy.ok) setDecision(policy.data); }
    })();
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!state) return <main className="popup"><p className="muted">Loading…</p></main>;

  if (!state.onboardingComplete) {
    return <main className="popup">
      <header className="popup-head"><div className="row"><div className="mark"><Icon name="lock" size={16}/></div><span className="popup-title">Screentime</span></div></header>
      <section className="card site-card"><h1>Finish setting up</h1><p className="muted">Create your PIN to start using restrictions.</p><button className="button" onClick={() => open('onboarding.html')}>Continue setup</button></section>
    </main>;
  }

  const host = url ? displayHost(url) : undefined;
  const rules = url ? matchingRules(state, url) : [];
  const rule = rules.find((candidate) => candidate.id === decision?.ruleId) ?? rules[0];
  const today = state.usage[localDateKey(new Date(now))];
  const usage = rule ? today?.millisecondsByRule[rule.id] ?? 0 : host ? today?.millisecondsByHost[host] ?? 0 : 0;
  const allowance = decision?.allowanceMinutes !== undefined ? decision.allowanceMinutes * 60_000 : undefined;
  const percent = allowance ? Math.min(100, (usage / allowance) * 100) : allowance === 0 ? 100 : 0;
  const ready = state.protection.privateAccess !== 'unverified';
  const status = decision?.status === 'blocked' ? 'Sealed' : decision?.status === 'temporarily-unlocked' ? 'Temporary visit' : rule ? 'Within limits' : 'No restriction';

  return <main className="popup">
    <header className="popup-head">
      <div className="row"><div className="mark"><Icon name="lock" size={16}/></div><span className="popup-title">Screentime</span></div>
      <span className={`pill ${ready ? '' : 'warn'}`} title={ready ? 'Private browsing coverage confirmed' : 'Private browsing coverage not confirmed'}>{ready ? 'Sealproof-ready' : 'Standard'}</span>
    </header>
    <section className="card site-card">
      <div className="row spread">
        <div><span className="eyebrow">Current website</span><h1>{rule?.label ?? host ?? 'No website'}</h1><span className={`status status-${decision?.status ?? 'none'}`}>{status}</span></div>
        {allowance !== undefined && <div className="ring" style={{ '--progress': `${percent}%` } as React.CSSProperties}><span>{Math.round(percent)}%</span></div>}
      </div>
      <div className="popup-stats">
        <div className="popup-stat"><span className="muted">Used today</span><strong>{formatDuration(usage)}</strong></div>
        <div className="popup-stat"><span className="muted">Remaining</span><strong>{decision?.remainingMilliseconds !== undefined ? formatDuration(decision.remainingMilliseconds) : '—'}</strong></div>
        {decision?.status === 'blocked' && <div className="popup-stat wide"><span className="muted">Next access</span><strong>{formatWhen(decision.nextAccessAt, now)}</strong></div>}
        {decision?.status === 'temporarily-unlocked' && <div className="popup-stat wide"><span className="muted">Visit ends in</span><strong className="countdown">{formatCountdown(decision.overrideExpiresAt! - now)}</strong></div>}
        {rule && isCommitted(rule, now) && <div className="popup-stat wide"><span className="muted">Sealed until</span><strong>{formatDate(rule.commitmentEndsAt)}</strong></div>}
      </div>
      {!host && <p className="muted small">Open a website to see its usage.</p>}
    </section>
    <button className="button" onClick={() => open('dashboard.html')}>Open dashboard</button>
    <p className="muted small center">Limits and history are kept on this browser only.</p>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
