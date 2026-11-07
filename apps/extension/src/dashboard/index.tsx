import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { STATE_KEY } from '@browser/storage';
import { migrateState } from '@core/defaults';
import type { AppState, WebsiteRule } from '@shared/index';
import { Icon } from '../ui/Icon';
import { Overview } from './Overview';
import { Feeds } from './Feeds';
import { RuleList } from './Rules';
import { RuleEditor, blankRule } from './RuleEditor';
import { Settings } from './Settings';
import '../styles/global.css';
import '../styles/dashboard.css';

const pages = [
  { id: 'overview', label: 'Overview', icon: 'overview' },
  { id: 'feeds', label: 'Feed Blocker', icon: 'feeds' },
  { id: 'limits', label: 'Time Limits', icon: 'limits' },
  { id: 'schedules', label: 'Schedules', icon: 'schedules' },
  { id: 'settings', label: 'Settings', icon: 'settings' }
] as const;
export type Page = typeof pages[number]['id'];

export interface Notice { kind: 'success' | 'info' | 'error'; text: string }

function Dashboard() {
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>(() => (pages.find((item) => `#${item.id}` === location.hash)?.id ?? 'overview'));
  const [editing, setEditing] = useState<WebsiteRule>();
  const [notice, setNotice] = useState<Notice>();
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    const result = await send<AppState>({ type: 'GET_STATE' });
    if (!result.ok) return setNotice({ kind: 'error', text: result.error });
    if (!result.data.onboardingComplete) { location.replace(chrome.runtime.getURL('onboarding.html')); return; }
    setState(result.data);
  }, []);

  useEffect(() => {
    void load();
    // Live updates from the background (usage, overrides ending, pending changes applying).
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes[STATE_KEY]?.newValue) setState(migrateState(changes[STATE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => { chrome.storage.onChanged.removeListener(listener); clearInterval(id); };
  }, [load]);

  useEffect(() => { history.replaceState(null, '', `#${page}`); setNotice(undefined); }, [page]);

  if (!state) return <main className="main"><p className="muted">Loading Screentime…</p></main>;
  const title = pages.find((item) => item.id === page)!.label;

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="mark"><Icon name="lock" size={16}/></div><span>Screentime</span></div>
      <nav className="nav" aria-label="Sections">{pages.map((item) => <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => setPage(item.id)}><Icon name={item.icon}/><span>{item.label}</span></button>)}</nav>
      <p className="sidebar-foot muted">Stored only in this browser.</p>
    </aside>
    <main className="main">
      <header className="page-head">
        <div><span className="eyebrow">Screentime</span><h1>{title}</h1></div>
        {(page === 'limits' || page === 'schedules') && <button className="button" onClick={() => setEditing(blankRule(page === 'schedules' ? 'schedule' : 'limit'))}><Icon name="plus" size={16}/> Add website</button>}
      </header>
      {notice && <div className={`banner ${notice.kind}`} role="status">{notice.text}<button className="banner-close" aria-label="Dismiss" onClick={() => setNotice(undefined)}>×</button></div>}
      {page === 'overview' && <Overview state={state} now={now} onNavigate={setPage}/>}
      {page === 'feeds' && <Feeds state={state} onChange={setState}/>}
      {(page === 'limits' || page === 'schedules') && <RuleList kind={page === 'limits' ? 'limit' : 'schedule'} state={state} now={now} onEdit={setEditing} onState={setState} onNotice={setNotice}/>}
      {page === 'settings' && <Settings state={state} onState={setState} onNotice={setNotice}/>}
    </main>
    {editing && <RuleEditor
      initial={editing}
      existing={state.rules.find((rule) => rule.id === editing.id)}
      onCancel={() => setEditing(undefined)}
      onSaved={(next, text, kind) => { setState(next); setNotice({ kind, text }); setEditing(undefined); }}
    />}
  </div>;
}

createRoot(document.getElementById('root')!).render(<Dashboard/>);
