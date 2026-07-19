/**
 * Resolve the Sentry DSN used for reporting. Prefers an explicit `--dsn` flag,
 * then falls back to the `SENTRY_DSN` environment variable. Throws when neither
 * is set, or when the value isn't a structurally valid Sentry DSN — reporting
 * can't proceed without one, and an invalid DSN silently disables the SDK
 * (events go nowhere) rather than erroring at send time.
 */
export function resolveDsn(flag?: string): string {
  const dsn = flag?.trim() || process.env.SENTRY_DSN?.trim();
  if (!dsn) {
    throw new Error("No Sentry DSN. Pass --dsn <dsn> or set SENTRY_DSN.");
  }
  return validateDsn(dsn);
}

/**
 * A Sentry DSN is `{http|https}://{publicKey}@{host}/{optionalPath}{projectId}`.
 * We assert each part up front instead of deferring to `Sentry.init()`, which
 * only logs `Invalid Sentry Dsn` and disables itself — so a malformed DSN (e.g.
 * an OTLP endpoint, or one missing its public key) would otherwise scan to
 * completion and report "success" to nowhere.
 */
function validateDsn(dsn: string): string {
  let url: URL;
  try {
    url = new URL(dsn);
  } catch {
    throw new Error(`Invalid Sentry DSN (not a URL): ${dsn}`);
  }

  const problems: string[] = [];

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    problems.push(`protocol must be http(s), got "${url.protocol.replace(/:$/, "")}"`);
  }
  if (!url.username) {
    problems.push("missing public key (expected https://<publicKey>@host/projectId)");
  }
  if (!url.hostname) {
    problems.push("missing host");
  }

  const projectId = url.pathname.split("/").filter(Boolean).pop();
  if (!projectId) {
    problems.push("missing project id in path");
  } else if (!/^\d+$/.test(projectId)) {
    problems.push(
      `project id must be numeric, got "${projectId}" ` +
        "(this looks like an ingest/OTLP endpoint, not a DSN)",
    );
  }

  if (problems.length > 0) {
    throw new Error(`Invalid Sentry DSN — ${problems.join("; ")}: ${dsn}`);
  }

  return dsn;
}
