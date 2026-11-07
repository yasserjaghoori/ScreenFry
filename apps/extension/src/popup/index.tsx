import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send, setSettingsCredential } from "@browser/messages";
import { STATE_KEY } from "@browser/storage";
import { migrateState } from "@core/defaults";
import { launchSites } from "@core/sites";
import { siteFor } from "@feeds/index";
import type { AppState, FeedSite } from "@shared/index";
import { SiteControls } from "../ui/SiteControls";
import { SettingsGate } from "../ui/SettingsGate";
import { siteStatus } from "../ui/siteStatus";
import "../styles/global.css";
import "../styles/dashboard.css";
import "../styles/popup.css";
function Popup() {
  const [state, setState] = useState<AppState>(),
    [site, setSite] = useState<FeedSite>("youtube"),
    [error, setError] = useState(""),
    [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    void send<AppState>({ type: "GET_STATE" }).then((r) =>
      r.ok ? setState(r.data) : setError(r.error),
    );
    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        try {
          const found = siteFor(new URL(tab?.url ?? "").hostname);
          if (found) setSite(found.site);
        } catch {
          /* not a website */
        }
      });
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
  const open = (page: string) =>
    chrome.tabs.create({
      url: chrome.runtime.getURL(`dashboard.html?site=${site}#${page}`),
    });
  return (
    <main className="popup">
      <header className="popup-head">
        <strong className="popup-title">
          <img src="icons/icon-64.png" alt="" />
          ScreenFry
        </strong>
        <button
          className="button ghost"
          onClick={() => void open("settings")}
          aria-label="Open settings"
        >
          Settings ↗
        </button>
      </header>
      <nav className="popup-nav" aria-label="Sections">
        <button className="selected" onClick={() => void open("websites")}>
          Websites ↗
        </button>
        <button onClick={() => void open("windows")}>Windows ↗</button>
      </nav>
      <div
        id="site-picker"
        className="site-picker"
        role="radiogroup"
        aria-label="Website"
      >
        {launchSites.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={site === s.id}
            aria-label={s.name}
            title={s.name}
            className={site === s.id ? "selected" : ""}
            onClick={() => {
              setSite(s.id);
              setError("");
            }}
          >
            <span className="site-avatar small-avatar" style={{ background: s.color }}>
              {s.symbol}
            </span>
            <span className="chip-label">{s.name}</span>
          </button>
        ))}
      </div>
      {state && (
        <p className="popup-status">
          <strong>{launchSites.find((s) => s.id === site)!.name}</strong>
          <span className={siteStatus(state, site).blocked ? "blocked" : ""}>
            {siteStatus(state, site).label}
          </span>
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {state ? (
        <SettingsGate
          state={state}
          unlocked={unlocked}
          onUnlock={() => setUnlocked(true)}
        >
          <SiteControls
            key={site}
            state={state}
            site={site}
            onState={setState}
            onError={setError}
          />
        </SettingsGate>
      ) : (
        <p className="muted">Loading…</p>
      )}
      {state?.settingsPassword && unlocked && (
        <button
          className="button secondary block"
          onClick={() => {
            setSettingsCredential();
            setUnlocked(false);
          }}
        >
          Lock settings
        </button>
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
