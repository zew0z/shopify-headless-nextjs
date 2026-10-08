export class AnalyticsScriptLoadError extends Error {
  kind: string; resource: string;
  constructor(kind: string, resource: string, directive = "") {
    const label = resource.includes("consent-tracking-api") ? "Shopify consent script" : "Shopify analytics sender";
    const message = kind === "csp"
      ? `${label} was blocked by Content Security Policy (${directive}). Tracking stays off.`
      : kind === "timeout"
        ? `${label} timed out. Tracking stays off.`
        : `${label} could not load. The browser did not expose the cause; inspect this request's full Network status or Console error. Tracking stays off.`;
    super(message);
    this.name = "AnalyticsScriptLoadError";
    this.kind = kind;
    this.resource = resource;
  }
}

// A script element's error event does not distinguish a network failure,
// extension/Firefox privacy block, or CORS failure. Only report what is observed.
export function loadAnalyticsScript(document: Document, src: string, id: string, {
  timeoutMs = 15000,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.id = id;
    script.crossOrigin = "anonymous";
    script.referrerPolicy = "no-referrer";
    script.src = src;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cancel(timeout);
      script.onload = null;
      script.onerror = null;
      document.removeEventListener("securitypolicyviolation", onPolicyViolation);
      if (error) {
        script.remove();
        reject(error);
      } else resolve();
    };
    const onPolicyViolation = (event: SecurityPolicyViolationEvent) => {
      if (event.disposition === "report") return;
      if (![src, new URL(src).origin].includes(event.blockedURI)) return;
      if (!["script-src", "script-src-elem", "default-src"].includes(event.effectiveDirective)) return;
      finish(new AnalyticsScriptLoadError("csp", src, event.effectiveDirective));
    };
    document.addEventListener("securitypolicyviolation", onPolicyViolation);
    const timeout = schedule(() => finish(new AnalyticsScriptLoadError("timeout", src)), timeoutMs);
    script.onload = () => finish();
    script.onerror = () => finish(new AnalyticsScriptLoadError("resource-error", src));
    document.head.appendChild(script);
  });
}
