// apps/api/src/app.ts
import Fastify from "fastify";
import { randomUUID } from "node:crypto";

// apps/api/src/db.ts
import pg from "pg";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
function loadCaCert() {
  const candidates = [
    resolve("supabase-ca.pem"),
    resolve(process.cwd(), "supabase-ca.pem"),
    fileURLToPath(new URL("../../../supabase-ca.pem", import.meta.url)),
    fileURLToPath(new URL("../supabase-ca.pem", import.meta.url))
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        return readFileSync(candidate, "utf8");
      } catch {
      }
    }
  }
  return void 0;
}
function createPool(config) {
  const url = new URL(config.databaseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  for (const key of ["sslmode", "sslcert", "sslkey", "sslrootcert"]) url.searchParams.delete(key);
  const ca = loadCaCert();
  return new pg.Pool({
    connectionString: url.toString(),
    max: config.poolMax,
    connectionTimeoutMillis: 5e3,
    ssl: local && !config.production ? false : ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true }
  });
}
async function transaction(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL lock_timeout='5s'");
    await c.query("SET LOCAL statement_timeout='15s'");
    const result = await fn(c);
    await c.query("COMMIT");
    return result;
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {
    });
    throw e;
  } finally {
    c.release();
  }
}

// apps/api/src/errors.ts
var AppError = class extends Error {
  constructor(status, code, message, fieldErrors, retryAfterSeconds) {
    super(message);
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
    this.retryAfterSeconds = retryAfterSeconds;
  }
};
function sendApiError(reply, error, requestId) {
  const code = error?.code ?? "";
  const unavailable = code.startsWith("08") || ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH", "ENOTFOUND", "57P01", "57P02", "57P03", "53300"].includes(code);
  const e = error instanceof AppError ? error : new AppError(unavailable ? 503 : 500, unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", "The request could not be completed. Try again.");
  if (!(error instanceof AppError)) console.error(JSON.stringify({ event: "api_error", requestId, code: e.code, status: e.status }));
  if (e.retryAfterSeconds) reply.header("Retry-After", e.retryAfterSeconds);
  return reply.code(e.status).send({ error: { code: e.code, message: e.message, ...e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}, requestId } });
}

// apps/api/src/security.ts
function assertMutationOrigin(request) {
  const origin = request.headers.origin;
  const isVercelSameOrigin = Boolean(process.env.VERCEL && origin && origin === `https://${request.headers.host}` && (request.headers.host?.endsWith(".vercel.app") || false));
  if (origin !== request.server.config.publicOrigin && !isVercelSameOrigin || request.headers["x-csrf-protection"] !== "1") throw new AppError(403, "CSRF_REJECTED", "The request origin could not be verified.");
  if (!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(request.headers["content-type"] ?? "") || !["identity", void 0].includes(request.headers["content-encoding"]?.toLowerCase())) throw new AppError(415, "UNSUPPORTED_MEDIA_TYPE", "Use an uncompressed JSON request.");
}

// apps/api/src/auth/password.ts
import argon2 from "argon2";
import { randomBytes } from "node:crypto";
var passwordPolicy = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, hashLength: 32 };
var active = 0;
function validPassword(value) {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) return false;
  const length = Array.from(value).length;
  return length >= 8 && length <= 128;
}
async function bounded(work) {
  if (active >= 4) throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign in is busy. Try again.");
  active++;
  try {
    return await work();
  } finally {
    active--;
  }
}
async function hashPassword(password) {
  if (!validPassword(password)) throw new Error("Password must contain 8-128 Unicode characters without unpaired surrogates.");
  return bounded(() => argon2.hash(password, { ...passwordPolicy, salt: randomBytes(16) }));
}
function verifyPassword(hash, password) {
  return bounded(async () => {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  });
}
function needsRehash(hash) {
  const parts = hash.split("$");
  return parts[1] !== "argon2id" || parts[2] !== "v=19" || parts[3] !== "m=65536,t=3,p=1" || Buffer.from(parts[4] ?? "", "base64").length < 16 || Buffer.from(parts[5] ?? "", "base64").length !== 32 || argon2.needsRehash(hash, passwordPolicy);
}
var dummyHash = "$argon2id$v=19$m=65536,t=3,p=1$c2VqdWstZHVtbXktc2FsdA$7O3SEwsYp1roXAUgza/ilN+CXbQe7cFVhxj5vX5Ew9g";

// apps/api/src/auth/validation.ts
function normalizeEmail(value) {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  const [local, domain] = email.split("@");
  return email.length <= 254 && !!local && local.length <= 64 && !!domain && domain.split(".").every((label) => label.length <= 63) && /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(email) ? email : null;
}
function loginCredentials(body) {
  const errors = {};
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new AppError(422, "VALIDATION_ERROR", "Check the highlighted fields.", { _form: ["Enter email and password."] });
  const input = body;
  if (Object.keys(input).some((key) => !["email", "password"].includes(key))) errors._form = ["Unexpected fields."];
  const email = normalizeEmail(input.email);
  if (!email) errors.email = ["Enter a valid email address."];
  if (!validPassword(input.password)) errors.password = ["Use 8-128 Unicode characters."];
  if (Object.keys(errors).length) throw new AppError(422, "VALIDATION_ERROR", "Check the highlighted fields.", errors);
  return { email, password: input.password };
}

// apps/api/src/auth/rate-limit.ts
import { createHmac } from "node:crypto";
import ipaddr from "ipaddr.js";
function canonicalIp(ip) {
  return ipaddr.process(ip).toNormalizedString();
}
async function admitLogin(db, email, ip, now = /* @__PURE__ */ new Date(), secret = process.env.LOGIN_LIMIT_HMAC_SECRET) {
  if (!secret || Buffer.byteLength(secret) < 32) throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign in is unavailable. Try again.");
  try {
    const buckets = [{ kind: "email", key: email, max: 5 }, { kind: "ip", key: canonicalIp(ip), max: 30 }].map((bucket) => ({ ...bucket, hash: createHmac("sha256", secret).update(`${bucket.kind}:${bucket.key}`).digest() }));
    return await transaction(db, async (client) => {
      const locked = [];
      for (const bucket of buckets) {
        const inserted = await client.query("INSERT INTO app_private.login_limits(kind,key_hash,window_started_at,attempt_count) VALUES($1,$2,$3,1) ON CONFLICT DO NOTHING RETURNING kind", [bucket.kind, bucket.hash, now]);
        const { rows } = await client.query("SELECT window_started_at,attempt_count FROM app_private.login_limits WHERE kind=$1 AND key_hash=$2 FOR UPDATE", [bucket.kind, bucket.hash]);
        const row = rows[0];
        locked.push({ ...bucket, start: new Date(row.window_started_at).getTime(), count: inserted.rowCount ? 0 : row.attempt_count });
      }
      let retry = 0;
      for (const bucket of locked) if (now.getTime() - bucket.start < 9e5 && bucket.count >= bucket.max) retry = Math.max(retry, Math.ceil((bucket.start + 9e5 - now.getTime()) / 1e3));
      if (retry) throw new RateBlocked(Math.max(1, retry));
      for (const bucket of locked) {
        const elapsed = now.getTime() - bucket.start >= 9e5;
        await client.query("UPDATE app_private.login_limits SET window_started_at=$3,attempt_count=$4 WHERE kind=$1 AND key_hash=$2", [bucket.kind, bucket.hash, elapsed ? now : new Date(bucket.start), elapsed ? 1 : bucket.count + 1]);
      }
      return { allowed: true };
    });
  } catch (error) {
    if (error instanceof RateBlocked) return { allowed: false, retryAfterSeconds: error.seconds };
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign in is unavailable. Try again.");
  }
}
var RateBlocked = class extends Error {
  constructor(seconds) {
    super("Rate limited");
    this.seconds = seconds;
  }
};

// apps/api/src/auth/session.ts
import { createHash, randomBytes as randomBytes2 } from "node:crypto";
var validToken = (token) => typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) && Buffer.from(token, "base64url").toString("base64url") === token;
var generateToken = () => randomBytes2(32).toString("base64url");
var hashToken = (token) => createHash("sha256").update(token).digest();
function getSessionToken(request) {
  const name = request.server.config.production ? "__Host-session" : "dev_session";
  const values = (request.headers.cookie ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  const token = values[0].slice(name.length + 1);
  return validToken(token) ? token : null;
}
async function resolveSession(db, token) {
  if (!validToken(token)) throw unauthenticated();
  let rows;
  try {
    ({ rows } = await db.query("SELECT a.id,a.email,a.role,a.is_active,s.expires_at FROM app_private.sessions s JOIN app_private.accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>clock_timestamp()", [hashToken(token)]));
  } catch {
    throw new AppError(503, "SERVICE_UNAVAILABLE", "Session verification is unavailable. Try again.");
  }
  const row = rows[0];
  if (!row || !row.is_active) throw unauthenticated();
  if (row.role !== "admin" && row.role !== "manager") throw new AppError(403, "FORBIDDEN", "You do not have access to this portal.");
  return { user: { id: row.id, email: row.email, role: row.role }, expiresAt: new Date(row.expires_at).toISOString() };
}
var unauthenticated = () => new AppError(401, "UNAUTHENTICATED", "Your session has expired. Sign in again.");

// apps/api/src/auth/routes.ts
var invalid = () => new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
function cookie(app, token, expires, clear = false) {
  return `${app.config.production ? "__Host-session" : "dev_session"}=${token}; Path=/; HttpOnly; SameSite=Lax${app.config.production ? "; Secure" : ""}; Max-Age=${clear ? 0 : 28800}; Expires=${expires.toUTCString()}`;
}
function registerAuthRoutes(app) {
  app.post("/api/auth/login", { bodyLimit: 4096 }, async (request, reply) => {
    const { email, password } = loginCredentials(request.body);
    const admission = await admitLogin(app.db, email, request.ip, /* @__PURE__ */ new Date(), app.config.hmacSecret);
    if (!admission.allowed) throw new AppError(429, "RATE_LIMITED", "Too many sign-in attempts. Try again later.", void 0, admission.retryAfterSeconds);
    let account;
    try {
      account = (await app.db.query("SELECT id,email,password_hash,role,is_active FROM app_private.accounts WHERE email=$1", [email])).rows[0];
    } catch {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign in is unavailable. Try again.");
    }
    const eligible = account?.is_active && (account.role === "admin" || account.role === "manager");
    const verified = await verifyPassword(eligible ? account.password_hash : dummyHash, password);
    if (!eligible || !verified) throw invalid();
    const replacement = needsRehash(account.password_hash) ? await hashPassword(password) : null;
    const token = generateToken();
    const presented = getSessionToken(request);
    const data = await transaction(app.db, async (client) => {
      const locked = (await client.query("SELECT id,email,password_hash,role,is_active FROM app_private.accounts WHERE id=$1 FOR UPDATE", [account.id])).rows[0];
      if (!locked?.is_active || locked.role !== "admin" && locked.role !== "manager" || locked.password_hash !== account.password_hash) throw invalid();
      if (replacement) await client.query("UPDATE app_private.accounts SET password_hash=$1 WHERE id=$2 AND password_hash=$3", [replacement, account.id, account.password_hash]);
      if (presented) await client.query("DELETE FROM app_private.sessions WHERE token_hash=$1", [hashToken(presented)]);
      const { rows } = await client.query("WITH t AS (SELECT clock_timestamp() AS at) INSERT INTO app_private.sessions(token_hash,account_id,created_at,expires_at) SELECT $1,$2,at,at+interval '8 hours' FROM t RETURNING expires_at", [hashToken(token), account.id]);
      return { user: { id: account.id, email: account.email, role: locked.role }, expiresAt: new Date(rows[0].expires_at).toISOString() };
    });
    reply.header("Set-Cookie", cookie(app, token, new Date(data.expiresAt)));
    return { data };
  });
  app.get("/api/auth/session", async (request) => ({ data: await resolveSession(app.db, getSessionToken(request)) }));
  app.post("/api/auth/logout", { bodyLimit: 4096 }, async (request, reply) => {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).length) throw new AppError(400, "MALFORMED_REQUEST", "Send an empty JSON object.");
    const token = getSessionToken(request);
    if (token) try {
      await transaction(app.db, async (client) => {
        await client.query("DELETE FROM app_private.sessions WHERE token_hash=$1", [hashToken(token)]);
      });
    } catch {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Sign-out could not be confirmed. Retry.");
    }
    reply.header("Set-Cookie", cookie(app, "", /* @__PURE__ */ new Date(0), true)).code(204).send();
  });
}

// apps/api/src/auth/authorize.ts
async function authorizeAdmin(db, token) {
  const session = await resolveSession(db, token);
  if (session.user.role !== "admin") {
    throw new AppError(403, "FORBIDDEN", "Only administrators can perform this action.");
  }
  return { accountId: session.user.id, role: "admin" };
}
async function requireAdmin(request, _reply) {
  const actor = await authorizeAdmin(request.server.db, getSessionToken(request));
  request.actor = actor;
  return actor;
}
async function authorizeOrderReader(db, token) {
  const session = await resolveSession(db, token);
  if (session.user.role !== "admin" && session.user.role !== "manager") {
    throw new AppError(403, "FORBIDDEN", "You do not have access to view orders.");
  }
  return { accountId: session.user.id, role: session.user.role };
}
async function requireOrderReader(request, _reply) {
  const actor = await authorizeOrderReader(request.server.db, getSessionToken(request));
  request.actor = actor;
  return actor;
}

// packages/contracts/src/service-orders.ts
var serviceTypeLabels = { installation: "Installation", servicing: "Servicing", repair: "Repair" };
var UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value) {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
function normalizeUuid(value) {
  if (!isUuid(value)) throw new Error("Invalid UUID.");
  return value.toLowerCase();
}
function isUuidV4(value) {
  return isUuid(value) && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
var PRICE_ERROR = "Enter a price from MYR 0.00 to MYR 999,999.99 with at most two decimal places.";
function parsePrice(input) {
  if (typeof input !== "string" || Array.from(input).length > 32) throw new Error(PRICE_ERROR);
  const text2 = input.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(text2)) throw new Error(PRICE_ERROR);
  const [wholeInput, fraction = ""] = text2.split(".");
  const whole = wholeInput.replace(/^0+(?=\d)/, "");
  if (whole.length > 6) throw new Error(PRICE_ERROR);
  const cents = fraction.padEnd(2, "0");
  return { sen: Number(whole) * 100 + Number(cents), amount: `${whole}.${cents}` };
}
function moneyFromSen(sen) {
  if (!Number.isInteger(sen) || sen < 0 || sen > 99999999) throw new Error(PRICE_ERROR);
  return { currency: "MYR", amount: `${Math.floor(sen / 100)}.${String(sen % 100).padStart(2, "0")}` };
}
function formatOrderNumber(value) {
  const digits = String(value);
  if (!/^[1-9][0-9]*$/.test(digits)) throw new Error("Invalid order number.");
  return `SO-${digits.padStart(6, "0")}`;
}
function isValidUnicode(value) {
  return !/[\u0000\uD800-\uDFFF]/u.test(value);
}
function normalizeLineEndings(value) {
  return value.replace(/\r\n?/g, "\n");
}

// packages/contracts/src/listing-cursor.ts
var ListingCursorError = class extends Error {
  constructor() {
    super("This list location is no longer valid. Return to the newest page.");
  }
};
function validate(value, kind) {
  if (!value || typeof value !== "object" || Array.isArray(value) || !["orders", "drafts"].includes(kind)) throw new ListingCursorError();
  const p = value;
  if (Object.keys(p).join(",") !== "v,kind,at,id" || p.v !== 1 || p.kind !== kind || typeof p.at !== "string" || typeof p.id !== "string") throw new ListingCursorError();
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{6})Z$/.exec(p.at);
  if (!m) throw new ListingCursorError();
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]), hour = Number(m[4]), minute = Number(m[5]), second = Number(m[6]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > (days[month - 1] ?? 0) || hour > 23 || minute > 59 || second > 59) throw new ListingCursorError();
  try {
    return { v: 1, kind, at: p.at, id: normalizeUuid(p.id) };
  } catch {
    throw new ListingCursorError();
  }
}
function encode(p) {
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function encodeListingCursor(position) {
  return encode(validate(position, position.kind));
}
function decodeListingCursor(token, kind) {
  try {
    if (typeof token !== "string" || !token.length || token.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new ListingCursorError();
    const raw = atob(token.replace(/-/g, "+").replace(/_/g, "/"));
    if (raw.length > 768) throw new ListingCursorError();
    const text2 = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(raw, (c) => c.charCodeAt(0)));
    const parsed = JSON.parse(text2);
    const position = validate(parsed, kind);
    const original = parsed;
    if (encode(original) !== token) throw new ListingCursorError();
    return position;
  } catch {
    throw new ListingCursorError();
  }
}

// apps/api/src/listings/cursor.ts
function parseListingQuery(url, kind) {
  const query = new URL(url, "http://localhost").searchParams;
  if ([...query.keys()].some((key) => key !== "cursor") || query.getAll("cursor").length > 1) throw malformed();
  const token = query.get("cursor");
  if (token === null) return null;
  try {
    return decodeListingCursor(token, kind);
  } catch {
    throw malformed();
  }
}
function malformed() {
  return new AppError(400, "MALFORMED_REQUEST", "This list location is no longer valid. Return to the newest page.");
}

// packages/contracts/src/drafts.ts
function deriveDraftPriceSummary(input) {
  if (!input.trim()) return { kind: "missing" };
  try {
    return { kind: "money", currency: "MYR", amount: parsePrice(input).amount };
  } catch {
    return { kind: "incomplete" };
  }
}
var MAX_DRAFT_VERSION = 2147483647;
function isDraftVersion(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_DRAFT_VERSION;
}

// apps/api/src/listings/queries.ts
function pageFromRows(rows, kind, map) {
  const shown = rows.slice(0, 25);
  const last = shown.at(-1);
  const hasNextPage = rows.length > 25;
  return { items: shown.map(map), pagination: { hasNextPage, nextCursor: hasNextPage && last ? encodeListingCursor({ v: 1, kind, at: last.boundary_at, id: last.id }) : null } };
}
async function listOrderSummaries(db, position) {
  const result = await db.query(`SELECT o.id,o.order_number_value,o.customer_name,o.service_type,o.quoted_price_sen,o.currency,o.status,o.created_at,t.id AS technician_id,t.display_name AS technician_name,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS boundary_at FROM app_private.service_orders o INNER JOIN app_private.technicians t ON t.id=o.assigned_technician_id ${position ? "WHERE (o.created_at,o.id)<($1::timestamptz,$2::uuid)" : ""} ORDER BY o.created_at DESC,o.id DESC LIMIT 26`, position ? [position.at, position.id] : []);
  return pageFromRows(result.rows, "orders", (r) => ({ id: r.id, orderNumber: formatOrderNumber(r.order_number_value), customerName: r.customer_name, serviceType: r.service_type, assignedTechnician: { id: r.technician_id, name: r.technician_name }, quotedPrice: moneyFromSen(r.quoted_price_sen), status: r.status, createdAt: r.created_at.toISOString() }));
}
async function listDraftSummaries(db, actor, position) {
  const result = await db.query(`SELECT d.id,d.customer_name,d.service_type,d.quoted_price_input,d.last_saved_at,t.id AS technician_id,t.display_name AS technician_name,to_char(d.last_saved_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS boundary_at FROM app_private.service_order_drafts d LEFT JOIN app_private.technicians t ON t.id=d.proposed_technician_id WHERE d.creator_account_id=$1::uuid AND d.submitted_order_id IS NULL ${position ? "AND (d.last_saved_at,d.id)<($2::timestamptz,$3::uuid)" : ""} ORDER BY d.last_saved_at DESC,d.id DESC LIMIT 26`, position ? [actor.accountId, position.at, position.id] : [actor.accountId]);
  return pageFromRows(result.rows, "drafts", (r) => ({ id: r.id, customerName: r.customer_name.trim() || null, serviceType: r.service_type, proposedTechnician: r.technician_id ? { id: r.technician_id, name: r.technician_name } : null, quotedPrice: deriveDraftPriceSummary(r.quoted_price_input), lastSavedAt: r.last_saved_at.toISOString() }));
}

// apps/api/src/listings/routes.ts
function registerListingRoutes(app) {
  app.get("/api/service-orders", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    await requireOrderReader(request, reply);
    if (request.body !== void 0 || Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"]) throw malformed();
    const position = parseListingQuery(request.raw.url ?? request.url, "orders");
    return { data: await listOrderSummaries(app.db, position) };
  });
  app.get("/api/drafts", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    const actor = await requireAdmin(request, reply);
    if (request.body !== void 0 || Number(request.headers["content-length"] ?? 0) > 0 || request.headers["transfer-encoding"]) throw malformed();
    const position = parseListingQuery(request.raw.url ?? request.url, "drafts");
    return { data: await listDraftSummaries(app.db, actor, position) };
  });
}

// apps/api/src/order-editor/validation.ts
var FIELD_LIMITS = { customerName: 200, phone: 50, address: 2e3, problemDescription: 5e3, adminNotes: 5e3 };
function malformed2() {
  throw new AppError(400, "MALFORMED_REQUEST", "Invalid editor request.");
}
function strictObject(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed2();
  const o = value;
  if (Object.keys(o).length !== keys.length || keys.some((k) => !Object.hasOwn(o, k))) return malformed2();
  return o;
}
function normalizeFields(value, final) {
  const priceKey = final ? "quotedPrice" : "quotedPriceInput";
  if (!value || typeof value !== "object" || Array.isArray(value)) return malformed2();
  const raw = value;
  const keys = [...Object.keys(FIELD_LIMITS), "serviceType", priceKey, "assignedTechnicianId"];
  if (Object.keys(raw).some((k) => !keys.includes(k))) return malformed2();
  const errors = {};
  const text2 = {};
  for (const [key, limit] of [...Object.entries(FIELD_LIMITS), [priceKey, 32]]) {
    let v = raw[key];
    if (final && key === "adminNotes" && v === null) v = "";
    if (typeof v !== "string") {
      errors[key] = ["Enter a valid text value."];
      continue;
    }
    if (!isValidUnicode(v)) {
      errors[key] = ["Enter valid text without NUL or unpaired surrogates."];
      continue;
    }
    const normalized = normalizeLineEndings(v);
    if (Array.from(v).length > limit || Array.from(normalized).length > limit) {
      errors[key] = [`Use ${limit} characters or fewer.`];
      continue;
    }
    text2[key] = final ? normalized.trim() : normalized;
  }
  const service = raw.serviceType;
  if (!(typeof service === "string" && Object.hasOwn(serviceTypeLabels, service)) && !(service === null && !final)) errors.serviceType = [final ? "Select a service type." : "Select a valid service type."];
  const technician = raw.assignedTechnicianId;
  if (!isUuid(technician) && !(technician === null && !final)) errors.assignedTechnicianId = ["Select a technician."];
  let price;
  if (final) {
    const required = { customerName: "Enter the customer name.", phone: "Enter a phone number.", address: "Enter the address.", problemDescription: "Describe the problem.", quotedPrice: "Enter a quoted price." };
    for (const [key, message] of Object.entries(required)) if (text2[key] === "" && !errors[key]) errors[key] = [message];
    if (text2.phone && !/[0-9]/.test(text2.phone)) errors.phone = ["Enter a phone number containing at least one digit."];
    if (text2.quotedPrice) try {
      price = parsePrice(text2.quotedPrice);
    } catch (e) {
      errors.quotedPrice = [e.message];
    }
  } else if (Object.keys(errors).length === 0 && !Object.values(text2).some((v) => v.trim()) && service === null && technician === null) errors._form = ["Enter at least one detail before saving a draft."];
  if (Object.keys(errors).length) throw new AppError(422, "VALIDATION_ERROR", "Check the highlighted fields.", errors);
  const common = { customerName: text2.customerName, phone: text2.phone, address: text2.address, problemDescription: text2.problemDescription, serviceType: service };
  if (final) return { ...common, serviceType: service, quotedPrice: price.amount, assignedTechnicianId: technician.toLowerCase(), adminNotes: text2.adminNotes || null, quotedPriceSen: price.sen };
  return { ...common, quotedPriceInput: text2.quotedPriceInput, assignedTechnicianId: technician === null ? null : technician.toLowerCase(), adminNotes: text2.adminNotes };
}
function normalizeDraftFields(value) {
  return normalizeFields(value, false);
}
function normalizeOrderFields(value) {
  return normalizeFields(value, true);
}
function parseIntent(operation, target, body, key) {
  if (!isUuidV4(key)) return malformed2();
  const targeted = ["saveDraft", "deleteDraft", "submitDraft"].includes(operation);
  if (targeted && !isUuid(target)) return malformed2();
  const versioned = targeted;
  const o = strictObject(body, operation === "deleteDraft" ? ["expectedVersion"] : versioned ? ["expectedVersion", "fields"] : ["fields"]);
  if (versioned && !isDraftVersion(o.expectedVersion)) return malformed2();
  let fields = null;
  let quotedPriceSen;
  if (operation !== "deleteDraft") {
    if (!o.fields || typeof o.fields !== "object" || Array.isArray(o.fields)) return malformed2();
    if (operation === "createOrder" || operation === "submitDraft") {
      const normalized = normalizeOrderFields(o.fields);
      quotedPriceSen = normalized.quotedPriceSen;
      const { quotedPriceSen: _, ...canonical } = normalized;
      fields = canonical;
    } else fields = normalizeDraftFields(o.fields);
  }
  return { operation, targetDraftId: targeted ? target.toLowerCase() : null, expectedVersion: versioned ? o.expectedVersion : null, fields, ...quotedPriceSen === void 0 ? {} : { quotedPriceSen } };
}

// apps/api/src/order-editor/operations.ts
import { createHash as createHash2 } from "node:crypto";

// apps/api/src/order-editor/queries.ts
var iso = (value) => new Date(value).toISOString();
async function listSelectableTechnicians(db) {
  const { rows } = await db.query("SELECT id,display_name AS name FROM app_private.technicians WHERE is_active ORDER BY display_name,id");
  return rows;
}
async function loadOwnedDraft(db, actor, id) {
  const { rows } = await db.query(`SELECT d.id,d.version,d.customer_name,d.phone,d.address,d.problem_description,d.service_type,d.quoted_price_input,d.proposed_technician_id,d.admin_notes,d.created_at,d.last_saved_at,d.submitted_order_id,d.submitted_at,t.display_name,t.is_active,o.order_number_value FROM app_private.service_order_drafts d LEFT JOIN app_private.technicians t ON t.id=d.proposed_technician_id LEFT JOIN app_private.service_orders o ON o.id=d.submitted_order_id WHERE d.id=$1 AND d.creator_account_id=$2`, [id, actor.accountId]);
  const r = rows[0];
  if (!r) throw new AppError(404, "NOT_FOUND", "Draft not found.");
  return { id: r.id, version: r.version, fields: { customerName: r.customer_name, phone: r.phone, address: r.address, problemDescription: r.problem_description, serviceType: r.service_type, quotedPriceInput: r.quoted_price_input, assignedTechnicianId: r.proposed_technician_id, adminNotes: r.admin_notes }, createdAt: iso(r.created_at), lastSavedAt: iso(r.last_saved_at), proposedTechnician: r.proposed_technician_id ? { id: r.proposed_technician_id, name: r.display_name, isActive: r.is_active } : null, lifecycle: r.submitted_order_id ? { state: "submitted", orderId: r.submitted_order_id, orderNumber: formatOrderNumber(r.order_number_value), submittedAt: iso(r.submitted_at) } : { state: "active" } };
}
function receiptCheck(r) {
  const operation = r.operation_type;
  const result = operation === "createOrder" || operation === "submitDraft" ? { orderId: r.result_order_id, orderNumber: formatOrderNumber(r.result_order_number_value), createdAt: iso(r.result_timestamp) } : operation === "deleteDraft" ? { draftId: r.result_draft_id, deleted: true } : { draftId: r.result_draft_id, version: r.result_version, savedAt: iso(r.result_timestamp) };
  return { state: "completed", operation, targetDraftId: r.target_draft_id, result };
}
async function checkOwnedOperation(db, actor, key) {
  const { rows } = await db.query("SELECT operation_type,target_draft_id,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp FROM app_private.order_editor_operations WHERE account_id=$1 AND operation_key=$2", [actor.accountId, key]);
  return rows[0] ? receiptCheck(rows[0]) : { state: "not_found" };
}

// apps/api/src/order-editor/operations.ts
function fingerprintOperation(intent) {
  const f = intent.fields;
  const fields = f === null ? null : "quotedPriceInput" in f ? { customerName: f.customerName, phone: f.phone, address: f.address, problemDescription: f.problemDescription, serviceType: f.serviceType, quotedPriceInput: f.quotedPriceInput, assignedTechnicianId: f.assignedTechnicianId, adminNotes: f.adminNotes } : { customerName: f.customerName, phone: f.phone, address: f.address, problemDescription: f.problemDescription, serviceType: f.serviceType, quotedPrice: f.quotedPrice, assignedTechnicianId: f.assignedTechnicianId, adminNotes: f.adminNotes };
  return createHash2("sha256").update(JSON.stringify({ contractVersion: 1, operation: intent.operation, targetDraftId: intent.targetDraftId, expectedVersion: intent.expectedVersion, fields })).digest();
}
function advisoryLockKey(accountId, key) {
  return createHash2("sha256").update(`${accountId.toLowerCase()}:${key.toLowerCase()}`).digest().readBigInt64BE(0).toString();
}
var conflictMessages = { DRAFT_VERSION_CONFLICT: "This draft changed in another tab. Reload it or save your changes as a separate draft.", DRAFT_ALREADY_SUBMITTED: "This draft has already been submitted.", VERSION_EXHAUSTED: "This draft has reached its version limit. Save your changes as a separate draft or delete this draft.", IDEMPOTENCY_CONFLICT: "This request key was already used for a different request.", OPERATION_BUSY: "This operation is still being processed. Check its result or retry the same request." };
function conflict(code) {
  throw new AppError(409, code, conflictMessages[code]);
}
async function executeEditorMutation(db, actor, intent, key) {
  const digest = fingerprintOperation(intent);
  const { operation, targetDraftId, expectedVersion, fields } = intent;
  await db.query("SELECT pg_advisory_xact_lock($1::bigint)", [advisoryLockKey(actor.accountId, key)]);
  const prior = await db.query("SELECT operation_type,target_draft_id,request_fingerprint,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp FROM app_private.order_editor_operations WHERE account_id=$1 AND operation_key=$2", [actor.accountId, key]);
  const status = operation === "createDraft" || operation === "createOrder" || operation === "submitDraft" ? 201 : 200;
  if (prior.rows[0]) {
    const r = prior.rows[0];
    if (r.operation_type !== operation || r.target_draft_id !== targetDraftId || !Buffer.from(r.request_fingerprint).equals(digest)) conflict("IDEMPOTENCY_CONFLICT");
    const check2 = receiptCheck(r);
    if (check2.state !== "completed") throw new Error("Invalid receipt.");
    return { status, result: check2.result, operation };
  }
  if (targetDraftId) {
    const { rows: rows2 } = await db.query("SELECT version,submitted_order_id FROM app_private.service_order_drafts WHERE id=$1 AND creator_account_id=$2 FOR UPDATE", [targetDraftId, actor.accountId]);
    const draft = rows2[0];
    if (!draft) throw new AppError(404, "NOT_FOUND", "Draft not found.");
    if (draft.submitted_order_id) conflict("DRAFT_ALREADY_SUBMITTED");
    if (draft.version !== expectedVersion) conflict("DRAFT_VERSION_CONFLICT");
    if (operation !== "deleteDraft" && draft.version === 2147483647) conflict("VERSION_EXHAUSTED");
  }
  if (fields?.assignedTechnicianId) {
    const { rows: rows2 } = await db.query("SELECT app_private.lock_active_technician($1::uuid) AS active", [fields.assignedTechnicianId]);
    if (!rows2[0]?.active) throw new AppError(422, "VALIDATION_ERROR", "Check the highlighted fields.", { assignedTechnicianId: ["This technician is no longer available. Select another technician."] });
  }
  const { rows: clock } = await db.query("SELECT clock_timestamp()::text AS at");
  const at = clock[0].at;
  let draftId = null, version = null, orderId = null, number = null;
  if (operation === "createDraft" || operation === "saveDraft") {
    const f = fields;
    const values = [f.customerName, f.phone, f.address, f.problemDescription, f.serviceType, f.quotedPriceInput, f.assignedTechnicianId, f.adminNotes];
    if (operation === "createDraft") {
      const { rows: rows2 } = await db.query(`INSERT INTO app_private.service_order_drafts (customer_name,phone,address,problem_description,service_type,quoted_price_input,proposed_technician_id,admin_notes,creator_account_id,created_at,last_saved_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id,version`, [...values, actor.accountId, at]);
      draftId = rows2[0].id;
      version = rows2[0].version;
    } else {
      const { rows: rows2 } = await db.query(`UPDATE app_private.service_order_drafts SET customer_name=$1,phone=$2,address=$3,problem_description=$4,service_type=$5,quoted_price_input=$6,proposed_technician_id=$7,admin_notes=$8,version=version+1,last_saved_at=$9 WHERE id=$10 RETURNING id,version`, [...values, at, targetDraftId]);
      draftId = rows2[0].id;
      version = rows2[0].version;
    }
  } else if (operation === "deleteDraft") {
    await db.query("DELETE FROM app_private.service_order_drafts WHERE id=$1", [targetDraftId]);
    draftId = targetDraftId;
  } else {
    const f = fields;
    const { rows: rows2 } = await db.query(`INSERT INTO app_private.service_orders (customer_name,phone,address,problem_description,service_type,quoted_price_sen,currency,assigned_technician_id,admin_notes,created_by_account_id,assigned_by_account_id,created_at,assigned_at,source_draft_id) VALUES ($1,$2,$3,$4,$5,$6,'MYR',$7,$8,$9,$9,$10,$10,$11) RETURNING id,order_number_value`, [f.customerName, f.phone, f.address, f.problemDescription, f.serviceType, intent.quotedPriceSen, f.assignedTechnicianId, f.adminNotes, actor.accountId, at, targetDraftId]);
    orderId = rows2[0].id;
    number = rows2[0].order_number_value;
    if (targetDraftId) await db.query("UPDATE app_private.service_order_drafts SET version=version+1,submitted_order_id=$1,submitted_at=$2 WHERE id=$3", [orderId, at, targetDraftId]);
  }
  const { rows } = await db.query(`INSERT INTO app_private.order_editor_operations (account_id,operation_key,operation_type,target_draft_id,request_fingerprint,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING operation_type,target_draft_id,result_draft_id,result_version,result_order_id,result_order_number_value,result_timestamp`, [actor.accountId, key, operation, targetDraftId, digest, draftId, version, orderId, number, at]);
  const check = receiptCheck(rows[0]);
  if (check.state !== "completed") throw new Error("Invalid receipt.");
  return { status, result: check.result, operation };
}

// apps/api/src/order-editor/routes.ts
var EDITOR_BODY_LIMIT = 196608;
function noQuery(request) {
  if (request.url.includes("?")) malformed2();
}
function readInput(request) {
  noQuery(request);
  if (request.body !== void 0 || request.headers["content-length"] !== void 0 && request.headers["content-length"] !== "0" || request.headers["transfer-encoding"]) malformed2();
}
function registerOrderEditorRoutes(app) {
  app.get("/api/technicians", async (request, reply) => {
    await requireAdmin(request, reply);
    readInput(request);
    return { data: { technicians: await listSelectableTechnicians(app.db) } };
  });
  app.get("/api/drafts/:draftId", async (request, reply) => {
    const actor = await requireAdmin(request, reply);
    readInput(request);
    if (!isUuid(request.params.draftId)) malformed2();
    return { data: await loadOwnedDraft(app.db, actor, request.params.draftId.toLowerCase()) };
  });
  app.get("/api/order-editor-operations/:operationKey", async (request, reply) => {
    const actor = await requireAdmin(request, reply);
    readInput(request);
    if (!isUuidV4(request.params.operationKey)) malformed2();
    return { data: await checkOwnedOperation(app.db, actor, request.params.operationKey.toLowerCase()) };
  });
  const routes = [["/api/drafts", "POST", "createDraft"], ["/api/drafts/:draftId", "PUT", "saveDraft"], ["/api/drafts/:draftId", "DELETE", "deleteDraft"], ["/api/service-orders", "POST", "createOrder"], ["/api/drafts/:draftId/submit", "POST", "submitDraft"]];
  for (const [url, method, operation] of routes) app.route({ url, method, bodyLimit: EDITOR_BODY_LIMIT, handler: async (request, reply) => {
    await requireAdmin(request, reply);
    noQuery(request);
    const key = request.headers["idempotency-key"];
    const intent = parseIntent(operation, request.params.draftId, request.body, key);
    try {
      const outcome = await transaction(app.db, async (client) => {
        await client.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
        const actor = await authorizeAdmin(client, getSessionToken(request));
        return executeEditorMutation(client, actor, intent, key.toLowerCase());
      });
      return reply.code(outcome.status).send({ data: outcome.result });
    } catch (error) {
      if (error.code === "55P03") conflict("OPERATION_BUSY");
      throw error;
    }
  } });
}

// packages/contracts/src/order-detail.ts
var OrderDetailConsistencyError = class extends Error {
  constructor(mismatch = false) {
    super("The saved order details could not be verified. Retry loading or return to Service orders.");
    this.mismatch = mismatch;
  }
};
function exact(value, keys) {
  return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || value.startsWith("0000")) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
function isCanonicalOrderNumber(value) {
  if (typeof value !== "string" || !/^SO-\d{6,}$/.test(value)) return false;
  const digits = value.slice(3).replace(/^0+/, "");
  return !!digits && formatOrderNumber(digits) === value;
}
function text(value, max) {
  return typeof value === "string" && value.length > 0 && value.trim() === value && Array.from(value).length <= max && isValidUnicode(value) && !value.includes("\r");
}
function validateOrderDetail(value, expectedId) {
  const fail = () => {
    throw new OrderDetailConsistencyError();
  };
  if (!exact(value, ["id", "orderNumber", "customerName", "phone", "address", "problemDescription", "serviceType", "quotedPrice", "assignedTechnician", "adminNotes", "status", "createdByAccountId", "createdAt", "assignedByAccountId", "assignedAt"])) return fail();
  if (isUuid(value.id) && value.id.toLowerCase() !== normalizeUuid(expectedId)) throw new OrderDetailConsistencyError(true);
  if (!isUuid(value.id) || value.id !== normalizeUuid(expectedId) || value.id !== value.id.toLowerCase() || !isCanonicalOrderNumber(value.orderNumber)) return fail();
  if (!text(value.customerName, 200) || !text(value.phone, 50) || !/[0-9]/.test(value.phone) || !text(value.address, 2e3) || !text(value.problemDescription, 5e3) || !(value.adminNotes === null || text(value.adminNotes, 5e3))) return fail();
  if (!["installation", "servicing", "repair"].includes(value.serviceType) || value.status !== "assigned") return fail();
  if (!exact(value.quotedPrice, ["currency", "amount"]) || value.quotedPrice.currency !== "MYR" || typeof value.quotedPrice.amount !== "string") return fail();
  try {
    if (parsePrice(value.quotedPrice.amount).amount !== value.quotedPrice.amount) return fail();
  } catch {
    return fail();
  }
  if (!exact(value.assignedTechnician, ["id", "name"]) || !isUuid(value.assignedTechnician.id) || value.assignedTechnician.id !== value.assignedTechnician.id.toLowerCase() || !text(value.assignedTechnician.name, 100)) return fail();
  if (!isUuid(value.createdByAccountId) || !isUuid(value.assignedByAccountId) || value.createdByAccountId !== value.createdByAccountId.toLowerCase() || value.assignedByAccountId !== value.createdByAccountId || !isCanonicalTimestamp(value.createdAt) || value.assignedAt !== value.createdAt) return fail();
  return value;
}

// apps/api/src/order-detail/queries.ts
async function loadOrderDetail(db, orderId) {
  try {
    const result = await db.query(`SELECT o.id, o.order_number_value, o.customer_name, o.phone,
      o.address, o.problem_description, o.service_type, o.quoted_price_sen, o.currency,
      o.assigned_technician_id, t.display_name AS technician_name, o.admin_notes, o.status,
      o.created_by_account_id, o.created_at, o.assigned_by_account_id, o.assigned_at
      FROM app_private.service_orders AS o
      INNER JOIN app_private.technicians AS t ON t.id = o.assigned_technician_id
      WHERE o.id = $1::uuid`, [orderId]);
    const row = result.rows[0];
    if (!row) throw new AppError(404, "NOT_FOUND", "Order not found.");
    const timestamp = (value) => value instanceof Date ? value.toISOString() : value;
    return validateOrderDetail({
      id: row.id,
      orderNumber: formatOrderNumber(row.order_number_value),
      customerName: row.customer_name,
      phone: row.phone,
      address: row.address,
      problemDescription: row.problem_description,
      serviceType: row.service_type,
      quotedPrice: { ...moneyFromSen(row.quoted_price_sen), currency: row.currency },
      assignedTechnician: { id: row.assigned_technician_id, name: row.technician_name },
      adminNotes: row.admin_notes,
      status: row.status,
      createdByAccountId: row.created_by_account_id,
      createdAt: timestamp(row.created_at),
      assignedByAccountId: row.assigned_by_account_id,
      assignedAt: timestamp(row.assigned_at)
    }, orderId);
  } catch (error) {
    if (error instanceof AppError) throw error;
    const code = error.code ?? "";
    const unavailable = code.startsWith("08") || ["ECONNREFUSED", "ECONNRESET", "57P01", "53300"].includes(code);
    throw new AppError(unavailable ? 503 : 500, unavailable ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR", "Could not load the service order. Try again.");
  }
}

// apps/api/src/order-detail/routes.ts
function registerOrderDetailRoutes(app) {
  app.get("/api/service-orders/:orderId", async (request, reply) => {
    await requireOrderReader(request, reply);
    if (!isUuid(request.params.orderId) || request.url.includes("?") || request.body !== void 0 || request.headers["content-length"] !== void 0 && request.headers["content-length"] !== "0" || request.headers["transfer-encoding"]) {
      throw new AppError(400, "MALFORMED_REQUEST", "Invalid order link.");
    }
    return { data: await loadOrderDetail(app.db, normalizeUuid(request.params.orderId)) };
  });
}

// packages/contracts/src/operations-assistant.ts
function isCanonicalOrderNumber2(value) {
  if (typeof value !== "string") return false;
  const match = /^SO-(\d{6,})$/i.exec(value.trim());
  if (!match) return false;
  const digits = match[1];
  if (digits.length > 6 && digits.startsWith("0")) return false;
  return true;
}
function normalizeOrderNumber(value) {
  const trimmed = value.trim().toUpperCase();
  return isCanonicalOrderNumber2(trimmed) ? trimmed : null;
}
function parseOrderNumberValue(orderNumber) {
  const match = /^SO-(\d+)$/i.exec(orderNumber.trim());
  if (!match) throw new Error("Invalid order number");
  return BigInt(match[1]);
}
function formatOrderNumber2(seqValue) {
  const str = seqValue.toString();
  return `SO-${str.padStart(6, "0")}`;
}
function isValidSearchTerm(term) {
  if (typeof term !== "string") return false;
  const anyTerm = term;
  if (typeof anyTerm.isWellFormed === "function") {
    if (!anyTerm.isWellFormed()) return false;
  } else if (/[\uD800-\uDFFF]/.test(term)) {
    return false;
  }
  if (term.includes("\0")) return false;
  const trimmed = term.trim();
  if (trimmed !== term) return false;
  const len = [...term].length;
  return len >= 2 && len <= 200;
}
function escapeSqlLike(term) {
  return term.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
function extractExcerpt(fullText, searchTerm) {
  if (!fullText || !searchTerm) return null;
  const lowerText = fullText.toLowerCase();
  const lowerTerm = searchTerm.toLowerCase();
  const matchIdx = lowerText.indexOf(lowerTerm);
  if (matchIdx === -1) return null;
  const chars = [...fullText];
  const termLen = [...searchTerm].length;
  let codePointMatchIdx = 0;
  let charCount = 0;
  for (let i = 0; i < chars.length; i++) {
    if (charCount >= matchIdx) {
      codePointMatchIdx = i;
      break;
    }
    charCount += chars[i].length;
  }
  const maxTotalLen = 160;
  const matchEndIdx = codePointMatchIdx + termLen;
  let start = Math.max(0, codePointMatchIdx - 50);
  let end = Math.min(chars.length, matchEndIdx + 90);
  if (end - start > maxTotalLen - 6) {
    end = start + maxTotalLen - 6;
    if (end < matchEndIdx) {
      end = Math.min(chars.length, matchEndIdx + 20);
      start = Math.max(0, end - (maxTotalLen - 6));
    }
  }
  const hasLeadingEllipsis = start > 0;
  const hasTrailingEllipsis = end < chars.length;
  const prefix = hasLeadingEllipsis ? "..." : "";
  const suffix = hasTrailingEllipsis ? "..." : "";
  const body = chars.slice(start, end).join("");
  return `${prefix}${body}${suffix}`;
}
function isValidMytDateString(dateStr) {
  if (typeof dateStr !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const parsed = new Date(Date.UTC(y, m - 1, d));
  return parsed.getUTCFullYear() === y && parsed.getUTCMonth() === m - 1 && parsed.getUTCDate() === d;
}
function getMytDateParts(instant) {
  const mytMillis = instant.getTime() + 8 * 60 * 60 * 1e3;
  const d = new Date(mytMillis);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  const hour = d.getUTCHours();
  const minute = d.getUTCMinutes();
  const second = d.getUTCSeconds();
  const mytDay = `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
  return { year, month, day, hour, minute, second, mytDay };
}
function mytDateToStartUtc(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0) - 8 * 60 * 60 * 1e3);
}
function mytDateToEndUtcExclusive(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 0, 0, 0) - 8 * 60 * 60 * 1e3);
}
function resolveMytPeriod(period, nowInstant) {
  const myt = getMytDateParts(nowInstant);
  if (period === "today") {
    const startDate2 = myt.mytDay;
    const endDate2 = myt.mytDay;
    const startUtc2 = mytDateToStartUtc(startDate2);
    const endUtc2 = nowInstant;
    return { startDate: startDate2, endDate: endDate2, startUtc: startUtc2, endUtc: endUtc2, label: `Today (${startDate2})` };
  }
  if (period === "this_week") {
    const mytDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day));
    const dayOfWeek = mytDate.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const monDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday));
    const monYear = monDate.getUTCFullYear();
    const monMonth = (monDate.getUTCMonth() + 1).toString().padStart(2, "0");
    const monDay = monDate.getUTCDate().toString().padStart(2, "0");
    const startDate2 = `${monYear}-${monMonth}-${monDay}`;
    const endDate2 = myt.mytDay;
    const startUtc2 = mytDateToStartUtc(startDate2);
    const endUtc2 = nowInstant;
    return { startDate: startDate2, endDate: endDate2, startUtc: startUtc2, endUtc: endUtc2, label: `This week (${startDate2} to ${endDate2})` };
  }
  if (period === "last_week") {
    const mytDate = new Date(Date.UTC(myt.year, myt.month - 1, myt.day));
    const dayOfWeek = mytDate.getUTCDay();
    const daysSinceMonday = (dayOfWeek + 6) % 7;
    const prevMon = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday - 7));
    const currMon = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday));
    const prevSun = new Date(Date.UTC(myt.year, myt.month - 1, myt.day - daysSinceMonday - 1));
    const startDate2 = `${prevMon.getUTCFullYear()}-${(prevMon.getUTCMonth() + 1).toString().padStart(2, "0")}-${prevMon.getUTCDate().toString().padStart(2, "0")}`;
    const endDate2 = `${prevSun.getUTCFullYear()}-${(prevSun.getUTCMonth() + 1).toString().padStart(2, "0")}-${prevSun.getUTCDate().toString().padStart(2, "0")}`;
    const startUtc2 = mytDateToStartUtc(startDate2);
    const endUtc2 = mytDateToStartUtc(`${currMon.getUTCFullYear()}-${(currMon.getUTCMonth() + 1).toString().padStart(2, "0")}-${currMon.getUTCDate().toString().padStart(2, "0")}`);
    return { startDate: startDate2, endDate: endDate2, startUtc: startUtc2, endUtc: endUtc2, label: `Last week (${startDate2} to ${endDate2})` };
  }
  const startDate = `${myt.year}-${myt.month.toString().padStart(2, "0")}-01`;
  const endDate = myt.mytDay;
  const startUtc = mytDateToStartUtc(startDate);
  const endUtc = nowInstant;
  return { startDate, endDate, startUtc, endUtc, label: `This month (${startDate} to ${endDate})` };
}
function validateQueryPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    return { valid: false, error: "QueryPlan must be an object" };
  }
  const p = plan;
  const allowedOps = ["findOrders", "countOrders", "rankTechnicians", "totalQuotedValue", "lookupOrder"];
  if (!allowedOps.includes(p.operation)) {
    return { valid: false, error: `Invalid operation: ${String(p.operation)}` };
  }
  const operation = p.operation;
  if (!p.filters || typeof p.filters !== "object" || Array.isArray(p.filters)) {
    return { valid: false, error: "filters must be an object" };
  }
  const f = p.filters;
  let technicianId = null;
  if (f.technicianId !== null && f.technicianId !== void 0) {
    if (typeof f.technicianId !== "string" || !isUuid(f.technicianId)) {
      return { valid: false, error: "technicianId must be a valid UUID or null" };
    }
    technicianId = normalizeUuid(f.technicianId);
  }
  let serviceType = null;
  if (f.serviceType !== null && f.serviceType !== void 0) {
    if (!["installation", "servicing", "repair"].includes(f.serviceType)) {
      return { valid: false, error: "serviceType must be installation, servicing, repair, or null" };
    }
    serviceType = f.serviceType;
  }
  if (f.dateBasis !== "createdAt" && f.dateBasis !== "assignedAt") {
    return { valid: false, error: "dateBasis must be createdAt or assignedAt" };
  }
  const dateBasis = f.dateBasis;
  let startDate = null;
  let endDate = null;
  const hasStart = f.startDate !== null && f.startDate !== void 0;
  const hasEnd = f.endDate !== null && f.endDate !== void 0;
  if (hasStart !== hasEnd) {
    return { valid: false, error: "startDate and endDate must both be null or both be calendar dates" };
  }
  if (hasStart && hasEnd) {
    if (!isValidMytDateString(f.startDate)) {
      return { valid: false, error: "startDate must be a valid YYYY-MM-DD date" };
    }
    if (!isValidMytDateString(f.endDate)) {
      return { valid: false, error: "endDate must be a valid YYYY-MM-DD date" };
    }
    if (f.startDate > f.endDate) {
      return { valid: false, error: "startDate must be before or equal to endDate" };
    }
    startDate = f.startDate;
    endDate = f.endDate;
  }
  let customerName = null;
  if (f.customerName !== null && f.customerName !== void 0) {
    if (!isValidSearchTerm(f.customerName)) {
      return { valid: false, error: "customerName search term must be 2-200 code points, trimmed, without surrogates or NUL" };
    }
    customerName = f.customerName;
  }
  let serviceText = null;
  if (f.serviceText !== null && f.serviceText !== void 0) {
    if (!isValidSearchTerm(f.serviceText)) {
      return { valid: false, error: "serviceText search term must be 2-200 code points, trimmed, without surrogates or NUL" };
    }
    serviceText = f.serviceText;
  }
  let orderNumber = null;
  if (operation === "lookupOrder") {
    if (!p.orderNumber || !isCanonicalOrderNumber2(p.orderNumber)) {
      return { valid: false, error: "lookupOrder requires canonical orderNumber (e.g. SO-000001)" };
    }
    orderNumber = normalizeOrderNumber(p.orderNumber);
  } else {
    if (p.orderNumber !== null && p.orderNumber !== void 0) {
      return { valid: false, error: "orderNumber must be null for operations other than lookupOrder" };
    }
  }
  let rankingMetric = null;
  if (operation === "rankTechnicians") {
    if (p.rankingMetric !== "orderCount" && p.rankingMetric !== "quotedValue") {
      return { valid: false, error: "rankTechnicians requires rankingMetric (orderCount or quotedValue)" };
    }
    rankingMetric = p.rankingMetric;
  } else {
    if (p.rankingMetric !== null && p.rankingMetric !== void 0) {
      return { valid: false, error: "rankingMetric must be null for operations other than rankTechnicians" };
    }
  }
  return {
    valid: true,
    plan: {
      operation,
      filters: {
        technicianId,
        serviceType,
        dateBasis,
        startDate,
        endDate,
        customerName,
        serviceText
      },
      orderNumber,
      rankingMetric
    }
  };
}
function validateAssistantRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { valid: false, error: "Request body must be a JSON object", code: "MALFORMED_REQUEST" };
  }
  const b = body;
  const allowedKeys = ["question", "recentExchanges", "previousQuery"];
  for (const k of Object.keys(b)) {
    if (!allowedKeys.includes(k)) {
      return { valid: false, error: `Unknown request property: ${k}`, code: "MALFORMED_REQUEST" };
    }
  }
  if (typeof b.question !== "string") {
    return { valid: false, error: "question must be a string", code: "MALFORMED_REQUEST" };
  }
  const questionTrimmed = b.question.trim();
  if (questionTrimmed.length === 0) {
    return { valid: false, error: "Question cannot be empty or whitespace only", code: "VALIDATION_ERROR" };
  }
  const qLen = [...b.question].length;
  if (qLen > 2e3) {
    return { valid: false, error: "Question exceeds maximum length of 2000 characters", code: "VALIDATION_ERROR" };
  }
  const rawExchanges = b.recentExchanges ?? [];
  if (!Array.isArray(rawExchanges)) {
    return { valid: false, error: "recentExchanges must be an array", code: "MALFORMED_REQUEST" };
  }
  if (rawExchanges.length > 6) {
    return { valid: false, error: "recentExchanges cannot contain more than 6 exchanges", code: "VALIDATION_ERROR" };
  }
  const recentExchanges = [];
  let totalContextLen = qLen;
  for (const ex of rawExchanges) {
    if (!ex || typeof ex !== "object" || Array.isArray(ex)) {
      return { valid: false, error: "Each exchange must be an object", code: "MALFORMED_REQUEST" };
    }
    const exObj = ex;
    for (const ek of Object.keys(exObj)) {
      if (!["question", "narrative"].includes(ek)) {
        return { valid: false, error: `Unknown exchange property: ${ek}`, code: "MALFORMED_REQUEST" };
      }
    }
    if (typeof exObj.question !== "string" || typeof exObj.narrative !== "string") {
      return { valid: false, error: "Exchange question and narrative must be strings", code: "MALFORMED_REQUEST" };
    }
    const eqLen = [...exObj.question].length;
    const enLen = [...exObj.narrative].length;
    if (eqLen > 2e3) {
      return { valid: false, error: "Exchange question exceeds 2000 characters", code: "VALIDATION_ERROR" };
    }
    if (enLen > 4e3) {
      return { valid: false, error: "Exchange narrative exceeds 4000 characters", code: "VALIDATION_ERROR" };
    }
    totalContextLen += eqLen + enLen;
    recentExchanges.push({ question: exObj.question, narrative: exObj.narrative });
  }
  let previousQuery = null;
  const rawPrevious = b.previousQuery ?? null;
  if (rawPrevious !== null) {
    const validated = validateQueryPlan(rawPrevious);
    if (!validated.valid) {
      return { valid: false, error: `Invalid previousQuery: ${validated.error}`, code: "MALFORMED_REQUEST" };
    }
    previousQuery = validated.plan;
    totalContextLen += JSON.stringify(previousQuery).length;
  }
  if (totalContextLen > 16e3) {
    return { valid: false, error: "Combined context exceeds maximum limit of 16000 characters", code: "VALIDATION_ERROR" };
  }
  return {
    valid: true,
    request: {
      question: b.question,
      recentExchanges,
      previousQuery
    }
  };
}

// apps/api/src/operations-assistant/admission.ts
var ADMISSION_ADVISORY_LOCK_KEY = 88471928371928n;
var ACCOUNT_WINDOW_LIMIT = 10;
var ACCOUNT_WINDOW_MS = 5 * 60 * 1e3;
async function admitQueryRequest(pool, requestId, accountId, capturedNow, limits) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await client.query("SELECT pg_advisory_xact_lock($1)", [ADMISSION_ADVISORY_LOCK_KEY.toString()]);
    await client.query("DELETE FROM app_private.ai_request_leases WHERE expires_at <= clock_timestamp()");
    const activeAccountRes = await client.query(
      "SELECT expires_at FROM app_private.ai_request_leases WHERE account_id = $1",
      [accountId]
    );
    if (activeAccountRes.rowCount && activeAccountRes.rowCount > 0) {
      const expiresAt = new Date(activeAccountRes.rows[0].expires_at).getTime();
      const retryAfter = Math.max(1, Math.ceil((expiresAt - capturedNow.getTime()) / 1e3));
      throw new AppError(
        429,
        "RATE_LIMITED",
        "An operations query is already running for this account.",
        void 0,
        retryAfter
      );
    }
    const slotsRes = await client.query("SELECT slot FROM app_private.ai_request_leases");
    const occupiedSlots = new Set(slotsRes.rows.map((r) => r.slot));
    let availableSlot = null;
    for (let s = 1; s <= limits.globalConcurrency; s++) {
      if (!occupiedSlots.has(s)) {
        availableSlot = s;
        break;
      }
    }
    if (availableSlot === null) {
      const earliestRes = await client.query("SELECT MIN(expires_at) as earliest FROM app_private.ai_request_leases");
      const earliest = earliestRes.rows[0]?.earliest;
      const retryAfter = earliest ? Math.max(1, Math.ceil((new Date(earliest).getTime() - capturedNow.getTime()) / 1e3)) : 5;
      throw new AppError(
        503,
        "SERVICE_UNAVAILABLE",
        "AI assistant capacity is currently full. Try again shortly.",
        void 0,
        retryAfter
      );
    }
    const accountUsageRes = await client.query(
      "SELECT window_started_at, admitted_count FROM app_private.ai_account_usage WHERE account_id = $1 FOR UPDATE",
      [accountId]
    );
    if (accountUsageRes.rowCount && accountUsageRes.rowCount > 0) {
      const currentWindow = accountUsageRes.rows[0];
      const windowStart = new Date(currentWindow.window_started_at).getTime();
      const elapsed = capturedNow.getTime() - windowStart;
      if (elapsed < ACCOUNT_WINDOW_MS) {
        if (currentWindow.admitted_count >= ACCOUNT_WINDOW_LIMIT) {
          const retryAfter = Math.max(1, Math.ceil((ACCOUNT_WINDOW_MS - elapsed) / 1e3));
          throw new AppError(
            429,
            "RATE_LIMITED",
            "Account question quota reached. Please try again later.",
            void 0,
            retryAfter
          );
        }
        await client.query(
          "UPDATE app_private.ai_account_usage SET admitted_count = admitted_count + 1 WHERE account_id = $1",
          [accountId]
        );
      } else {
        await client.query(
          "UPDATE app_private.ai_account_usage SET window_started_at = $2, admitted_count = 1 WHERE account_id = $1",
          [accountId, capturedNow]
        );
      }
    } else {
      await client.query(
        "INSERT INTO app_private.ai_account_usage (account_id, window_started_at, admitted_count) VALUES ($1, $2, 1)",
        [accountId, capturedNow]
      );
    }
    const mytDay = getMytDateParts(capturedNow).mytDay;
    const dailyUsageRes = await client.query(
      "SELECT admitted_count FROM app_private.ai_daily_usage WHERE myt_day = $1 FOR UPDATE",
      [mytDay]
    );
    if (dailyUsageRes.rowCount && dailyUsageRes.rowCount > 0) {
      const currentDaily = dailyUsageRes.rows[0];
      if (currentDaily.admitted_count >= limits.dailyLimit) {
        const nextMidnightUtc = mytDateToEndUtcExclusive(mytDay).getTime();
        const retryAfter = Math.max(1, Math.ceil((nextMidnightUtc - capturedNow.getTime()) / 1e3));
        throw new AppError(
          429,
          "RATE_LIMITED",
          "Daily operations question quota reached.",
          void 0,
          retryAfter
        );
      }
      await client.query(
        "UPDATE app_private.ai_daily_usage SET admitted_count = admitted_count + 1 WHERE myt_day = $1",
        [mytDay]
      );
    } else {
      await client.query(
        "INSERT INTO app_private.ai_daily_usage (myt_day, admitted_count) VALUES ($1, 1)",
        [mytDay]
      );
    }
    await client.query(
      "INSERT INTO app_private.ai_request_leases (request_id, account_id, slot, expires_at) VALUES ($1, $2, $3, clock_timestamp() + interval '60 seconds')",
      [requestId, accountId, availableSlot]
    );
    await client.query("COMMIT");
    return {
      requestId,
      accountId,
      slot: availableSlot
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
}
async function releaseAdmissionLease(pool, requestId) {
  try {
    await pool.query("DELETE FROM app_private.ai_request_leases WHERE request_id = $1", [requestId]);
  } catch {
  }
}

// apps/api/src/operations-assistant/plans.ts
async function loadTechniciansReference(db) {
  const res = await db.query(
    "SELECT id, display_name, is_active FROM app_private.technicians ORDER BY display_name ASC"
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.display_name,
    isActive: r.is_active
  }));
}
function resolveDateInterval(periodType, capturedNow, explicitStart, explicitEnd) {
  if (periodType === "all_time" || !periodType && !explicitStart) {
    return {
      startDate: null,
      endDate: null,
      startUtc: null,
      endUtc: null,
      intervalLabel: "All recorded history"
    };
  }
  if (["today", "this_week", "last_week", "this_month"].includes(periodType)) {
    const res = resolveMytPeriod(periodType, capturedNow);
    return {
      startDate: res.startDate,
      endDate: res.endDate,
      startUtc: res.startUtc.toISOString(),
      endUtc: res.endUtc.toISOString(),
      intervalLabel: res.label
    };
  }
  if (periodType === "explicit" && explicitStart && explicitEnd) {
    if (isValidMytDateString(explicitStart) && isValidMytDateString(explicitEnd) && explicitStart <= explicitEnd) {
      const startUtc = mytDateToStartUtc(explicitStart);
      const endUtc = mytDateToEndUtcExclusive(explicitEnd);
      const label = explicitStart === explicitEnd ? `${explicitStart} (MYT)` : `${explicitStart} to ${explicitEnd} (MYT)`;
      return {
        startDate: explicitStart,
        endDate: explicitEnd,
        startUtc: startUtc.toISOString(),
        endUtc: endUtc.toISOString(),
        intervalLabel: label
      };
    }
  }
  return {
    startDate: null,
    endDate: null,
    startUtc: null,
    endUtc: null,
    intervalLabel: "All recorded history"
  };
}
function compileResolvedFilters(plan, technicians, capturedNow) {
  const { filters } = plan;
  let technician = null;
  if (filters.technicianId) {
    const found = technicians.find((t) => t.id === filters.technicianId);
    if (found) {
      technician = { id: found.id, name: found.name };
    }
  }
  let intervalRange;
  if (filters.startDate && filters.endDate) {
    intervalRange = resolveDateInterval("explicit", capturedNow, filters.startDate, filters.endDate);
  } else {
    intervalRange = resolveDateInterval("all_time", capturedNow);
  }
  return {
    technician,
    serviceType: filters.serviceType,
    dateBasis: filters.dateBasis,
    intervalLabel: intervalRange.intervalLabel,
    startDate: intervalRange.startDate,
    endDate: intervalRange.endDate,
    startUtc: intervalRange.startUtc,
    endUtc: intervalRange.endUtc,
    customerName: filters.customerName,
    serviceText: filters.serviceText
  };
}
function buildSystemPrompt(technicians, currentMytDay) {
  const techList = technicians.map((t) => `${t.name} (${t.id})`).join(", ");
  return `You are the AI Operations Assistant for Sejuk Sejuk Service, an air conditioning operations portal.
Current date in Malaysia Time (MYT, UTC+8) is ${currentMytDay}.
Available seed technicians: ${techList}.

Your job is to interpret user operations questions and map them to one of 5 supported operations:
1. findOrders: find matching orders (up to 25 newest rows plus total count)
2. countOrders: count exact matching orders
3. rankTechnicians: rank technicians by orderCount or quotedValue
4. totalQuotedValue: sum total quoted MYR value across all matching orders
5. lookupOrder: exact lookup of a single order by canonical order number (SO-000001)

Filters supported:
- technicianId (UUID from available technicians list)
- serviceType: "installation" | "servicing" | "repair" | null
- dateBasis: "createdAt" (default) or "assignedAt" (when user explicitly asks about assignment time)
- startDate and endDate: explicit MYT YYYY-MM-DD strings, or relative period ("today", "this_week", "last_week", "this_month", or null for all time)
- customerName: substring search term (2-200 chars)
- serviceText: problem description or notes substring search term (2-200 chars)

Rules:
- One question maps to ONE operation only. If user asks multiple operations in one question, return clarification.
- "Busiest" or "top" technician requires choosing rankingMetric: "orderCount" or "quotedValue".
- Order number format: SO- followed by 6+ digits (e.g. SO-000001).
- Out-of-scope / Unsupported topics:
  Completion tracking, completed jobs, collected payments, revenue, unpaid balances, appointment scheduling, live technician availability, workload predictions, future work.
  When user asks about unsupported topics, return { "kind": "unsupported", "message": "...", "suggestions": [...] }.
  Never answer completion questions with 0 or substitute assignment. Quoted price is NOT revenue.
- If technician name is ambiguous or unknown, return { "kind": "clarification", "message": "...", "choices": [...] }.
- Output must be strict JSON without code fences or Markdown formatting.

Output Schema:
{
  "kind": "query",
  "plan": {
    "operation": "findOrders" | "countOrders" | "rankTechnicians" | "totalQuotedValue" | "lookupOrder",
    "filters": {
      "technicianId": string | null,
      "serviceType": "installation" | "servicing" | "repair" | null,
      "dateBasis": "createdAt" | "assignedAt",
      "startDate": "YYYY-MM-DD" | null,
      "endDate": "YYYY-MM-DD" | null,
      "periodType": "today" | "this_week" | "last_week" | "this_month" | "explicit" | "all_time",
      "customerName": string | null,
      "serviceText": string | null
    },
    "orderNumber": string | null,
    "rankingMetric": "orderCount" | "quotedValue" | null
  }
}
OR
{
  "kind": "clarification",
  "message": string,
  "choices": [ { "label": string, "question": string } ]
}
OR
{
  "kind": "unsupported",
  "message": string,
  "suggestions": [ { "label": string, "question": string } ]
}`;
}

// apps/api/src/operations-assistant/queries.ts
function senToMyr(totalSenStr) {
  const sen = BigInt(totalSenStr);
  const ringgit = sen / 100n;
  const remainder = sen % 100n;
  return `${ringgit.toString()}.${remainder.toString().padStart(2, "0")}`;
}
function buildWhereClause(filters, resolved) {
  const conditions = [];
  const params = [];
  let paramIdx = 1;
  if (filters.technicianId) {
    conditions.push(`o.assigned_technician_id = $${paramIdx++}`);
    params.push(filters.technicianId);
  }
  if (filters.serviceType) {
    conditions.push(`o.service_type = $${paramIdx++}`);
    params.push(filters.serviceType);
  }
  const dateCol = filters.dateBasis === "assignedAt" ? "o.assigned_at" : "o.created_at";
  if (resolved.startUtc && resolved.endUtc) {
    conditions.push(`${dateCol} >= $${paramIdx++}`);
    params.push(resolved.startUtc);
    conditions.push(`${dateCol} < $${paramIdx++}`);
    params.push(resolved.endUtc);
  }
  if (filters.customerName) {
    conditions.push(`o.customer_name ILIKE ('%' || $${paramIdx++} || '%') ESCAPE '\\'`);
    params.push(escapeSqlLike(filters.customerName));
  }
  if (filters.serviceText) {
    const esc = escapeSqlLike(filters.serviceText);
    const p1 = paramIdx++;
    params.push(esc);
    conditions.push(
      `(o.problem_description ILIKE ('%' || $${p1} || '%') ESCAPE '\\' OR (o.admin_notes IS NOT NULL AND o.admin_notes ILIKE ('%' || $${p1} || '%') ESCAPE '\\'))`
    );
  }
  const sql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { sql, params };
}
async function executeAssistantQuery(pool, plan, resolved) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SET LOCAL statement_timeout = '5s'");
    const { sql: whereSql, params } = buildWhereClause(plan.filters, resolved);
    switch (plan.operation) {
      case "findOrders": {
        const countQuery = `SELECT count(*)::text as matching_count FROM app_private.service_orders o ${whereSql}`;
        const countRes = await client.query(countQuery, params);
        const matchingCount = countRes.rows[0]?.matching_count ?? "0";
        const rowsQuery = `
          SELECT
            o.id,
            o.order_number_value,
            o.customer_name,
            o.service_type,
            o.quoted_price_sen,
            o.status,
            o.created_at,
            o.assigned_at,
            o.assigned_technician_id,
            t.display_name as technician_name,
            o.problem_description,
            o.admin_notes
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          ${whereSql}
          ORDER BY o.created_at DESC, o.id DESC
          LIMIT 25
        `;
        const rowsRes = await client.query(rowsQuery, params);
        const items = rowsRes.rows.map((r) => {
          let excerpts;
          if (plan.filters.serviceText) {
            const prob = extractExcerpt(r.problem_description, plan.filters.serviceText);
            const notes = r.admin_notes ? extractExcerpt(r.admin_notes, plan.filters.serviceText) : null;
            if (prob || notes) {
              excerpts = {};
              if (prob) excerpts.problemDescription = prob;
              if (notes) excerpts.adminNotes = notes;
            }
          }
          return {
            id: r.id,
            orderNumber: formatOrderNumber2(r.order_number_value),
            customerName: r.customer_name,
            serviceType: r.service_type,
            technician: { id: r.assigned_technician_id, name: r.technician_name },
            status: "assigned",
            quotedPrice: {
              currency: "MYR",
              amount: senToMyr(r.quoted_price_sen.toString())
            },
            createdAt: new Date(r.created_at).toISOString(),
            assignedAt: new Date(r.assigned_at).toISOString(),
            excerpts
          };
        });
        await client.query("COMMIT");
        const returnedCount = items.length;
        const truncated = BigInt(matchingCount) > BigInt(returnedCount);
        return {
          kind: "findOrders",
          data: {
            items,
            matchingCount,
            returnedCount,
            truncated
          }
        };
      }
      case "countOrders": {
        const query = `SELECT count(*)::text as matching_count FROM app_private.service_orders o ${whereSql}`;
        const res = await client.query(query, params);
        await client.query("COMMIT");
        return {
          kind: "countOrders",
          data: {
            matchingCount: res.rows[0]?.matching_count ?? "0"
          }
        };
      }
      case "totalQuotedValue": {
        const query = `
          SELECT
            count(*)::text as matching_count,
            coalesce(sum(o.quoted_price_sen), 0)::text as total_sen
          FROM app_private.service_orders o
          ${whereSql}
        `;
        const res = await client.query(query, params);
        await client.query("COMMIT");
        const row = res.rows[0] ?? { matching_count: "0", total_sen: "0" };
        return {
          kind: "totalQuotedValue",
          data: {
            matchingCount: row.matching_count,
            totalQuotedValue: senToMyr(row.total_sen)
          }
        };
      }
      case "rankTechnicians": {
        const metric = plan.rankingMetric ?? "orderCount";
        const query = `
          SELECT
            t.id as technician_id,
            t.display_name as technician_name,
            count(o.id)::text as order_count,
            coalesce(sum(o.quoted_price_sen), 0)::text as total_sen
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          ${whereSql}
          GROUP BY t.id, t.display_name
        `;
        const res = await client.query(query, params);
        await client.query("COMMIT");
        const rows = res.rows.map((r) => ({
          technician: { id: r.technician_id, name: r.technician_name },
          orderCount: r.order_count,
          totalQuotedValue: senToMyr(r.total_sen.toString()),
          orderCountBig: BigInt(r.order_count),
          quotedSenBig: BigInt(r.total_sen)
        }));
        rows.sort((a, b) => {
          const comp = metric === "orderCount" ? b.orderCountBig > a.orderCountBig ? 1 : b.orderCountBig < a.orderCountBig ? -1 : 0 : b.quotedSenBig > a.quotedSenBig ? 1 : b.quotedSenBig < a.quotedSenBig ? -1 : 0;
          if (comp !== 0) return comp;
          const nameComp = a.technician.name.localeCompare(b.technician.name);
          if (nameComp !== 0) return nameComp;
          return a.technician.id.localeCompare(b.technician.id);
        });
        const items = [];
        let currentRank = 1;
        for (let i = 0; i < rows.length; i++) {
          const item = rows[i];
          if (i > 0) {
            const prev = rows[i - 1];
            const prevMetric = metric === "orderCount" ? prev.orderCountBig : prev.quotedSenBig;
            const currMetric = metric === "orderCount" ? item.orderCountBig : item.quotedSenBig;
            if (currMetric !== prevMetric) {
              currentRank = i + 1;
            }
          }
          items.push({
            technician: item.technician,
            rank: currentRank,
            orderCount: item.orderCount,
            totalQuotedValue: item.totalQuotedValue
          });
        }
        return {
          kind: "rankTechnicians",
          data: {
            items,
            metric
          }
        };
      }
      case "lookupOrder": {
        const orderNumberVal = parseOrderNumberValue(plan.orderNumber);
        const query = `
          SELECT
            o.id,
            o.order_number_value,
            o.customer_name,
            o.service_type,
            o.quoted_price_sen,
            o.status,
            o.created_at,
            o.assigned_at,
            o.assigned_technician_id,
            t.display_name as technician_name
          FROM app_private.service_orders o
          JOIN app_private.technicians t ON t.id = o.assigned_technician_id
          WHERE o.order_number_value = $1
        `;
        const res = await client.query(query, [orderNumberVal.toString()]);
        await client.query("COMMIT");
        const row = res.rows[0];
        let order = null;
        if (row) {
          order = {
            id: row.id,
            orderNumber: formatOrderNumber2(row.order_number_value),
            customerName: row.customer_name,
            serviceType: row.service_type,
            technician: { id: row.assigned_technician_id, name: row.technician_name },
            status: "assigned",
            quotedPrice: {
              currency: "MYR",
              amount: senToMyr(row.quoted_price_sen.toString())
            },
            createdAt: new Date(row.created_at).toISOString(),
            assignedAt: new Date(row.assigned_at).toISOString()
          };
        }
        return {
          kind: "lookupOrder",
          data: { order }
        };
      }
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
    });
    throw error;
  } finally {
    client.release();
  }
}

// apps/api/src/operations-assistant/provider.ts
function generateDeterministicSummary(evidence, resolved) {
  const timeDesc = resolved.intervalLabel;
  const filterParts = [];
  if (resolved.technician) filterParts.push(`assigned to ${resolved.technician.name}`);
  if (resolved.serviceType) filterParts.push(`for ${resolved.serviceType} service`);
  if (resolved.customerName) filterParts.push(`matching customer "${resolved.customerName}"`);
  if (resolved.serviceText) filterParts.push(`matching text "${resolved.serviceText}"`);
  const filterDesc = filterParts.length > 0 ? ` (${filterParts.join(", ")})` : "";
  switch (evidence.kind) {
    case "countOrders":
      return `Found ${evidence.data.matchingCount} service order${evidence.data.matchingCount === "1" ? "" : "s"} for ${timeDesc}${filterDesc}.`;
    case "totalQuotedValue":
      return `Total quoted value for ${timeDesc}${filterDesc} is MYR ${evidence.data.totalQuotedValue} across ${evidence.data.matchingCount} order${evidence.data.matchingCount === "1" ? "" : "s"}. Quoted value reflects estimated quotes and does not represent collected revenue.`;
    case "findOrders": {
      const { matchingCount, returnedCount, truncated } = evidence.data;
      if (matchingCount === "0") {
        return `No service orders found for ${timeDesc}${filterDesc}.`;
      }
      const countNote = truncated ? `Showing the 25 most recent orders out of ${matchingCount} matching orders` : `Showing all ${returnedCount} matching order${returnedCount === 1 ? "" : "s"}`;
      return `${countNote} for ${timeDesc}${filterDesc}.`;
    }
    case "rankTechnicians": {
      const { items, metric } = evidence.data;
      if (items.length === 0) {
        return `No technician ranking available for ${timeDesc}${filterDesc} as no matching orders were found.`;
      }
      const metricLabel = metric === "orderCount" ? "order count" : "total quoted value";
      const topTech = items[0];
      const valStr = metric === "orderCount" ? `${topTech.orderCount} orders` : `MYR ${topTech.totalQuotedValue}`;
      return `Technician ranking by ${metricLabel} for ${timeDesc}${filterDesc}: ${topTech.technician.name} is ranked #1 with ${valStr}. Assignment ranking reflects assigned workload and does not imply completion or quality.`;
    }
    case "lookupOrder": {
      const { order } = evidence.data;
      if (!order) {
        return "No order was found matching the requested order number in recorded history.";
      }
      return `Order ${order.orderNumber} is assigned to ${order.technician.name} for ${order.serviceType} service with quoted price MYR ${order.quotedPrice.amount}.`;
    }
  }
}
function extractJsonText(raw) {
  let text2 = raw.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fenceMatch = text2.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    text2 = fenceMatch[1].trim();
  } else {
    const firstBrace = text2.indexOf("{");
    const lastBrace = text2.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      text2 = text2.slice(firstBrace, lastBrace + 1).trim();
    }
  }
  return text2;
}
function buildProviderRetrievalDto(plan, resolved, evidence) {
  const baseFilters = {
    technicianName: resolved.technician ? resolved.technician.name : null,
    serviceType: resolved.serviceType,
    dateBasis: resolved.dateBasis,
    mytInterval: resolved.intervalLabel,
    customerNameSearch: resolved.customerName,
    serviceTextSearch: resolved.serviceText
  };
  switch (evidence.kind) {
    case "findOrders": {
      const orderRows = evidence.data.items.map((item) => ({
        orderNumber: item.orderNumber,
        serviceType: item.serviceType,
        technicianName: item.technician.name,
        quote: `MYR ${item.quotedPrice.amount}`,
        createdAtMyt: item.createdAt,
        assignedAtMyt: item.assignedAt
      }));
      return {
        operation: "findOrders",
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount,
        orderRows
      };
    }
    case "countOrders":
      return {
        operation: "countOrders",
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount
      };
    case "totalQuotedValue":
      return {
        operation: "totalQuotedValue",
        filters: baseFilters,
        matchingCount: evidence.data.matchingCount,
        totalQuotedValue: `MYR ${evidence.data.totalQuotedValue}`
      };
    case "rankTechnicians": {
      const rankings = evidence.data.items.map((item) => ({
        technicianName: item.technician.name,
        rank: item.rank,
        orderCount: item.orderCount,
        totalQuotedValue: `MYR ${item.totalQuotedValue}`
      }));
      return {
        operation: "rankTechnicians",
        filters: baseFilters,
        matchingCount: evidence.data.items.length.toString(),
        rankingMetric: evidence.data.metric,
        rankings
      };
    }
    case "lookupOrder": {
      const { order } = evidence.data;
      const orderLookup = order ? {
        found: true,
        orderNumber: order.orderNumber,
        serviceType: order.serviceType,
        technicianName: order.technician.name,
        quote: `MYR ${order.quotedPrice.amount}`,
        createdAtMyt: order.createdAt,
        assignedAtMyt: order.assignedAt
      } : { found: false };
      return {
        operation: "lookupOrder",
        filters: baseFilters,
        matchingCount: order ? "1" : "0",
        orderLookup
      };
    }
  }
}
var OpenAiChatCompletionsProvider = class {
  constructor(config) {
    this.config = config;
  }
  async interpretQuestion(question, recentExchanges, previousQuery, technicians, capturedNow, signal) {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.apiKey || !this.config.model) {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "AI assistant is not configured on this server.");
    }
    const currentMytDay = capturedNow.toISOString().split("T")[0];
    const systemPrompt = buildSystemPrompt(technicians, currentMytDay);
    const messages = [
      { role: "system", content: systemPrompt }
    ];
    if (previousQuery) {
      messages.push({
        role: "system",
        content: `Previous validated query state: ${JSON.stringify(previousQuery)}`
      });
    }
    for (const ex of recentExchanges.slice(-6)) {
      messages.push({ role: "user", content: ex.question });
      messages.push({ role: "assistant", content: ex.narrative });
    }
    messages.push({ role: "user", content: question });
    const endpoint = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2e4);
    const abortHandler = () => controller.abort();
    signal?.addEventListener("abort", abortHandler);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0,
          max_tokens: 1e3
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI provider returned an error.");
      }
      const body = await res.json();
      const choice = body?.choices?.[0];
      if (choice?.finish_reason && choice.finish_reason !== "stop") {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI model output was truncated.");
      }
      const content = choice?.message?.content?.trim();
      if (!content) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI provider returned an empty response.");
      }
      const jsonText = extractJsonText(content);
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI provider returned invalid JSON.");
      }
      if (parsed.kind === "clarification") {
        return {
          kind: "clarification",
          message: String(parsed.message || "Please clarify your request."),
          choices: Array.isArray(parsed.choices) ? parsed.choices : void 0
        };
      }
      if (parsed.kind === "unsupported") {
        return {
          kind: "unsupported",
          message: String(parsed.message || "This operational query is not supported."),
          suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : void 0
        };
      }
      if (parsed.kind === "query" && parsed.plan) {
        const validated = validateQueryPlan(parsed.plan);
        if (!validated.valid) {
          throw new AppError(503, "SERVICE_UNAVAILABLE", `AI query plan validation failed: ${validated.error}`);
        }
        return { kind: "query", plan: validated.plan };
      }
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Unrecognized AI interpretation response format.");
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (controller.signal.aborted || signal?.aborted) {
        throw new AppError(503, "SERVICE_UNAVAILABLE", "AI interpretation request timed out or was cancelled.");
      }
      throw new AppError(503, "SERVICE_UNAVAILABLE", "Failed to communicate with AI provider.");
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
    }
  }
  async generateSummary(dto, question, recentExchanges, signal) {
    if (!this.config.enabled || !this.config.baseUrl || !this.config.apiKey || !this.config.model) {
      return { narrative: "", source: "deterministic" };
    }
    const systemPrompt = `You are an AI Operations Assistant summarizing operational aircon service orders.
Summarize the factual results provided in the JSON data accurately and concisely.
Rules:
- Never quote personal information, customer names, phone numbers, addresses, or admin notes.
- Do not invent numbers, orders, or completion statuses. Quoted value is NOT revenue.
- Assignment does not imply completion.
- Distinguish quotes from revenue clearly.
- Keep the summary short (2-3 sentences max).`;
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
      { role: "user", content: `Retrieved Facts JSON: ${JSON.stringify(dto)}` }
    ];
    const endpoint = `${this.config.baseUrl}/chat/completions`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2e4);
    const abortHandler = () => controller.abort();
    signal?.addEventListener("abort", abortHandler);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          temperature: 0,
          max_tokens: 1e3
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        return { narrative: "", source: "deterministic" };
      }
      const body = await res.json();
      const rawNarrative = body?.choices?.[0]?.message?.content?.trim();
      if (!rawNarrative) {
        return { narrative: "", source: "deterministic" };
      }
      const narrative = rawNarrative.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
      if (!narrative) {
        return { narrative: "", source: "deterministic" };
      }
      if (dto.matchingCount && !narrative.includes(dto.matchingCount) && dto.matchingCount !== "0") {
        return { narrative: "", source: "deterministic" };
      }
      return { narrative, source: "ai" };
    } catch {
      return { narrative: "", source: "deterministic" };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abortHandler);
    }
  }
};

// apps/api/src/operations-assistant/routes.ts
function registerOperationsAssistantRoutes(app) {
  app.post("/api/operations-assistant/query", { bodyLimit: 131072 }, async (request, reply) => {
    const actor = await requireOrderReader(request, reply);
    reply.header("Cache-Control", "no-store");
    const csrfHeader = request.headers["x-csrf-protection"];
    if (csrfHeader !== "1") {
      throw new AppError(403, "CSRF_REJECTED", "Missing or invalid X-CSRF-Protection header.");
    }
    const validation = validateAssistantRequest(request.body);
    if (!validation.valid) {
      throw new AppError(
        validation.code === "MALFORMED_REQUEST" ? 400 : 422,
        validation.code,
        validation.error
      );
    }
    const queryRequest = validation.request;
    let provider;
    if (app.operationsAssistantProvider) {
      provider = app.operationsAssistantProvider;
    } else if (app.config.aiEnabled && app.config.aiBaseUrl && app.config.aiApiKey && app.config.aiModel) {
      provider = new OpenAiChatCompletionsProvider({
        enabled: true,
        baseUrl: app.config.aiBaseUrl,
        apiKey: app.config.aiApiKey,
        model: app.config.aiModel
      });
    } else {
      throw new AppError(503, "SERVICE_UNAVAILABLE", "AI assistant is not configured on this server.");
    }
    const capturedNow = /* @__PURE__ */ new Date();
    const startTime = Date.now();
    await admitQueryRequest(app.db, request.id, actor.accountId, capturedNow, {
      dailyLimit: app.config.aiDailyQuestionLimit ?? 500,
      globalConcurrency: app.config.aiGlobalConcurrency ?? 4
    });
    const requestAbortController = new AbortController();
    const deadlineTimer = setTimeout(() => requestAbortController.abort(), 45e3);
    const onClientClose = () => requestAbortController.abort();
    request.raw.on("close", onClientClose);
    let plan;
    let outcome = "error";
    try {
      const technicians = await loadTechniciansReference(app.db);
      const interpretation = await provider.interpretQuestion(
        queryRequest.question,
        queryRequest.recentExchanges,
        queryRequest.previousQuery,
        technicians,
        capturedNow,
        requestAbortController.signal
      );
      if (interpretation.kind === "clarification") {
        outcome = "clarification";
        return reply.send({ data: interpretation });
      }
      if (interpretation.kind === "unsupported") {
        outcome = "unsupported";
        return reply.send({ data: interpretation });
      }
      plan = interpretation.plan;
      const resolved = compileResolvedFilters(plan, technicians, capturedNow);
      const evidence = await executeAssistantQuery(app.db, plan, resolved);
      const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
      let narrative = "";
      let summarySource = "deterministic";
      const dto = buildProviderRetrievalDto(plan, resolved, evidence);
      try {
        const summaryRes = await provider.generateSummary(
          dto,
          queryRequest.question,
          queryRequest.recentExchanges,
          requestAbortController.signal
        );
        if (summaryRes.narrative && summaryRes.source === "ai") {
          narrative = summaryRes.narrative;
          summarySource = "ai";
        } else {
          narrative = generateDeterministicSummary(evidence, resolved);
          summarySource = "deterministic";
        }
      } catch {
        narrative = generateDeterministicSummary(evidence, resolved);
        summarySource = "deterministic";
      }
      outcome = "answer";
      const responseData = {
        kind: "answer",
        operation: plan.operation,
        query: plan,
        resolvedFilters: resolved,
        retrievedAt,
        narrative,
        summarySource,
        evidence
      };
      return reply.send({ data: responseData });
    } finally {
      clearTimeout(deadlineTimer);
      request.raw.off("close", onClientClose);
      await releaseAdmissionLease(app.db, request.id);
      console.info(
        JSON.stringify({
          requestId: request.id,
          actorId: actor.accountId,
          operation: plan?.operation,
          outcome,
          durationMs: Date.now() - startTime
        })
      );
    }
  });
}

// apps/api/src/app.ts
function buildApp(config, pool) {
  const app = Fastify({ logger: false, requestIdHeader: false, genReqId: () => randomUUID(), trustProxy: config.trustedProxy.length ? config.trustedProxy : false, bodyLimit: 196608 });
  app.decorate("config", config);
  app.decorate("db", pool ?? createPool(config));
  app.addHook("onRequest", async (req, reply) => {
    reply.header("X-Request-ID", req.id).header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff").header("Referrer-Policy", "no-referrer").header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.url.startsWith("/api") && ["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) assertMutationOrigin(req);
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof AppError) return sendApiError(reply, error, req.id);
    const code = error.code;
    const status = code === "FST_ERR_CTP_BODY_TOO_LARGE" ? 413 : code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ? 415 : error.statusCode === 400 ? 400 : void 0;
    return sendApiError(reply, status ? new AppError(status, status === 413 ? "PAYLOAD_TOO_LARGE" : status === 415 ? "UNSUPPORTED_MEDIA_TYPE" : "MALFORMED_REQUEST", "The request could not be read.") : error, req.id);
  });
  app.setNotFoundHandler((req, reply) => sendApiError(reply, new AppError(404, "NOT_FOUND", "Not found."), req.id));
  registerAuthRoutes(app);
  registerListingRoutes(app);
  registerOrderEditorRoutes(app);
  registerOrderDetailRoutes(app);
  registerOperationsAssistantRoutes(app);
  app.addHook("onClose", async () => {
    if (!pool) await app.db.end();
  });
  return app;
}

// apps/api/src/config.ts
import ipaddr2 from "ipaddr.js";
function loadConfig(env = process.env) {
  const mode = env.NODE_ENV ?? "development";
  if (!["development", "test", "production"].includes(mode)) throw new Error("Invalid NODE_ENV");
  const production = mode === "production";
  let origin;
  try {
    origin = new URL(env.PUBLIC_ORIGIN ?? "http://localhost:5173");
  } catch {
    throw new Error("Invalid PUBLIC_ORIGIN");
  }
  if (!["http:", "https:"].includes(origin.protocol)) throw new Error("PUBLIC_ORIGIN must use HTTP or HTTPS");
  if (origin.origin !== env.PUBLIC_ORIGIN && env.PUBLIC_ORIGIN) throw new Error("PUBLIC_ORIGIN must be a canonical origin");
  if (production && origin.protocol !== "https:") throw new Error("Production requires HTTPS");
  if (!production && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)) throw new Error("Development cookie mode requires a loopback origin");
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  try {
    const database = new URL(env.DATABASE_URL);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !database.hostname) throw new Error();
  } catch {
    throw new Error("Invalid DATABASE_URL");
  }
  if (!env.LOGIN_LIMIT_HMAC_SECRET || Buffer.byteLength(env.LOGIN_LIMIT_HMAC_SECRET) < 32) throw new Error("LOGIN_LIMIT_HMAC_SECRET requires at least 32 bytes");
  const host = env.HOST ?? "127.0.0.1";
  const poolMax = Number(env.DB_POOL_MAX ?? 10);
  if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 50) throw new Error("Invalid DB_POOL_MAX");
  const port = Number(env.PORT ?? 3e3);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid PORT");
  const trustedProxy = env.TRUSTED_PROXY_CIDRS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [];
  try {
    for (const address of trustedProxy) {
      if (address.includes("/")) {
        if (ipaddr2.parseCIDR(address)[1] === 0) throw new Error();
      } else ipaddr2.parse(address);
    }
  } catch {
    throw new Error("TRUSTED_PROXY_CIDRS requires specific IP addresses or non-global CIDRs");
  }
  const aiEnabled = env.AI_ENABLED === "true";
  let aiBaseUrl;
  if (aiEnabled) {
    if (!env.AI_BASE_URL) throw new Error("AI_BASE_URL is required when AI is enabled");
    try {
      const u = new URL(env.AI_BASE_URL);
      if (u.search || u.hash || u.username || u.password) throw new Error();
      if (production && u.protocol !== "https:") throw new Error();
      if (!["http:", "https:"].includes(u.protocol)) throw new Error();
      aiBaseUrl = u.origin + u.pathname.replace(/\/+$/, "");
    } catch {
      throw new Error("Invalid AI_BASE_URL");
    }
    if (!env.AI_API_KEY) throw new Error("AI_API_KEY is required when AI is enabled");
    if (!env.AI_MODEL) throw new Error("AI_MODEL is required when AI is enabled");
  }
  const aiDailyQuestionLimit = Number(env.AI_DAILY_QUESTION_LIMIT ?? 500);
  if (!Number.isInteger(aiDailyQuestionLimit) || aiDailyQuestionLimit < 1) throw new Error("Invalid AI_DAILY_QUESTION_LIMIT");
  const aiGlobalConcurrency = Number(env.AI_GLOBAL_CONCURRENCY ?? 4);
  if (!Number.isInteger(aiGlobalConcurrency) || aiGlobalConcurrency < 1) throw new Error("Invalid AI_GLOBAL_CONCURRENCY");
  return {
    databaseUrl: env.DATABASE_URL,
    publicOrigin: origin.origin,
    production,
    host,
    port,
    poolMax,
    trustedProxy,
    hmacSecret: env.LOGIN_LIMIT_HMAC_SECRET,
    aiEnabled,
    aiBaseUrl,
    aiApiKey: env.AI_API_KEY,
    aiModel: env.AI_MODEL,
    aiDailyQuestionLimit,
    aiGlobalConcurrency
  };
}

// apps/api/src/serverless.ts
var appInstance = null;
var initPromise = null;
async function getFastify() {
  if (appInstance) return appInstance;
  if (!initPromise) {
    initPromise = (async () => {
      const publicOrigin = process.env.PUBLIC_ORIGIN || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : void 0) || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : void 0) || "https://utopia-task.vercel.app";
      const config = loadConfig({
        ...process.env,
        PUBLIC_ORIGIN: publicOrigin,
        DB_POOL_MAX: process.env.DB_POOL_MAX || "2"
      });
      const app = buildApp(config);
      await app.ready();
      appInstance = app;
      return app;
    })();
  }
  return initPromise;
}
async function handler(req, res) {
  const app = await getFastify();
  await new Promise((resolve2, reject) => {
    res.on("finish", resolve2);
    res.on("close", resolve2);
    res.on("error", reject);
    app.server.emit("request", req, res);
  });
}
export {
  handler as default
};
