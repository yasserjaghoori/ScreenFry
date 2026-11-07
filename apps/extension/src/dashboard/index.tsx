import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { send } from '@browser/messages';
import { localDateKey } from '@core/date';
import { normalizeDomain } from '@core/domains';
import type { AppState, DayOfWeek, FeedSite, WebsiteRule, WeeklySchedule } from '@shared/index';
import '../styles/global.css';
import '../styles/dashboard.css';

const icons: Record<string, string> = { overview: '◫', feeds: '◎', limits: '◷', schedules: '◴', settings: '⚙' };
const pages = ['overview', 'feeds', 'limits', 'schedules', 'settings'] as const;
type Page = typeof pages[number];
const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const friendlySite: Record<FeedSite, string> = { youtube: 'YouTube', x: 'X / Twitter', instagram: 'Instagram', reddit: 'Reddit', facebook: 'Facebook', linkedin: 'LinkedIn' };
const formatDuration = (ms: number) => ms < 60_000 ? '<1m' : `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms % 3_600_000 / 60_000)}m`.replace(/^0h /, '');
const formatDate = (ms?: number) => ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Not committed';

function blankRule(): WebsiteRule {
  const now = Date.now();
  return { id: crypto.randomUUID(), label: '', domains: [], enabled: true, dailyAllowance: { defaultMinutes: 30 }, schedules: [], enforcementMode: 'pin', createdAt: now, updatedAt: now };
}

function Dashboard() {
  const [state, setState] = useState<AppState>();
  const [page, setPage] = useState<Page>('overview');
  const [editing, setEditing] = useState<WebsiteRule>();
  const [message, setMessage] = useState('');
  const load = () => send<AppState>({ type: 'GET_STATE' }).then((result) => result.data && setState(result.data));
  useEffect(() => { void load(); }, []);
  const today = useMemo(() => state?.usage[localDateKey(new Date())], [state]);
  if (!state) return <main className="main"><p>Loading Screentime…</p></main>;
  const used = Object.values(today?.millisecondsByRule ?? {}).reduce((sum, value) => sum + value, 0);
  const activeRules = state.rules.filter((rule) => rule.enabled).length;
  const committedRules = state.rules.filter((rule) => rule.commitmentEndsAt && rule.commitmentEndsAt > Date.now()).length;

  async function saveRule(rule: WebsiteRule) {
    const result = await send<{ state: AppState; outcome: string }>({ type: 'SAVE_RULE', rule });
    if (result.ok && result.data) {
      setState(result.data.state);
      setMessage(result.data.outcome === 'pending' ? 'This weakening change is queued until the commitment ends.' : 'Restriction saved.');
      setEditing(undefined);
    } else setMessage(result.error ?? 'Unable to save.');
  }

  async function updateFeeds(next: AppState['feedSettings']) {
    setState({ ...state!, feedSettings: next });
    await send({ type: 'SET_FEEDS', feedSettings: next });
  }

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="mark">S</div><span>Screentime</span></div>
      <nav className="nav">{pages.map((item) => <button key={item} className={page === item ? 'active' : ''} onClick={() => setPage(item)}><b>{icons[item]}</b><span>{item[0].toUpperCase() + item.slice(1)}</span></button>)}</nav>
    </aside>
    <main className="main">
      <header className="page-head"><div><span className="eyebrow">Your digital space</span><h1>{page[0].toUpperCase() + page.slice(1)}</h1></div>{['limits', 'schedules'].includes(page) && <button className="button" onClick={() => setEditing(blankRule())}>Add restriction</button>}</header>
      {message && <p className={message.includes('queued') ? 'error' : 'success'}>{message}</p>}
      {page === 'overview' && <div className="grid">
        <div className="card metric"><span className="muted">Tracked today</span><div className="value">{formatDuration(used)}</div></div>
        <div className="card metric"><span className="muted">Active restrictions</span><div className="value">{activeRules}</div></div>
        <div className="card metric"><span className="muted">Sealed commitments</span><div className="value">{committedRules}</div></div>
        <section className="card section-card"><h2 className="section-title">Today by website</h2>{state.rules.length ? state.rules.map((rule) => {
          const value = today?.millisecondsByRule[rule.id] ?? 0;
          const max = (rule.dailyAllowance?.defaultMinutes ?? 60) * 60_000;
          return <div className="usage-row" key={rule.id}><strong>{rule.label}</strong><div className="bar"><i style={{ width: `${Math.min(100, value / max * 100)}%` }}/></div><span>{formatDuration(value)}</span></div>;
        }) : <div className="empty">Add your first website limit to begin.</div>}</section>
        <aside className="card side-card"><h2 className="section-title">Protection</h2><div className="protection"><span>◈</span><div><strong>{state.protection.privateAccess === 'verified' ? 'Sealproof-ready' : 'Standard coverage'}</strong><div className="muted">{state.protection.privateAccess === 'verified' ? 'Incognito access verified' : 'Incognito access needs verification'}</div></div></div><p className="muted">Data stays on this browser. No account or cloud tracking.</p></aside>
        <section className="card section-card"><h2 className="section-title">Recent overrides</h2>{state.overrideHistory.slice(0, 5).map((entry) => <div className="usage-row" key={entry.id}><strong>{state.rules.find((rule) => rule.id === entry.ruleId)?.label ?? 'Website'}</strong><div className="muted">10-minute PIN session</div><span>{new Date(entry.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>)}{!state.overrideHistory.length && <div className="empty">No PIN overrides yet.</div>}</section>
      </div>}
      {page === 'feeds' && <section className="card settings-block"><div className="row spread"><div><h3>Feed blocker</h3><p className="muted">Hide noisy feeds while keeping search and direct links useful.</p></div><button aria-label="Toggle all feeds" className={`switch ${state.feedSettings.globalEnabled ? 'on' : ''}`} onClick={() => updateFeeds({ ...state.feedSettings, globalEnabled: !state.feedSettings.globalEnabled })}/></div>{(Object.keys(state.feedSettings.sites) as FeedSite[]).map((site) => <div className="feed-site" key={site}><strong>{friendlySite[site]}</strong><div className="feed-controls">{Object.entries(state.feedSettings.sites[site]).map(([element, enabled]) => <label className="feed-toggle" key={element}><input type="checkbox" checked={enabled} onChange={() => updateFeeds({ ...state.feedSettings, sites: { ...state.feedSettings.sites, [site]: { ...state.feedSettings.sites[site], [element]: !enabled } } })}/>{element.replace(/([A-Z])/g, ' $1')}</label>)}</div></div>)}</section>}
      {(page === 'limits' || page === 'schedules') && <RuleList rules={state.rules} state={state} onEdit={setEditing} onDelete={async (ruleId) => { const result = await send<AppState>({ type: 'DELETE_RULE', ruleId }); if (result.data) setState(result.data); }} />}
      {page === 'settings' && <Settings state={state} onChange={setState}/>} 
    </main>
    {editing && <RuleEditor initial={editing} onCancel={() => setEditing(undefined)} onSave={saveRule}/>} 
  </div>;
}

function RuleList({ rules, state, onEdit, onDelete }: { rules: WebsiteRule[]; state: AppState; onEdit: (rule: WebsiteRule) => void; onDelete: (id: string) => void }) {
  return <div className="list">{rules.map((rule) => { const committed = Boolean(rule.commitmentEndsAt && rule.commitmentEndsAt > Date.now()); const used = state.usage[localDateKey(new Date())]?.millisecondsByRule[rule.id] ?? 0; return <div className="card rule" key={rule.id}><div className="row spread"><div><h3>{rule.label}</h3><span className="muted">{rule.domains.join(', ')}</span></div><div className="toolbar"><button className="button secondary" onClick={() => onEdit(rule)}>Edit</button><button className="button ghost danger" onClick={() => onDelete(rule.id)}>{committed ? 'Queue removal' : 'Remove'}</button></div></div><div className="rule-meta">{rule.dailyAllowance && <span className="pill">{rule.dailyAllowance.defaultMinutes} min daily</span>}{rule.schedules.length > 0 && <span className="pill">{rule.schedules.length} schedule{rule.schedules.length > 1 ? 's' : ''}</span>}<span className={`pill ${committed ? 'warn' : ''}`}>{committed ? `Sealed until ${formatDate(rule.commitmentEndsAt)}` : 'Editable'}</span><span className="pill">{formatDuration(used)} today</span></div>{rule.pendingChange && <div className="locked-note">A requested change will apply {formatDate(rule.pendingChange.applyAt)}.</div>}</div>; })}{!rules.length && <div className="empty">No restrictions yet. Add one to protect focused time.</div>}</div>;
}

function RuleEditor({ initial, onCancel, onSave }: { initial: WebsiteRule; onCancel: () => void; onSave: (rule: WebsiteRule) => void }) {
  const [rule, setRule] = useState(structuredClone(initial));
  const [domain, setDomain] = useState(initial.domains[0] ?? '');
  const [commitment, setCommitment] = useState(initial.commitmentEndsAt ? 'keep' : 'none');
  const schedule = rule.schedules[0];
  function setSchedule(patch: Partial<WeeklySchedule>) {
    const base: WeeklySchedule = schedule ?? { id: crypto.randomUUID(), days: [1,2,3,4,5], startMinute: 9 * 60, endMinute: 17 * 60 };
    setRule({ ...rule, schedules: [{ ...base, ...patch }] });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = normalizeDomain(domain);
    const durations: Record<string, number | undefined> = { none: undefined, today: new Date(new Date().setHours(23,59,59,999)).getTime(), week: Date.now() + 7 * 86400_000, month: Date.now() + 30 * 86400_000, keep: initial.commitmentEndsAt };
    onSave({ ...rule, label: rule.label || normalized, domains: normalized === 'youtu.be' || normalized.includes('youtube') ? ['youtube.com', 'youtu.be', 'youtube-nocookie.com'] : [normalized], commitmentEndsAt: durations[commitment], updatedAt: Date.now() });
  }
  const toTime = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}`;
  const fromTime = (value: string) => { const [h,m] = value.split(':').map(Number); return h * 60 + m; };
  return <div className="modal-backdrop"><form className="card modal" onSubmit={submit}><div className="row spread"><h2>Website restriction</h2><button type="button" className="button ghost" onClick={onCancel}>Close</button></div><div className="form-grid"><div className="field"><label>Name</label><input required value={rule.label} placeholder="YouTube" onChange={(event) => setRule({ ...rule, label: event.target.value })}/></div><div className="field"><label>Website</label><input required value={domain} placeholder="youtube.com" onChange={(event) => setDomain(event.target.value)}/></div><div className="field"><label>Daily allowance</label><input type="number" min="1" max="1440" value={rule.dailyAllowance?.defaultMinutes ?? ''} onChange={(event) => setRule({ ...rule, dailyAllowance: event.target.value ? { defaultMinutes: Number(event.target.value) } : undefined })}/></div><div className="field"><label>Commitment</label><select value={commitment} onChange={(event) => setCommitment(event.target.value)}>{initial.commitmentEndsAt && <option value="keep">Keep current end</option>}<option value="none">No lock</option><option value="today">Until end of today</option><option value="week">7 days</option><option value="month">30 days</option></select></div><div className="wide field"><label>Scheduled block (optional)</label><div className="row"><input type="time" value={toTime(schedule?.startMinute ?? 540)} onChange={(event) => setSchedule({ startMinute: fromTime(event.target.value) })}/><span>to</span><input type="time" value={toTime(schedule?.endMinute ?? 1020)} onChange={(event) => setSchedule({ endMinute: fromTime(event.target.value) })}/><button type="button" className="button secondary" onClick={() => setRule({ ...rule, schedules: schedule ? [] : [{ id: crypto.randomUUID(), days: [1,2,3,4,5], startMinute: 540, endMinute: 1020 }] })}>{schedule ? 'Remove schedule' : 'Add schedule'}</button></div>{schedule && <div className="day-pills">{dayNames.map((name, index) => <button type="button" key={`${name}-${index}`} className={schedule.days.includes(index as DayOfWeek) ? 'selected' : ''} onClick={() => setSchedule({ days: schedule.days.includes(index as DayOfWeek) ? schedule.days.filter((day) => day !== index) : [...schedule.days, index as DayOfWeek] })}>{name}</button>)}</div>}</div><label className="wide row"><input type="checkbox" checked={rule.enabled} onChange={(event) => setRule({ ...rule, enabled: event.target.checked })}/>Restriction enabled</label></div><p className="muted">While sealed, stricter changes apply immediately. Looser changes wait until the commitment ends. The PIN only grants a 10-minute visit.</p><div className="row"><button className="button" type="submit">Save restriction</button><button className="button secondary" type="button" onClick={onCancel}>Cancel</button></div></form></div>;
}

function Settings({ state, onChange }: { state: AppState; onChange: (state: AppState) => void }) {
  const [status, setStatus] = useState('');
  async function refresh() { const result = await send<AppState>({ type: 'REFRESH_PROTECTION' }); if (result.data) { onChange(result.data); setStatus(result.data.protection.privateAccess === 'verified' ? 'Incognito access is verified.' : 'Enable “Allow in Incognito” on chrome://extensions, then check again.'); } }
  return <><section className="card settings-block"><h3>Browser protection</h3><div className="row spread"><div><strong>{state.protection.privateAccess === 'verified' ? 'Sealproof-ready' : 'Private browsing not verified'}</strong><p className="muted">Chrome cannot enable Incognito access for you.</p></div><button className="button secondary" onClick={refresh}>Check access</button></div>{status && <p>{status}</p>}</section><section className="card settings-block"><h3>PIN and privacy</h3><p>Your six-digit PIN is stored only as a salted, slow PBKDF2 verifier. It cannot permanently weaken a live commitment.</p><p className="muted">There is no PIN recovery shortcut. If you forget it, reinstalling the extension clears local data, which browser extensions cannot prevent.</p></section><section className="card settings-block"><h3>Local data</h3><p className="muted">Usage, rules, and overrides remain in this browser. Chrome and Safari do not share counters in Phase 1. Active commitments deliberately cannot be deleted from ordinary settings.</p></section></>;
}

createRoot(document.getElementById('root')!).render(<Dashboard/>);
