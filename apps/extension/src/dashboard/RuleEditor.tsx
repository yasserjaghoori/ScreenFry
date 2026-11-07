import React, { useMemo, useState } from 'react';
import { send } from '@browser/messages';
import { isCommitted, weakeningReasons } from '@core/commitments';
import { endOfLocalDay } from '@core/date';
import { expandDomainAliases, isValidDomain, normalizeDomain } from '@core/domains';
import type { AppState, DayOfWeek, WebsiteRule, WeeklySchedule } from '@shared/index';
import { DAY_LETTER, DAY_SHORT, formatDate, fromTimeInput, toTimeInput } from '../ui/format';

export function blankRule(kind: 'limit' | 'schedule'): WebsiteRule {
  const now = Date.now();
  return {
    id: crypto.randomUUID(), label: '', domains: [], enabled: true,
    dailyAllowance: kind === 'limit' ? { defaultMinutes: 30 } : undefined,
    schedules: kind === 'schedule' ? [newSchedule()] : [],
    enforcementMode: 'pin', createdAt: now, updatedAt: now
  };
}

const newSchedule = (): WeeklySchedule => ({ id: crypto.randomUUID(), days: [1, 2, 3, 4, 5], startMinute: 9 * 60, endMinute: 17 * 60 });

type Commitment = 'keep' | 'none' | 'today' | 'week' | 'month' | 'custom';
const toLocalInput = (ms: number) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

export function RuleEditor({ initial, existing, onCancel, onSaved }: {
  initial: WebsiteRule; existing?: WebsiteRule; onCancel: () => void;
  onSaved: (state: AppState, message: string, kind: 'success' | 'info') => void;
}) {
  const now = Date.now();
  const [rule, setRule] = useState<WebsiteRule>(() => structuredClone(initial));
  const [domainText, setDomainText] = useState(initial.domains.join(', '));
  const [commitment, setCommitment] = useState<Commitment>(initial.commitmentEndsAt && initial.commitmentEndsAt > now ? 'keep' : 'none');
  const [customEnd, setCustomEnd] = useState(toLocalInput(now + 14 * 86_400_000));
  const [perWeekday, setPerWeekday] = useState(Boolean(initial.dailyAllowance?.byWeekday && Object.keys(initial.dailyAllowance.byWeekday).length));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const committed = Boolean(existing && isCommitted(existing, now));

  const commitmentEndsAt = useMemo(() => {
    const at = Date.now();
    switch (commitment) {
      case 'keep': return initial.commitmentEndsAt;
      case 'today': return endOfLocalDay(new Date(at));
      case 'week': return at + 7 * 86_400_000;
      case 'month': return at + 30 * 86_400_000;
      case 'custom': return customEnd ? new Date(customEnd).getTime() : undefined;
      default: return undefined;
    }
  }, [commitment, customEnd, initial.commitmentEndsAt]);

  const domains = useMemo(() => expandDomainAliases(domainText.split(/[\s,]+/).map(normalizeDomain).filter(Boolean)), [domainText]);
  const candidate: WebsiteRule = { ...rule, label: rule.label.trim() || domains[0] || '', domains, commitmentEndsAt };
  const reasons = existing && committed ? weakeningReasons(existing, candidate) : [];

  const setAllowance = (patch: Partial<NonNullable<WebsiteRule['dailyAllowance']>>) => setRule({ ...rule, dailyAllowance: { defaultMinutes: 30, ...rule.dailyAllowance, ...patch } });
  const setSchedule = (index: number, patch: Partial<WeeklySchedule>) => setRule({ ...rule, schedules: rule.schedules.map((schedule, i) => (i === index ? { ...schedule, ...patch } : schedule)) });

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!domains.length || !domains.every(isValidDomain)) return setError('Enter a valid website, such as youtube.com.');
    if (!candidate.dailyAllowance && !candidate.schedules.length) return setError('Add a daily allowance or at least one schedule.');
    if (candidate.schedules.some((schedule) => !schedule.days.length)) return setError('Pick at least one day for each schedule.');
    if (commitment === 'custom' && (!commitmentEndsAt || commitmentEndsAt <= Date.now())) return setError('Choose a commitment end in the future.');
    const allowance = candidate.dailyAllowance && !perWeekday ? { defaultMinutes: candidate.dailyAllowance.defaultMinutes } : candidate.dailyAllowance;
    setSaving(true);
    const result = await send<{ state: AppState; outcome: 'created' | 'applied' | 'pending' }>({ type: 'SAVE_RULE', rule: { ...candidate, dailyAllowance: allowance } });
    setSaving(false);
    if (!result.ok) return setError(result.error);
    const { outcome, state } = result.data;
    if (outcome === 'pending') onSaved(state, `Your request is saved. ${candidate.label} stays sealed as it is until ${formatDate(existing?.commitmentEndsAt)}, then the change applies.`, 'info');
    else onSaved(state, outcome === 'created' ? `${candidate.label} restriction added.` : `${candidate.label} restriction updated.`, 'success');
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <form className="card modal" onSubmit={submit} aria-labelledby="editor-title">
      <div className="row spread"><h2 id="editor-title">{existing ? `Edit ${existing.label}` : 'New restriction'}</h2><button type="button" className="button ghost" onClick={onCancel}>Close</button></div>
      {committed && <div className="banner info">Sealed until <strong>{formatDate(existing!.commitmentEndsAt)}</strong>. Stricter changes apply now; anything looser is saved as a request and applies when the commitment ends.</div>}

      <div className="form-grid">
        <div className="field"><label htmlFor="rule-name">Name</label><input id="rule-name" value={rule.label} placeholder="YouTube" maxLength={60} onChange={(event) => setRule({ ...rule, label: event.target.value })}/></div>
        <div className="field"><label htmlFor="rule-domains">Websites</label><input id="rule-domains" required value={domainText} placeholder="youtube.com" onChange={(event) => setDomainText(event.target.value)}/></div>
        {domains.length > 0 && <p className="wide muted small">Covers {domains.join(', ')} and their subdomains (for example m. and www.).</p>}

        <fieldset className="wide group">
          <legend><label className="check"><input type="checkbox" checked={Boolean(rule.dailyAllowance)} onChange={(event) => setRule({ ...rule, dailyAllowance: event.target.checked ? { defaultMinutes: 30 } : undefined })}/> Daily allowance</label></legend>
          {rule.dailyAllowance && <>
            <div className="row wrap">
              <input type="number" aria-label="Minutes per day" min={0} max={1440} value={rule.dailyAllowance.defaultMinutes} onChange={(event) => setAllowance({ defaultMinutes: Math.max(0, Math.min(1440, Number(event.target.value) || 0)) })}/>
              <span className="muted">minutes per day{rule.dailyAllowance.defaultMinutes >= 60 ? ` (${Math.floor(rule.dailyAllowance.defaultMinutes / 60)}h ${rule.dailyAllowance.defaultMinutes % 60}m)` : ''}</span>
              <label className="check"><input type="checkbox" checked={perWeekday} onChange={(event) => { setPerWeekday(event.target.checked); if (!event.target.checked) setAllowance({ byWeekday: undefined }); }}/> Different by weekday</label>
            </div>
            {perWeekday && <div className="weekday-grid">{DAY_SHORT.map((name, day) => <label key={name} className="field compact"><span>{name}</span><input type="number" min={0} max={1440} placeholder={String(rule.dailyAllowance!.defaultMinutes)} value={rule.dailyAllowance!.byWeekday?.[day as DayOfWeek] ?? ''} onChange={(event) => {
              const byWeekday = { ...(rule.dailyAllowance!.byWeekday ?? {}) };
              if (event.target.value === '') delete byWeekday[day as DayOfWeek];
              else byWeekday[day as DayOfWeek] = Math.max(0, Math.min(1440, Number(event.target.value) || 0));
              setAllowance({ byWeekday });
            }}/></label>)}</div>}
            <p className="muted small">Counts only while the site’s tab is active in a focused window and you’re not idle. Resets at local midnight. 0 means no access that day.</p>
          </>}
        </fieldset>

        <fieldset className="wide group">
          <legend>Scheduled blocks</legend>
          {rule.schedules.map((schedule, index) => <div className="schedule-row" key={schedule.id}>
            <div className="day-pills">{DAY_LETTER.map((letter, day) => <button type="button" key={day} aria-label={DAY_SHORT[day]} aria-pressed={schedule.days.includes(day as DayOfWeek)} className={schedule.days.includes(day as DayOfWeek) ? 'selected' : ''} onClick={() => setSchedule(index, { days: schedule.days.includes(day as DayOfWeek) ? schedule.days.filter((d) => d !== day) : [...schedule.days, day as DayOfWeek].sort() as DayOfWeek[] })}>{letter}</button>)}</div>
            <div className="row wrap">
              <input type="time" aria-label="Start time" value={toTimeInput(schedule.startMinute)} onChange={(event) => setSchedule(index, { startMinute: fromTimeInput(event.target.value) })}/>
              <span className="muted">to</span>
              <input type="time" aria-label="End time" value={toTimeInput(schedule.endMinute)} onChange={(event) => setSchedule(index, { endMinute: fromTimeInput(event.target.value) })}/>
              <button type="button" className="button ghost danger" onClick={() => setRule({ ...rule, schedules: rule.schedules.filter((_, i) => i !== index) })}>Remove</button>
            </div>
            {schedule.endMinute < schedule.startMinute && <p className="muted small">Overnight: continues into the next morning.</p>}
            {schedule.endMinute === schedule.startMinute && <p className="muted small">Same start and end blocks the whole day.</p>}
          </div>)}
          <button type="button" className="button secondary" onClick={() => setRule({ ...rule, schedules: [...rule.schedules, newSchedule()] })}>Add schedule</button>
        </fieldset>

        <div className="field">
          <label htmlFor="rule-commitment">Commitment</label>
          <select id="rule-commitment" value={commitment} onChange={(event) => setCommitment(event.target.value as Commitment)}>
            {initial.commitmentEndsAt && initial.commitmentEndsAt > now && <option value="keep">Keep current end ({formatDate(initial.commitmentEndsAt)})</option>}
            <option value="none">{committed ? 'End commitment (request)' : 'No commitment'}</option>
            <option value="today">Until the end of today</option>
            <option value="week">7 days</option>
            <option value="month">30 days</option>
            <option value="custom">Custom end date</option>
          </select>
        </div>
        {commitment === 'custom' ? <div className="field"><label htmlFor="rule-end">Ends</label><input id="rule-end" type="datetime-local" value={customEnd} min={toLocalInput(now + 60_000)} onChange={(event) => setCustomEnd(event.target.value)}/></div>
          : <label className="check field-end"><input type="checkbox" checked={rule.enabled} onChange={(event) => setRule({ ...rule, enabled: event.target.checked })}/> Restriction on</label>}
        {commitment === 'custom' && <label className="check wide"><input type="checkbox" checked={rule.enabled} onChange={(event) => setRule({ ...rule, enabled: event.target.checked })}/> Restriction on</label>}
      </div>

      {reasons.length > 0 && <div className="banner warn">This edit {reasons.join(', ')}. It will be saved as a request and apply on {formatDate(existing!.commitmentEndsAt)}. Until then the current rule stays exactly as it is.</div>}
      {!committed && commitmentEndsAt && <p className="muted small">Once saved, this rule is sealed until {formatDate(commitmentEndsAt)}. You can always make it stricter; looser changes will wait. Your PIN still allows 10-minute visits.</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row"><button className="button" type="submit" disabled={saving}>{saving ? 'Saving…' : reasons.length ? 'Request change' : 'Save restriction'}</button><button className="button secondary" type="button" onClick={onCancel}>Cancel</button></div>
    </form>
  </div>;
}
