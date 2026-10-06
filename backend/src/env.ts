/** The slice of the R2 bucket API we use (so tests can fake it). */
export interface BucketLike {
  put(key: string, value: ArrayBuffer | Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}
/** The slice of the D1 API we use (so the Node SQLite driver and tests can provide the same shape). */
export interface D1Like {
  prepare(sql: string): { bind(...params: unknown[]): { all(): Promise<{ results?: unknown[]; meta?: { changes?: number } }> } };
  batch(stmts: unknown[]): Promise<{ results?: unknown[]; meta?: { changes?: number } }[]>;
}
/** The slice of a Cloudflare Queue producer we use. */
export interface QueueLike { send(message: unknown): Promise<void> }

export interface Env {
  ENVIRONMENT?: 'development' | 'production' | 'test';
  /** Cloudflare D1 binding (production). */
  DB?: D1Like;
  /** SQLite file path for the local Node server / tests (ignored when the D1 binding exists). */
  SQLITE_PATH?: string;
  /** HMAC secret for verification codes. REQUIRED in production (wrangler secret put APP_SECRET). */
  APP_SECRET?: string;
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  /** e.g. http://127.0.0.1:8025 — dev inbox (Mailpit HTTP API). */
  MAILPIT_URL?: string;
  /** "1" skips DNS MX lookups (tests / offline). */
  SKIP_MX?: string;
  /** "1" trusts X-Forwarded-For (only for local dev; on Cloudflare CF-Connecting-IP is used). */
  TRUST_PROXY_HEADERS?: string;
  /** Comma-separated extra allowed Origins for state-changing requests. */
  ALLOWED_ORIGINS?: string;
  /** Multiplies every rate limit (e2e tests). */
  RATE_LIMIT_MULTIPLIER?: string;
  /** OpenAI-compatible chat API key (DeepSeek by default). Unset → every AI feature falls back to the rule-based path. */
  AI_API_KEY?: string;
  /** Alias for AI_API_KEY. */
  DEEPSEEK_API_KEY?: string;
  /** Default https://api.deepseek.com — any OpenAI-compatible endpoint works. */
  AI_BASE_URL?: string;
  /** Default deepseek-chat. */
  AI_MODEL?: string;
  /** Max provider calls per UTC day across the whole platform (cost guard). Default 2000. */
  AI_DAILY_BUDGET?: string;
  /** Provider timeout in ms (default 25000). */
  AI_TIMEOUT_MS?: string;
  /** Max provider calls per user per day. Default 30. */
  AI_USER_DAILY?: string;
  /** Public base URL used for links in e-mails (e.g. https://careermatch.example). Falls back to the request origin. */
  APP_URL?: string;
  /** Telegram bot token from @BotFather. Unset → the Telegram feature is off (endpoints answer "unavailable"). */
  TELEGRAM_BOT_TOKEN?: string;
  /** Shared secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token; the webhook rejects anything else. */
  TELEGRAM_WEBHOOK_SECRET?: string;
  /** Bot username without @ (used to build the t.me deep link). */
  TELEGRAM_BOT_USERNAME?: string;
  /** Default https://api.telegram.org (override in tests). */
  TELEGRAM_API_BASE?: string;
  /** Sentry DSN (https://<key>@<host>/<project>). Unset → error reporting is off. */
  SENTRY_DSN?: string;
  /** Release/version tag attached to Sentry events. */
  RELEASE?: string;
  /** Cloudflare Turnstile secret. Unset → captcha is off. */
  TURNSTILE_SECRET?: string;
  /** Public Turnstile site key (served to the frontend via /api/public/config). */
  TURNSTILE_SITEKEY?: string;
  /** Cloudflare Email Sending binding (`[[send_email]] name = "EMAIL"`): the default mail transport on Workers when bound. */
  EMAIL?: { send(message: { from: string | { email: string; name?: string }; to: string | string[]; subject: string; text?: string; html?: string; headers?: Record<string, string> }): Promise<unknown> };
  /** R2 bucket for CV files. Unbound → CVs stay in the database (D1 limits a row to 2 MB, so the upload cap drops to 1 MB). */
  CV_BUCKET?: BucketLike;
  /** Cloudflare Queue producer for background jobs. Unbound → jobs run inline (default). */
  JOBS?: QueueLike;
  /** Workers AI binding (`[ai] binding = "AI"`): used for embeddings with a multilingual model. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  /** Embeddings via any OpenAI-compatible /embeddings endpoint (alternative to the Workers AI binding). */
  EMBED_API_KEY?: string;
  EMBED_BASE_URL?: string;
  /** Default: @cf/baai/bge-m3 (Workers AI) or text-embedding-3-small (OpenAI-compatible). */
  EMBED_MODEL?: string;
  /** Static assets binding (Workers Assets). */
  ASSETS?: { fetch: (req: Request) => Promise<Response> };
}

export const isProd = (env: Env) => env.ENVIRONMENT === 'production';
export const isTest = (env: Env) => env.ENVIRONMENT === 'test';

export function appSecret(env: Env): string {
  if (env.APP_SECRET) return env.APP_SECRET;
  if (isProd(env)) throw new Error('APP_SECRET is required in production');
  return 'dev-only-insecure-secret-change-me';
}
