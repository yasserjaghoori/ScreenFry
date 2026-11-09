import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send, setSettingsCredential } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { detectBrowser } from "@browser/platform";
import { migrateState } from "@core/defaults";
import { launchSites } from "@core/sites";
import type { AppState, FeedSite } from "@shared/index";
import { Icon } from "../ui/Icon";
import { SiteControls } from "../ui/SiteControls";
import { SettingsGate } from "../ui/SettingsGate";
import { siteStatus } from "../ui/siteStatus";
import { FryTimeBar, fryTimeSummary } from "../ui/FryTime";
import { Windows } from "./Windows";
import { Settings } from "./Settings";
import { About } from "./About";
import { Experimental } from "./Experimental";
import { setPasswordSetupHandler } from "../ui/PasswordPrompt";
import "../styles/global.css";
import "../styles/dashboard.css";
const pages = [
  { id: "websites", label: "Websites", icon: "feeds" },
  { id: "windows", label: "Windows", icon: "schedules" },
  { id: "experimental", label: "Experimental", icon: "lab" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "about", label: "About", icon: "settings" },
] as const;
/** Pages listed in the sidebar's main navigation; About lives at the bottom. */
const navPages = pages.filter((p) => p.id !== "about");
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
      )?.id ?? launchSites[0].id,
  );
  const [notice, setNotice] = useState<Notice>(),
    [unlocked, setUnlocked] = useState(false);
  // Bumped to open (and scroll to) the password form, e.g. from the first-change prompt or
  // when the popup sends someone here with ?setup=password.
  const [passwordSetup, setPasswordSetup] = useState(() =>
    new URLSearchParams(location.search).get("setup") === "password" ? 1 : 0,
  );
  useEffect(() => {
    setPasswordSetupHandler(() => {
      setPage("settings");
      setPasswordSetup((n) => n + 1);
    });
  }, []);
  useEffect(() => {
    void send<AppState>({ type: "GET_STATE" }).then((r) =>
      r.ok ? setState(r.data) : setNotice({ kind: "error", text: r.error }),
    );
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STATE_KEY]?.newValue)
        setState(migrateState(changes[STATE_KEY].newValue, detectBrowser()));
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  const [, setTick] = useState(0);
  useEffect(() => {
    // Fry Time and windows start and end on the clock; refresh what the sidebar shows.
    const timer = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
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
          {navPages.map((p) => (
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
                className={`today-row ${status.fryTime ? "is-fry" : ""}`}
                title={
                  status.fryTime
                    ? `It’s Fry Time on ${s.name}: ${fryTimeSummary(status.fryTime)} Feed blocking is paused.`
                    : undefined
                }
                onClick={() => {
                  setSite(s.id);
                  setPage("websites");
                }}
              >
                <span className="today-name">
                  <span
                    className={`dot ${status.fryTime ? "fry-glow" : ""}`}
                    style={{ background: s.color }}
                  />
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
        <div className="sidebar-foot">
          <button
            className={`about-link ${page === "about" ? "active" : ""}`}
            aria-current={page === "about" ? "page" : undefined}
            onClick={() => setPage("about")}
          >
            About ScreenFry
          </button>
          <p className="muted">Less feed. More day.</p>
        </div>
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
                  : page === "about"
                    ? "What ScreenFry does in this browser."
                    : page === "experimental"
                      ? "New ideas to try: earn your website time and share your setup."
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
                {launchSites.map((s) => {
                  const status = siteStatus(state, s.id);
                  return (
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
                      <small>{status.label}</small>
                      {status.fryTime && (
                        <FryTimeBar fry={status.fryTime} site={s.name} compact />
                      )}
                    </span>
                    <span className="site-chevron">›</span>
                  </button>
                  );
                })}
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
          {page === "about" && <About />}
          {page === "experimental" && (
            <Experimental state={state} onState={setState} onNotice={setNotice} />
          )}
          {page === "settings" && (
            <Settings
              state={state}
              onState={setState}
              onNotice={setNotice}
              onUnlocked={() => setUnlocked(true)}
              openPasswordForm={passwordSetup}
            />
          )}
        </SettingsGate>
      </main>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<Dashboard />);
