import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { send } from "@browser/messages";
import { parseWebUrl } from "@core/domains";
import type { PolicyDecision } from "@shared/index";
import { formatWhen } from "../ui/format";
import "../styles/global.css";
import "../styles/focus.css";
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
    const check = async () => {
      if (!url) return;
      const r = await send<PolicyDecision>({ type: "GET_POLICY", url });
      if (r.ok) setDecision(r.data);
      else setError(r.error);
    };
    void check();
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, []);
  const requested = params.get("label") ?? "";
  // A short-form player found inside an ordinary page: the page itself is allowed, but the
  // notice must still explain the short-form block rather than invite the user straight back.
  const shortForm =
    requested === "YouTube Shorts" || requested === "Instagram Reels";
  const allowed = decision?.status === "allowed";
  const label =
    (allowed && shortForm ? requested : decision?.ruleLabel) ??
    (requested || "This website");
  const showContinue = allowed && !shortForm;
  return (
    <main className="focus-page">
      <section
        className={`card focus-card ${showContinue ? "" : "is-blocked"}`}
      >
        <img className="focus-logo" src="icons/icon-128.png" alt="" />
        <span className="eyebrow">ScreenFry</span>
        <h1>
          {showContinue ? "You can continue." : `${label} is off for now.`}
        </h1>
        {(decision?.reasons.includes("short-form") ||
          (allowed && shortForm)) && (
          <p className="muted">
            Short-form playback is turned off for this website. Direct links and
            notifications follow the same setting.
          </p>
        )}
        {decision?.reasons.includes("outside-window") && (
          <p className="muted">This website is outside its allowed windows.</p>
        )}
        {decision?.reasons.includes("daily-limit") && (
          <p className="muted">
            You’ve used your daily allowance. It resets at midnight.
          </p>
        )}
        {decision?.reasons.includes("site-blocked") && (
          <p className="muted">You’ve turned on full website blocking.</p>
        )}
        {!decision && <p className="muted">Checking website settings…</p>}
        {decision?.nextAccessAt && (
          <p className="next-access">
            Back {formatWhen(decision.nextAccessAt)}
          </p>
        )}
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
