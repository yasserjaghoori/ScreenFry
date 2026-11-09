import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { STATE_KEY } from "@browser/storage";
import { migrateState } from "@core/defaults";
import { evaluatePolicy } from "@policy/index";
import { parseWebUrl } from "@core/domains";
import { shortFormLabels } from "@feeds/index";
import type { PolicyDecision } from "@shared/index";
import { blockedCopy } from "../ui/blocked-copy";
import "../styles/global.css";
import "../styles/focus.css";
import "../styles/fry-animation.css";
const params = new URLSearchParams(location.search);
const rawUrl =
  params.get("source") === "network"
    ? location.search.slice(location.search.indexOf("&url=") + 5)
    : (params.get("url") ?? "");
const url = parseWebUrl(rawUrl)?.href;
function Blocked() {
  const [decision, setDecision] = useState<PolicyDecision>(),
    [error, setError] = useState("");
  useEffect(() => {
    let mounted = true;
    let state: ReturnType<typeof migrateState> | undefined;
    const check = () => {
      if (mounted && url && state) {
        const next = evaluatePolicy(state, url, Date.now());
        setDecision((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      }
    };
    const changed = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "local" && changes[STATE_KEY]) {
        state = migrateState(changes[STATE_KEY].newValue);
        check();
      }
    };
    chrome.storage.onChanged.addListener(changed);
    void chrome.storage.local
      .get(STATE_KEY)
      .then((saved) => {
        state ??= migrateState(saved[STATE_KEY]);
        check();
      })
      .catch(() => {
        if (mounted)
          setError("Open ScreenFry in the toolbar to check settings.");
      });
    const timer = setInterval(check, 1000);
    return () => {
      mounted = false;
      clearInterval(timer);
      chrome.storage.onChanged.removeListener(changed);
    };
  }, []);
  const requested = params.get("label") ?? "";
  // A short-form player found inside an ordinary page: the page itself is allowed, but the
  // notice must still explain the short-form block rather than invite the user straight back.
  const shortForm = shortFormLabels.includes(requested);
  const allowed = decision?.status === "allowed";
  const label =
    (allowed && shortForm ? requested : decision?.ruleLabel) ??
    (requested || "This website");
  const showContinue = allowed && !shortForm;
  const copy = decision && blockedCopy(decision, label);
  return (
    <main className="focus-page">
      <section
        className={`card focus-card ${showContinue ? "" : "is-blocked"}`}
      >
        <span className="fry-mark" aria-hidden="true">
          <img src="icons/icon-256.png" alt="" />
          <i />
          <i />
          <i />
        </span>
        <span className="eyebrow">ScreenFry</span>
        <h1>{showContinue ? "You can continue." : copy?.title ?? `${label} is off for now.`}</h1>
        {allowed && shortForm && (
          <p className="muted">
            Short-form playback is turned off for this website. Direct links and
            notifications follow the same setting.
          </p>
        )}
        {!allowed &&
          copy?.details.map((text) => (
            <p className="muted" key={text}>
              {text}
            </p>
          ))}
        {!decision && <p className="muted">Checking website settings…</p>}
        {!allowed && copy?.next && <p className="next-access">{copy.next}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="focus-actions">
          {allowed && url && (
            <button className="button" onClick={() => location.replace(url)}>
              {shortForm ? "Back to website" : "Continue to site"}
            </button>
          )}
          <button
            className="button secondary"
            onClick={() =>
              void chrome.tabs.create({
                url: chrome.runtime.getURL("dashboard.html"),
              })
            }
          >
            Website settings
          </button>
        </div>
        <p className="fine-print">
          No extra-time bypass. Changes follow your optional settings password.
        </p>
      </section>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Blocked />);
