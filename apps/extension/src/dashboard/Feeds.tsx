import React from 'react';
import { send } from '@browser/messages';
import { feedLabels, siteDefinitions } from '@feeds/index';
import type { AppState, FeedSettings } from '@shared/index';

function Switch({ on, label, onToggle, disabled }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`switch ${on ? 'on' : ''}`} onClick={onToggle}/>;
}

export function Feeds({ state, onChange }: { state: AppState; onChange: (state: AppState) => void }) {
  const settings = state.feedSettings;
  async function update(next: FeedSettings) {
    onChange({ ...state, feedSettings: next });
    const result = await send<AppState>({ type: 'SET_FEEDS', feedSettings: next });
    if (result.ok) onChange(result.data);
  }
  return <>
    <section className="card settings-block">
      <div className="row spread">
        <div><h3>Feed blocker</h3><p className="muted">Hide endless feeds while keeping search, direct links, channels and profiles usable. Feed blocking is separate from time limits and schedules, and isn’t locked by commitments.</p></div>
        <Switch on={settings.globalEnabled} label="Feed blocker for all sites" onToggle={() => update({ ...settings, globalEnabled: !settings.globalEnabled })}/>
      </div>
    </section>
    <div className="feed-grid">
      {siteDefinitions.map((definition) => {
        const labels = feedLabels(definition.site);
        return <section className={`card feed-site ${settings.globalEnabled ? '' : 'dimmed'}`} key={definition.site}>
          <h3>{definition.name}</h3>
          {Object.entries(labels).map(([key, label]) => {
            const on = Boolean(settings.sites[definition.site][key]);
            return <div className="feed-toggle" key={key}>
              <span>Hide {label.toLowerCase()}</span>
              <Switch on={on} disabled={!settings.globalEnabled} label={`Hide ${definition.name} ${label}`} onToggle={() => update({ ...settings, sites: { ...settings.sites, [definition.site]: { ...settings.sites[definition.site], [key]: !on } } })}/>
            </div>;
          })}
        </section>;
      })}
    </div>
    <p className="muted small">Sites change their layouts often. If a feed reappears after a site update, the selector table in <code>packages/feed-blockers</code> needs a refresh.</p>
  </>;
}
