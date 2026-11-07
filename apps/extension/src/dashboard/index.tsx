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
  if (!state) return <main className="main">Loading Screentime…</main>;
  const title = pages.find((p) => p.id === page)!.label;
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">
            <Icon name="limits" />
          </div>
          <span>Screentime</span>
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
        <p className="sidebar-foot muted">
          Less scrolling.
          <br />
          More room for your day.
        </p>
      </aside>
      <main className="main">
        <header className="page-head">
          <div>
            <span className="eyebrow">Screentime</span>
            <h1>{title}</h1>
            <p className="muted">
              {page === "websites"
                ? "Keep the useful parts. Choose what gets in the way."
                : page === "windows"
                  ? "Choose when websites are available."
                  : "Make Screentime work for you."}
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
                    <span>{s.name}</span>
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
