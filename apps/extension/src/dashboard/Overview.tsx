import React from 'react';
import { isCommitted } from '@core/commitments';
import { localDateKey } from '@core/date';
import { evaluateRule, upcomingScheduleWindows } from '@policy/index';
import type { AppState } from '@shared/index';
import { protectionLabel } from '../ui/PrivateAccessGuide';
import { Icon } from '../ui/Icon';
import { formatDuration, formatWhen } from '../ui/format';
import type { Page } from './index';

export function Overview({ state, now, onNavigate }: { state: AppState; now: number; onNavigate: (page: Page) => void }) {
  const today = state.usage[localDateKey(new Date(now))];
  const hostTotals = Object.entries(today?.millisecondsByHost ?? {}).sort((a, b) => b[1] - a[1]);
  const tracked = state.trackingEnabled
    ? hostTotals.reduce((sum, [, ms]) => sum + ms, 0)
    : Object.values(today?.millisecondsByRule ?? {}).reduce((sum, ms) => sum + ms, 0);
  const decisions = state.rules.filter((rule) => rule.enabled).map((rule) => ({ rule, decision: evaluateRule(state, rule, now) }));
  const restricted = decisions.filter(({ decision }) => decision.status !== 'allowed');
  const limits = decisions.filter(({ decision }) => decision.allowanceMinutes !== undefined);
  const upcoming = upcomingScheduleWindows(state, now);
  const sealed = state.rules.filter((rule) => isCommitted(rule, now)).length;
  const protection = protectionLabel(state.protection);
  const maxHost = hostTotals[0]?.[1] ?? 1;

  return <div className="grid">
    <div className="card metric"><span className="muted">Tracked today</span><div className="value">{formatDuration(tracked)}</div><span className="muted small">{state.trackingEnabled ? 'Focused, active browsing' : 'Restricted sites only'}</span></div>
    <div className="card metric"><span className="muted">Restricted right now</span><div className="value">{restricted.length}</div><span className="muted small">of {decisions.length} active rules</span></div>
    <div className="card metric"><span className="muted">Sealed commitments</span><div className="value">{sealed}</div><span className="muted small">Can only get stricter</span></div>

    {state.possibleClockRollbackAt && <div className="banner info span-12">Your system clock moved backwards on {new Date(state.possibleClockRollbackAt).toLocaleString()}. Screentime keeps using the current clock; temporary visits that appeared to start in the future were cancelled.</div>}

    <section className="card section-card">
      <h2 className="section-title">Remaining daily limits</h2>
      {limits.length ? limits.map(({ rule, decision }) => {
        const allowance = decision.allowanceMinutes! * 60_000;
        const used = allowance - (decision.remainingMilliseconds ?? 0);
        return <div className="usage-row" key={rule.id}>
          <strong>{rule.label}</strong>
          <div className={`bar ${decision.status === 'blocked' ? 'full' : ''}`}><i style={{ width: `${allowance ? Math.min(100, (used / allowance) * 100) : 100}%` }}/></div>
          <span>{decision.status === 'blocked' ? 'Sealed' : `${formatDuration(decision.remainingMilliseconds ?? 0)} left`}</span>
        </div>;
      }) : <div className="empty">No daily limits yet. <button className="link" onClick={() => onNavigate('limits')}>Add one</button></div>}
    </section>

    <aside className="card side-card">
      <h2 className="section-title">Browser protection</h2>
      <div className={`protection ${protection.ready ? 'ok' : 'warn'}`}><Icon name="shield" size={22}/><div><strong>{protection.title}</strong><div className="muted small">{protection.detail}</div></div></div>
      {!protection.ready && <button className="button secondary block" onClick={() => onNavigate('settings')}>Set up private browsing</button>}
      <p className="muted small">Limits, usage and PIN are separate in each browser during Phase 1.</p>
    </aside>

    <section className="card section-card">
      <h2 className="section-title">Usage by website</h2>
      {state.trackingEnabled ? (hostTotals.length ? hostTotals.slice(0, 8).map(([host, ms]) => <div className="usage-row" key={host}>
        <strong title={host}>{host}</strong><div className="bar subtle"><i style={{ width: `${(ms / maxHost) * 100}%` }}/></div><span>{formatDuration(ms)}</span>
      </div>) : <div className="empty">Browse for a while and your focused time will appear here.</div>)
        : <div className="empty">General history is off. Restricted sites are still measured so limits work. <button className="link" onClick={() => onNavigate('settings')}>Change</button></div>}
    </section>

    <aside className="card side-card">
      <h2 className="section-title">Active restrictions</h2>
      {restricted.length ? restricted.map(({ rule, decision }) => <div className="mini-row" key={rule.id}>
        <strong>{rule.label}</strong>
        <span className="muted small">{decision.status === 'temporarily-unlocked' ? 'Temporary PIN visit' : decision.reasons.includes('schedule') ? 'Scheduled block' : 'Daily limit reached'} · until {formatWhen(decision.status === 'temporarily-unlocked' ? decision.overrideExpiresAt : decision.nextAccessAt, now)}</span>
      </div>) : <p className="muted">Nothing is sealed right now.</p>}
      <h2 className="section-title spaced">Upcoming schedules</h2>
      {upcoming.length ? upcoming.slice(0, 5).map((window) => <div className="mini-row" key={window.ruleId}><strong>{window.label}</strong><span className="muted small">Starts {formatWhen(window.startsAt, now)}{window.endsAt ? `, ends ${formatWhen(window.endsAt, now)}` : ''}</span></div>)
        : <p className="muted">No scheduled blocks in the next 24 hours.</p>}
    </aside>

    <section className="card section-card span-12">
      <h2 className="section-title">Recent PIN visits</h2>
      {state.overrideHistory.slice(0, 6).map((entry) => <div className="usage-row" key={entry.id}>
        <strong>{entry.label}</strong><span className="muted">10-minute visit · {formatDuration((today?.overrideMillisecondsByRule[entry.ruleId] ?? 0))} used today</span><span>{new Date(entry.startedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}</span>
      </div>)}
      {!state.overrideHistory.length && <div className="empty">No PIN visits yet.</div>}
    </section>
  </div>;
}
