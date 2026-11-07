import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send, setSettingsCredential } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { migrateState } from "@core/defaults";
import { launchSites } from "@core/sites";
import type { AppState, FeedSite } from "@shared/index";
import { Icon } from "../ui/Icon";
import { SiteControls } from "../ui/SiteControls";
import { SettingsGate } from "../ui/SettingsGate";
import { siteStatus } from "../ui/siteStatus";
import { Windows } from "./Windows";
import { Settings } from "./Settings";
import "../styles/global.css";
import "../styles/dashboard.css";
const pages = [
  { id: "websites", label: "Websites", icon: "feeds" },
  { id: "windows", label: "Windows", icon: "schedules" },
  { id: "settings", label: "Settings", icon: "settings" },
] as const;
export interface Notice {
  kind: "success" | "info" | "error";
  text: string;
}
function Dashboard() {
  const [state, setState] = useState<AppState>(),
    [page, setPage] = useState(
      () => pages.find((p) => `#${p.id}` === location.hash)?.id ?? "websites",
    );
  const [site, setSite] = useState<FeedSite>(
    () =>
      launchSites.find(
        (s) => s.id === new URLSearchParams(location.search).get("site"),
      )?.id ?? "youtube",
  );
  const [notice, setNotice] = useState<Notice>(),
    [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    void send<AppState>({ type: "GET_STATE" }).then((r) =>
      r.ok ? setState(r.data) : setNotice({ kind: "error", text: r.error }),
    );
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STATE_KEY]?.newValue)
        setState(migrateState(changes[STATE_KEY].newValue));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  useEffect(() => {
    history.replaceState(null, "", `${location.pathname}?site=${site}#${page}`);
    setNotice(undefined);
  }, [page, site]);
  if (!state) return <main className="main loading">Loading ScreenFry…</main>;
  const title = pages.find((p) => p.id === page)!.label;
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="mark" src="icons/icon-64.png" alt="" />
          <span>ScreenFry</span>
        </div>
        <nav className="nav" aria-label="Sections">
          {pages.map((p) => (
            <button
              key={p.id}
              className={page === p.id ? "active" : ""}
              aria-current={page === p.id ? "page" : undefined}
              onClick={() => setPage(p.id)}
            >
              <Icon name={p.icon} />
              <span>{p.label}</span>
            </button>
          ))}
        </nav>
        <section className="today" aria-label="Today’s usage">
          <h2>Today</h2>
          {launchSites.map((s) => {
            const status = siteStatus(state, s.id);
            return (
              <button
                key={s.id}
                className="today-row"
                onClick={() => {
                  setSite(s.id);
                  setPage("websites");
                }}
              >
                <span className="today-name">
                  <span className="dot" style={{ background: s.color }} />
                  {s.name}
                </span>
                <span className={`today-value ${status.blocked ? "blocked" : ""}`}>
                  {status.blocked ? "Blocked" : status.label.replace(" today", "")}
                </span>
                {status.progress !== undefined && (
                  <span className="meter" aria-hidden="true">
                    <span style={{ width: `${status.progress * 100}%` }} />
                  </span>
                )}
              </button>
            );
          })}
        </section>
        <p className="sidebar-foot muted">Less feed. More day.</p>
      </aside>
      <main className="main">
        <header className="page-head">
          <div>
            <span className="eyebrow">{today}</span>
            <h1>{title}</h1>
            <p className="muted">
              {page === "websites"
                ? "Keep the useful parts. Choose what gets in the way."
                : page === "windows"
                  ? "Choose when websites are available."
                  : "Make ScreenFry work for you."}
            </p>
          </div>
          {state.settingsPassword && unlocked && (
            <button
              className="button secondary"
              onClick={() => {
                setSettingsCredential();
                setUnlocked(false);
              }}
            >
              Lock settings
            </button>
          )}
        </header>
        {notice && (
          <div className={`banner ${notice.kind}`} role="status">
            {notice.text}
            <button
              className="banner-close"
              aria-label="Dismiss"
              onClick={() => setNotice(undefined)}
            >
              ×
            </button>
          </div>
        )}
        {state.migrationNotice && (
          <details className="migration-note">
            <summary>Updated from the previous version</summary>
            <p>{state.migrationNotice}</p>
          </details>
        )}
        <SettingsGate
          state={state}
          unlocked={unlocked}
          onUnlock={() => setUnlocked(true)}
        >
          {page === "websites" && (
            <div className="website-layout">
              <div className="website-list" aria-label="Websites">
                {launchSites.map((s) => (
                  <button
                    key={s.id}
                    aria-pressed={site === s.id}
                    className={`website-button ${site === s.id ? "selected" : ""}`}
                    onClick={() => setSite(s.id)}
                  >
                    <span
                      className="site-avatar small-avatar"
                      style={{ background: s.color }}
                    >
                      {s.symbol}
                    </span>
                    <span className="website-name">
                      {s.name}
                      <small>{siteStatus(state, s.id).label}</small>
                    </span>
                    <span className="site-chevron">›</span>
                  </button>
                ))}
              </div>
              <div className="website-detail">
                <SiteControls
                  key={site}
                  state={state}
                  site={site}
                  onState={setState}
                  onError={(text) => setNotice({ kind: "error", text })}
                />
              </div>
            </div>
          )}
          {page === "windows" && (
            <Windows state={state} onState={setState} onNotice={setNotice} />
          )}
          {page === "settings" && (
            <Settings
              state={state}
              onState={setState}
              onNotice={setNotice}
              onUnlocked={() => setUnlocked(true)}
            />
          )}
        </SettingsGate>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Dashboard />);
