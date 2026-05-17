import { createHash, X509Certificate } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { generate as generateSelfSigned } from "selfsigned";
import { log } from "./log.js";

export interface TlsCredentials {
  cert: string;
  key: string;
}

const DEFAULT_TLS_DIR = "/data/certs";
const DEFAULT_TLS_DAYS = 365;
const RENEW_BEFORE_DAYS = 30;
const DEFAULT_SAN = "DNS:localhost,IP:127.0.0.1";

function isAutoMode(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "auto" || v === "true" || v === "1" || v === "on";
}

function parseSan(spec: string): {
  altNames: Array<{ type: 2 | 7; value?: string; ip?: string }>;
  firstDns: string | undefined;
} {
  const altNames: Array<{ type: 2 | 7; value?: string; ip?: string }> = [];
  let firstDns: string | undefined;
  for (const raw of spec.split(",")) {
    const entry = raw.trim();
    if (!entry) continue;
    const [kindRaw, ...rest] = entry.split(":");
    if (!kindRaw) continue;
    const kind = kindRaw.trim().toUpperCase();
    const value = rest.join(":").trim();
    if (!value) continue;
    if (kind === "DNS") {
      altNames.push({ type: 2, value });
      if (!firstDns) firstDns = value;
    } else if (kind === "IP") {
      altNames.push({ type: 7, ip: value });
    } else {
      log.warn("tls", "ignoring unknown SAN kind", { entry });
    }
  }
  return { altNames, firstDns };
}

function sha256Fingerprint(certPem: string): string {
  const cert = new X509Certificate(certPem);
  const der = cert.raw;
  const hash = createHash("sha256").update(der).digest("hex").toUpperCase();
  return hash.match(/.{2}/g)!.join(":");
}

function readCertExpiry(certPem: string): Date {
  const cert = new X509Certificate(certPem);
  return new Date(cert.validTo);
}

function logCredentials(scope: string, certPem: string): void {
  try {
    const fp = sha256Fingerprint(certPem);
    const expiry = readCertExpiry(certPem);
    const daysLeft = Math.round(
      (expiry.getTime() - Date.now()) / (24 * 60 * 60 * 1000),
    );
    log.info("tls", "credentials ready", {
      source: scope,
      fingerprint_sha256: fp,
      not_after: expiry.toISOString(),
      days_until_expiry: daysLeft,
    });
  } catch (err) {
    log.warn("tls", "could not parse cert for diagnostics", {
      msg: (err as Error).message,
    });
  }
}

function loadByoCredentials(): TlsCredentials | null {
  const certFile = process.env.MCP_TLS_CERT_FILE;
  const keyFile = process.env.MCP_TLS_KEY_FILE;
  if (!certFile && !keyFile) return null;
  if (!certFile || !keyFile) {
    log.error(
      "tls",
      "MCP_TLS_CERT_FILE and MCP_TLS_KEY_FILE must both be set",
      { cert_file: certFile, key_file: keyFile },
    );
    process.exit(1);
  }
  const cert = readFileSync(certFile, "utf8");
  const key = readFileSync(keyFile, "utf8");
  logCredentials(`byo:${certFile}`, cert);
  return { cert, key };
}

async function generateSelfManaged(
  dir: string,
  sanSpec: string,
  days: number,
  cnOverride: string | undefined,
): Promise<TlsCredentials> {
  const { altNames, firstDns } = parseSan(sanSpec);
  if (altNames.length === 0) {
    log.warn("tls", "no usable SAN entries; falling back to default", {
      provided: sanSpec,
    });
    const fallback = parseSan(DEFAULT_SAN);
    altNames.push(...fallback.altNames);
  }
  const commonName = cnOverride ?? firstDns ?? "plex-mcp";
  log.info("tls", "generating self-managed certificate", {
    cn: commonName,
    days,
    san_count: altNames.length,
    dir,
  });
  const notBeforeDate = new Date();
  const notAfterDate = new Date(
    notBeforeDate.getTime() + days * 24 * 60 * 60 * 1000,
  );
  const pems = await generateSelfSigned(
    [{ name: "commonName", value: commonName }],
    {
      keyType: "ec",
      curve: "P-256",
      algorithm: "sha256",
      notBeforeDate,
      notAfterDate,
      extensions: [
        { name: "basicConstraints", cA: false },
        {
          name: "keyUsage",
          digitalSignature: true,
          keyEncipherment: true,
          critical: true,
        },
        { name: "extKeyUsage", serverAuth: true },
        { name: "subjectAltName", altNames },
      ],
    },
  );
  mkdirSync(dir, { recursive: true });
  const certPath = join(dir, "server.crt");
  const keyPath = join(dir, "server.key");
  writeFileSync(certPath, pems.cert, { encoding: "utf8" });
  writeFileSync(keyPath, pems.private, { encoding: "utf8" });
  try {
    chmodSync(keyPath, 0o600);
    chmodSync(certPath, 0o644);
  } catch (err) {
    // chmod is best-effort; some Windows filesystems don't honor POSIX modes.
    log.debug("tls", "chmod skipped", { msg: (err as Error).message });
  }
  return { cert: pems.cert, key: pems.private };
}

function tryLoadExisting(dir: string): TlsCredentials | null {
  const certPath = join(dir, "server.crt");
  const keyPath = join(dir, "server.key");
  if (!existsSync(certPath) || !existsSync(keyPath)) return null;
  let cert: string;
  let key: string;
  try {
    cert = readFileSync(certPath, "utf8");
    key = readFileSync(keyPath, "utf8");
  } catch (err) {
    log.warn("tls", "existing cert/key unreadable; will regenerate", {
      msg: (err as Error).message,
    });
    return null;
  }
  let expiry: Date;
  try {
    expiry = readCertExpiry(cert);
  } catch (err) {
    log.warn("tls", "existing cert unparseable; will regenerate", {
      msg: (err as Error).message,
    });
    return null;
  }
  const msUntilExpiry = expiry.getTime() - Date.now();
  const daysUntilExpiry = msUntilExpiry / (24 * 60 * 60 * 1000);
  if (daysUntilExpiry < RENEW_BEFORE_DAYS) {
    log.info("tls", "existing cert near expiry; regenerating", {
      not_after: expiry.toISOString(),
      days_until_expiry: Math.round(daysUntilExpiry),
      renew_threshold_days: RENEW_BEFORE_DAYS,
    });
    return null;
  }
  return { cert, key };
}

export async function resolveTlsCredentials(): Promise<TlsCredentials | null> {
  const byo = loadByoCredentials();
  if (byo) return byo;

  if (!isAutoMode(process.env.MCP_TLS)) return null;

  const dir = process.env.MCP_TLS_DIR ?? DEFAULT_TLS_DIR;
  const sanSpec = process.env.MCP_TLS_SAN ?? DEFAULT_SAN;
  const daysStr = process.env.MCP_TLS_DAYS;
  const days = daysStr ? Number.parseInt(daysStr, 10) : DEFAULT_TLS_DAYS;
  if (!Number.isFinite(days) || days <= 0) {
    log.error("tls", "invalid MCP_TLS_DAYS", { value: daysStr });
    process.exit(1);
  }
  const cnOverride = process.env.MCP_TLS_CN;

  // Ensure the parent directory exists so tryLoadExisting can read from it
  // on first run.
  try {
    mkdirSync(dirname(dir), { recursive: true });
  } catch {
    // ignored; mkdir on the final dir happens during generate
  }

  const existing = tryLoadExisting(dir);
  if (existing) {
    logCredentials(`auto:${dir}`, existing.cert);
    return existing;
  }
  const fresh = await generateSelfManaged(dir, sanSpec, days, cnOverride);
  logCredentials(`auto:${dir}`, fresh.cert);
  return fresh;
}
