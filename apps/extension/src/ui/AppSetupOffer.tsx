import React, { useEffect, useState } from "react";
import { send } from "@browser/messages";
import { APP_SETUP_KEY, type AppSetupOffer as Offer } from "@browser/storage";
import type { AppState } from "@shared/index";
import { passwordGate } from "./PasswordPrompt";

/**
 * A setup the Mac app sent while this browser's settings password is on: offered here, and
 * applied as the live setup only through the password (the app never has it).
 */
export function AppSetupOffer({
  state,
  onState,
  onDone,
}: {
  state: AppState;
  onState: (s: AppState) => void;
  onDone: (text: string, error?: boolean) => void;
}) {
  const [offer, setOffer] = useState<Offer>();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const read = () =>
      void chrome.storage.local
        .get(APP_SETUP_KEY)
        .then((saved) => setOffer(saved[APP_SETUP_KEY] as Offer | undefined))
        .catch(() => undefined);
    read();
    const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local" && APP_SETUP_KEY in changes) read();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, []);
  if (!offer) return null;
  const dismiss = () => void chrome.storage.local.remove(APP_SETUP_KEY).catch(() => undefined);
  async function apply() {
    if (!offer || !(await passwordGate(state))) return;
    setBusy(true);
    const r = await send<AppState>({
      type: "SET_LOADOUT_FROM_CODE",
      index: state.activeLoadout ?? 0,
      code: offer.code,
    });
    setBusy(false);
    if (!r.ok) return onDone(r.error, true);
    onState(r.data);
    dismiss();
    onDone(`“${offer.name}” from ScreenFry on your Mac is now your setup here.`);
  }
  return (
    <div className="banner info app-setup" role="status">
      <span>
        ScreenFry on your Mac sent <strong>{offer.name}</strong> to use here. Your settings
        password is on, so it waits for you.
      </span>
      <span className="row">
        <button className="button" disabled={busy} onClick={() => void apply()}>
          {busy ? "Applying…" : "Use it"}
        </button>
        <button className="button secondary" disabled={busy} onClick={dismiss}>
          Not now
        </button>
      </span>
    </div>
  );
}
