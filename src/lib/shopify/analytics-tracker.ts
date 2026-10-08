/** One consent controller per document. Never publishes pre-consent history to the bus. */
import { publicAnalyticsUrl } from "./analytics-policy";

export interface AnalyticsPrivacy {
  consentStatus?: string;
  currentVisitorConsent(): { analytics?: string };
  analyticsProcessingAllowed(): boolean;
  setTrackingConsent(consent: { analytics: boolean; marketing: boolean; preferences: boolean; sale_of_data: boolean }): Promise<unknown>;
}
export interface AnalyticsState {
  enabled: boolean; ready: boolean; busy: boolean; failed: boolean; open: boolean;
  choice: "pending" | "accepted" | "rejected";
  published: number; delivered: number; transport: "none" | "ok" | "failed";
}
export const INITIAL_ANALYTICS_STATE: AnalyticsState = { enabled: false, ready: false, busy: false, failed: false, open: false, choice: "pending", published: 0, delivered: 0, transport: "none" };

export function createAnalyticsTracker({ origin, paths, loadPrivacy, initialize, loadSender, publish }: {
  origin: string; paths: string[];
  loadPrivacy(onEnabled: () => void): Promise<AnalyticsPrivacy | null>;
  initialize(): Promise<unknown>; loadSender(): Promise<unknown>;
  publish(payload: { url: string }): void;
}) {
  let state = { ...INITIAL_ANALYTICS_STATE };
  const listeners = new Set<() => void>();
  let privacy: AnalyticsPrivacy | null = null;
  let currentUrl: string | null = null;
  let lastUrl: string | null = null;
  let active = false;
  let generation = 0;
  let initializePromise: Promise<unknown> | undefined;
  let senderPromise: Promise<unknown> | undefined;
  let bootPromise: Promise<void> | undefined;
  let writes: Promise<unknown> = Promise.resolve();
  const update = (next: Partial<AnalyticsState>) => { state = { ...state, ...next }; listeners.forEach(fn => fn()); };
  const stop = () => { active = false; lastUrl = null; };
  const canTrack = () => {
    try { return state.enabled && active && !state.busy && !state.failed && state.choice === "accepted" && privacy?.consentStatus === "loaded" &&
      privacy.currentVisitorConsent().analytics === "yes" && privacy.analyticsProcessingAllowed() === true; }
    catch { return false; }
  };
  const fail = () => { stop(); update({ ready: !!privacy, busy: false, failed: true, choice: "pending", open: true }); };
  const emit = () => {
    if (!canTrack() || !currentUrl || currentUrl === lastUrl) return;
    try {
      publish({ url: currentUrl });
      lastUrl = currentUrl;
      update({ published: state.published + 1 });
    } catch { fail(); }
  };
  const activate = async (epoch: number) => {
    await (initializePromise ??= initialize());
    if (epoch !== generation) return false;
    await (senderPromise ??= loadSender());
    if (epoch !== generation) return false;
    if (privacy?.currentVisitorConsent().analytics !== "yes" || !privacy.analyticsProcessingAllowed()) throw new Error("Consent unavailable");
    active = true;
    return true;
  };
  return {
    subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    getSnapshot: () => state,
    canTrack,
    recordTransport(ok: boolean) { update({ transport: ok ? "ok" : "failed", delivered: state.delivered + (ok ? 1 : 0) }); },
    open() { if (state.enabled) update({ open: true }); },
    close() { update({ open: false }); },
    withdrawImmediately() { generation++; stop(); update({ busy: false, choice: "rejected" }); },
    disable() { generation++; stop(); update({ enabled: false, busy: false, choice: "pending" }); },
    visit(value: string | null) { currentUrl = value ? publicAnalyticsUrl(value, origin, paths) : null; if (!currentUrl) lastUrl = null; emit(); },
    syncPrivacy() {
      try {
        if (privacy?.currentVisitorConsent().analytics !== "yes" || !privacy.analyticsProcessingAllowed()) {
          generation++; stop(); update({ busy: false, choice: "rejected" });
        }
      } catch { fail(); }
    },
    boot() {
      return bootPromise ??= (async () => {
        const epoch = generation;
        try {
          privacy = await loadPrivacy(() => update({ enabled: true, open: true }));
          if (!privacy || epoch !== generation) return;
          const saved = privacy.currentVisitorConsent().analytics;
          update({ ready: true });
          if (saved === "yes") {
            update({ busy: true });
            if (!await activate(epoch)) return;
            update({ busy: false, choice: "accepted", open: false }); emit();
          } else update({ choice: saved === "no" ? "rejected" : "pending", open: saved !== "no" });
        } catch { if (epoch === generation) fail(); }
      })();
    },
    async choose(accepted: boolean) {
      if (!state.enabled || !state.ready || (accepted && state.busy)) return;
      const epoch = ++generation;
      stop(); update({ busy: true, failed: false, choice: "pending" });
      // Withdrawal stops synchronously; serial writes prevent a late accept overriding rejection on reload.
      const operation = writes.catch(() => {}).then(() => privacy!.setTrackingConsent({ analytics: accepted === true, marketing: false, preferences: false, sale_of_data: false }));
      writes = operation;
      try {
        await operation;
        if (epoch !== generation) return;
        if (accepted && !await activate(epoch)) return;
        update({ busy: false, choice: accepted ? "accepted" : "rejected", open: false }); emit();
      } catch { if (epoch === generation) fail(); }
    },
  };
}
