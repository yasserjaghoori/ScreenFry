import type { PolicyDecision } from "@shared/index";
import { blockedCopy } from "../ui/blocked-copy";
import animation from "../styles/fry-animation.css?inline";

/** A local, isolated screen: no cross-scheme redirect and no background response required. */
export function createBlockedScreen() {
  let host: HTMLElement | undefined;
  let dialog: HTMLDialogElement;
  let title: HTMLElement, detail: HTMLElement, next: HTMLElement;
  let resume: HTMLButtonElement;
  let savedFocus: HTMLElement | null = null;
  return {
    show(decision: PolicyDecision, label: string, singleVideoUrl?: string) {
      if (!document.documentElement) return;
      if (!host) {
        savedFocus = document.activeElement as HTMLElement | null;
        host = document.createElement("screenfry-blocked");
        const root = host.attachShadow({ mode: "closed" });
        root.innerHTML = `<style>
          :host{all:initial!important;visibility:visible!important;display:block!important}
          dialog{box-sizing:border-box;position:fixed;inset:0;width:100vw;max-width:none;height:100vh;max-height:none;margin:0;padding:28px;border:0;color:#f9f4ef;background:radial-gradient(ellipse at 50% 10%,#47271f,transparent 65%),#141315;font:16px/1.6 system-ui;overflow:auto;visibility:visible!important}
          dialog[open]{display:grid;place-items:center}dialog::backdrop{background:#141315}
          section{box-sizing:border-box;width:min(100%,560px);padding:40px 28px;text-align:center;border:1px solid #ffffff18;border-radius:28px;background:#201b1bed;box-shadow:0 24px 100px #0005}
          h1{font-size:clamp(28px,5vw,44px);line-height:1.15;margin:12px 0 20px;letter-spacing:-1.5px}p{color:#c8b9b0}small{color:#eb9b6e;letter-spacing:3px;text-transform:uppercase}
          button{font:600 15px system-ui;padding:13px 20px;border:1px solid #f7955b;border-radius:12px;background:#f7955b;color:#24160f;cursor:pointer}button:focus-visible{outline:3px solid white;outline-offset:4px}button[hidden]{display:none}.next{font-size:14px;color:#e8ad82}
          ${animation}
        </style><dialog aria-labelledby="heading"><section><span class="fry-mark" aria-hidden="true"><img alt=""><i></i><i></i><i></i></span><small>ScreenFry · Less feed. More day.</small><h1 id="heading"></h1><p class="detail"></p><p class="next"></p><button hidden></button><p>Open ScreenFry in your browser toolbar to change website settings.</p></section></dialog>`;
        root.querySelector("img")!.src =
          chrome.runtime.getURL("icons/icon-256.png");
        dialog = root.querySelector("dialog")!;
        title = root.querySelector("h1")!;
        detail = root.querySelector(".detail")!;
        next = root.querySelector(".next")!;
        resume = root.querySelector("button")!;
        dialog.addEventListener("cancel", (event) => event.preventDefault());
      }
      if (!host.isConnected) document.documentElement.append(host);
      if (!dialog.open) dialog.showModal();
      const allowed = decision.status === "allowed" && !singleVideoUrl;
      const copy = blockedCopy(decision, label);
      title.textContent = singleVideoUrl
        ? "One video. Then back to your day."
        : allowed
          ? "You can continue."
          : copy.title;
      detail.textContent = singleVideoUrl
        ? "Only the linked video is enabled. Scrolling into another video is paused."
        : allowed
          ? "Your website is available again."
          : copy.details.join(" ");
      next.textContent = !allowed && !singleVideoUrl ? (copy.next ?? "") : "";
      resume.hidden = !allowed && !singleVideoUrl;
      resume.textContent = singleVideoUrl
        ? "Back to the linked video"
        : "Continue to site";
      resume.onclick = () =>
        singleVideoUrl ? location.replace(singleVideoUrl) : location.reload();
    },
    hide() {
      if (!host) return;
      dialog.close();
      host.remove();
      host = undefined;
      savedFocus?.focus?.();
    },
  };
}
