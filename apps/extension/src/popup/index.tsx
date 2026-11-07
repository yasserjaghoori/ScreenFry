import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { localDateKey } from '@core/date';
import { urlMatchesDomains } from '@core/domains';
import type { AppState, PolicyDecision } from '@shared/index';
import '../styles/global.css';
import '../styles/popup.css';

function Popup() {
  const [state, setState] = useState<AppState>();
  const [tab, setTab] = useState<chrome.tabs.Tab>();
  const [decision, setDecision] = useState<PolicyDecision>();
  useEffect(() => { void (async () => { const [active] = await chrome.tabs.query({ active: true, currentWindow: true }); setTab(active); const result = await send<AppState>({ type: 'GET_STATE' }); if (result.data) setState(result.data); if (active?.url) { const policy = await send<PolicyDecision>({ type: 'GET_POLICY', url: active.url }); setDecision(policy.data); } })(); }, []);
  if (!state) return <main className="popup">Loading…</main>;
  const rule = state.rules.find((candidate) => tab?.url && urlMatchesDomains(tab.url, candidate.domains));
  const usage = rule ? state.usage[localDateKey(new Date())]?.millisecondsByRule[rule.id] ?? 0 : 0;
  const allowance = (rule?.dailyAllowance?.defaultMinutes ?? 0) * 60_000;
  const percent = allowance ? Math.min(100, usage / allowance * 100) : 0;
  const remaining = allowance ? Math.max(0, allowance - usage) : undefined;
  const host = tab?.url ? (() => { try { return new URL(tab.url!).hostname.replace(/^www\./, ''); } catch { return 'Current website'; } })() : 'Current website';
  return <main className="popup"><header className="popup-head"><div className="row"><div className="mark">S</div><span className="popup-title">Screentime</span></div><span className={`pill ${state.protection.privateAccess !== 'verified' ? 'warn' : ''}`}>{state.protection.privateAccess === 'verified' ? 'Protected' : 'Standard'}</span></header><section className="card site-card"><div className="row spread"><div><span className="eyebrow">Current site</span><h1>{rule?.label ?? host}</h1><span className="muted">{decision?.status === 'blocked' ? 'Sealed right now' : decision?.status === 'temporarily-unlocked' ? 'Temporary visit active' : rule ? 'Available' : 'No limit configured'}</span></div>{rule && <div className="ring" style={{ '--progress': `${percent * 3.6}deg` } as React.CSSProperties}><span>{Math.round(percent)}%</span></div>}</div>{rule && <div className="popup-stats"><div className="popup-stat"><span className="muted">Used today</span><strong>{Math.floor(usage / 60_000)} min</strong></div><div className="popup-stat"><span className="muted">Remaining</span><strong>{remaining === undefined ? 'No limit' : `${Math.ceil(remaining / 60_000)} min`}</strong></div></div>}<button className="button" onClick={() => chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') })}>Open dashboard</button></section></main>;
}

createRoot(document.getElementById('root')!).render(<Popup/>);
