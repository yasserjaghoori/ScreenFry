import React from 'react';
import { send } from '@browser/messages';
import { isCommitted } from '@core/commitments';
import { localDateKey } from '@core/date';
import { evaluateRule } from '@policy/index';
import type { AppState, WebsiteRule } from '@shared/index';
import { Icon } from '../ui/Icon';
import { DAY_SHORT, describeDays, formatDate, formatDuration, formatMinuteOfDay, formatMinutes, formatWhen } from '../ui/format';
import type { Notice } from './index';

export function describePatch(rule: WebsiteRule): string {
  const patch = rule.pendingChange?.patch;
  if (!patch) return '';
  if (patch.remove) return 'Remove this restriction';
  const parts: string[] = [];
  if (patch.enabled === false && rule.enabled) parts.push('turn it off');
  if (patch.dailyAllowance?.defaultMinutes !== rule.dailyAllowance?.defaultMinutes || JSON.stringify(patch.dailyAllowance?.byWeekday) !== JSON.stringify(rule.dailyAllowance?.byWeekday)) {
    parts.push(patch.dailyAllowance ? `change the allowance to ${formatMinutes(patch.dailyAllowance.defaultMinutes)}` : 'remove the daily allowance');
  }
  if (JSON.stringify(patch.schedules) !== JSON.stringify(rule.schedules)) parts.push('change the schedules');
  if (JSON.stringify(patch.domains) !== JSON.stringify(rule.domains)) parts.push('change the websites');
  return parts.length ? parts.join(', ').replace(/^./, (c) => c.toUpperCase()) : 'Update this restriction';
}

export function RuleList({ kind, state, now, onEdit, onState, onNotice }: {
  kind: 'limit' | 'schedule'; state: AppState; now: number;
  onEdit: (rule: WebsiteRule) => void; onState: (state: AppState) => void; onNotice: (notice: Notice) => void;
}) {
  const rules = state.rules.filter((rule) => (kind === 'limit' ? rule.dailyAllowance : rule.schedules.length));

  async function remove(rule: WebsiteRule) {
    const committed = isCommitted(rule, now);
    const question = committed
      ? `${rule.label} is sealed until ${formatDate(rule.commitmentEndsAt)}. Request removal? It stays active until then.`
      : `Remove the ${rule.label} restriction? Its usage history is kept.`;
    if (!confirm(question)) return;
    const result = await send<{ state: AppState; outcome: string }>({ type: 'DELETE_RULE', ruleId: rule.id });
    if (!result.ok) return onNotice({ kind: 'error', text: result.error });
    onState(result.data.state);
    onNotice(result.data.outcome === 'pending'
      ? { kind: 'info', text: `Removal requested. ${rule.label} stays sealed until ${formatDate(rule.commitmentEndsAt)}.` }
      : { kind: 'success', text: `${rule.label} restriction removed.` });
  }

  async function withdraw(rule: WebsiteRule) {
    const result = await send<AppState>({ type: 'CANCEL_PENDING', ruleId: rule.id });
    if (!result.ok) return onNotice({ kind: 'error', text: result.error });
    onState(result.data);
    onNotice({ kind: 'success', text: 'Request withdrawn. The current rule stays as it is.' });
  }

  if (!rules.length) {
    return <div className="empty large">
      <h3>{kind === 'limit' ? 'No daily limits yet' : 'No schedules yet'}</h3>
      <p className="muted">{kind === 'limit' ? 'Give a website a daily allowance. Time counts only while its tab is active, the window is focused and you’re present.' : 'Make a website unavailable at set times, such as weekdays 9 AM–5 PM or every night 10 PM–7 AM.'}</p>
    </div>;
  }

  return <div className="list">{rules.map((rule) => {
    const committed = isCommitted(rule, now);
    const decision = evaluateRule(state, rule, now);
    const weekday = rule.dailyAllowance?.byWeekday ?? {};
    return <article className="card rule" key={rule.id}>
      <div className="row spread wrap">
        <div>
          <h3>{rule.label} {committed && <span className="lock-badge" title="Sealed commitment"><Icon name="lock" size={13}/></span>}</h3>
          <span className="muted small">{rule.domains.join(', ')}</span>
        </div>
        <div className="toolbar">
          <button className="button secondary" onClick={() => onEdit(rule)}>Edit</button>
          {rule.pendingChange?.patch.remove ? null : <button className="button ghost danger" onClick={() => remove(rule)}>{committed ? 'Request removal' : 'Remove'}</button>}
        </div>
      </div>
      <div className="rule-meta">
        {!rule.enabled && <span className="pill muted-pill">Off</span>}
        {rule.dailyAllowance && <span className="pill">{formatMinutes(rule.dailyAllowance.defaultMinutes)} daily</span>}
        {Object.entries(weekday).map(([day, minutes]) => <span className="pill subtle" key={day}>{DAY_SHORT[Number(day)]} {formatMinutes(minutes!)}</span>)}
        {rule.schedules.map((schedule) => <span className="pill subtle" key={schedule.id}>{describeDays(schedule.days)} · {schedule.startMinute === schedule.endMinute ? 'all day' : `${formatMinuteOfDay(schedule.startMinute)}–${formatMinuteOfDay(schedule.endMinute)}`}</span>)}
        <span className={`pill ${committed ? 'warn' : 'muted-pill'}`}>{committed ? `Sealed until ${formatDate(rule.commitmentEndsAt)}` : 'Not sealed · editable'}</span>
      </div>
      {rule.enabled && <div className="rule-status">
        {decision.status === 'blocked' && <span><strong>Sealed now</strong> · available {formatWhen(decision.nextAccessAt, now)}</span>}
        {decision.status === 'temporarily-unlocked' && <span><strong>Temporary PIN visit</strong> · ends {formatWhen(decision.overrideExpiresAt, now)}</span>}
        {decision.status === 'allowed' && decision.remainingMilliseconds !== undefined && <span>{formatDuration(decision.remainingMilliseconds)} left today · {formatDuration(state.usage[localDateKey(new Date(now))]?.millisecondsByRule[rule.id] ?? 0)} used</span>}
        {decision.status === 'allowed' && decision.remainingMilliseconds === undefined && <span>Available now</span>}
      </div>}
      {rule.pendingChange && <div className="locked-note">
        <span><strong>Requested change:</strong> {describePatch(rule)}. Applies {formatWhen(Math.max(rule.pendingChange.applyAt, rule.commitmentEndsAt ?? 0), now)}.</span>
        <button className="link" onClick={() => withdraw(rule)}>Withdraw request</button>
      </div>}
    </article>;
  })}</div>;
}
