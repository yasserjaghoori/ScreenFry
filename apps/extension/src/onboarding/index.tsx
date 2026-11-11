import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { send } from "@browser/messages";
import { siteDefinitions } from "@feeds/index";
import "../styles/global.css";

const names = siteDefinitions.map((s) => s.name);
const siteNames = `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
import "../styles/focus.css";
function Onboarding() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="focus-page">
      <section className="card focus-card onboarding">
        <img className="focus-logo" src="icons/icon-128.png" alt="" />
        <span className="eyebrow">Welcome to ScreenFry</span>
        <h1>
          A quieter corner
          <br />
          of the internet.
        </h1>
        <p className="muted">
          Use the parts you need. Leave the scrolling behind.
        </p>
        <div className="choice-grid">
          <div className="choice">
            <strong>Your websites, your way</strong>
            <span className="muted">
              Hide feeds and buttons on {siteNames}.
            </span>
          </div>
          <div className="choice">
            <strong>Daily allowances</strong>
            <span className="muted">
              Choose a separate daily limit for each website.
            </span>
          </div>
          <div className="choice">
            <strong>Allowed windows</strong>
            <span className="muted">
              Whitelist websites for specific times. They stay blocked outside
              those windows.
            </span>
          </div>
          <div className="choice">
            <strong>No Shorts loopholes</strong>
            <span className="muted">
              Block Shorts and Reels playback when enabled, including direct
              links.
            </span>
          </div>
        </div>
        <p className="muted small">
          Start without a password. You can protect settings later if you want.
          Nothing is restricted until you choose it.
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button
          className="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            // Marking the welcome page as seen never blocks getting to the settings.
            await send({ type: "COMPLETE_ONBOARDING" });
            location.replace(chrome.runtime.getURL("dashboard.html"));
          }}
        >
          {busy ? "Opening…" : "Choose website controls"}
        </button>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Onboarding />);
