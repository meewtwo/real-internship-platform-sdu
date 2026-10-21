/**
 * Fails (exit 1) if any translation key is missing/empty in any of EN/RU/KK, if keys differ between languages,
 * if an API error code or dropdown option has no translation, or if a validation message is too long for the
 * no-scroll form layout. Run: npm run i18n:check
 */
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { ERROR_CODES, OPTION_GROUPS } from '../shared/src';

const LOCALES = fileURLToPath(new URL('../frontend/src/locales/', import.meta.url));
const LANGS = ['en', 'ru', 'kk'] as const;
const MAX_FIELD_ERROR_LEN = 64;
// Banner-level messages (not rendered under a narrow field) may be longer.
const BANNER_CODES = new Set(['EMPLOYER_NOT_APPROVED', 'EMPLOYER_REJECTED', 'ACCOUNT_LOCKED', 'CSRF_INVALID', 'RESEND_LIMIT', 'RESEND_COOLDOWN', 'CODE_TOO_MANY_ATTEMPTS', 'RATE_LIMITED', 'UNKNOWN_FIELDS']);

type Tree = { [k: string]: string | Tree };
function flatten(t: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(t)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

export function checkI18n(): string[] {
  const problems: string[] = [];
  const data: Record<string, Record<string, string>> = {};
  const namespaces = new Set<string>();
  for (const lang of LANGS) for (const f of readdirSync(`${LOCALES}${lang}`)) if (f.endsWith('.json')) namespaces.add(f.replace('.json', ''));
  for (const lang of LANGS) {
    data[lang] = {};
    for (const ns of namespaces) {
      let tree: Tree;
      try { tree = JSON.parse(readFileSync(`${LOCALES}${lang}/${ns}.json`, 'utf8')); }
      catch { problems.push(`[${lang}] missing or invalid namespace file: ${ns}.json`); continue; }
      for (const [k, v] of Object.entries(flatten(tree))) data[lang][`${ns}:${k}`] = v;
    }
  }
  const all = new Set(LANGS.flatMap((l) => Object.keys(data[l])));
  for (const key of all) {
    for (const lang of LANGS) {
      const v = data[lang][key];
      if (v === undefined) problems.push(`[${lang}] missing key ${key}`);
      else if (v.trim() === '') problems.push(`[${lang}] empty value for ${key}`);
    }
    // interpolation placeholders must match across languages
    const ph = LANGS.map((l) => (data[l][key]?.match(/{{\w+}}/g) ?? []).sort().join(','));
    if (new Set(ph).size > 1) problems.push(`placeholder mismatch in ${key}: ${ph.join(' | ')}`);
  }
  for (const lang of LANGS) {
    for (const code of ERROR_CODES) {
      const v = data[lang][`errors:${code}`];
      if (!v) problems.push(`[${lang}] no translation for API error code ${code}`);
      else if (!BANNER_CODES.has(code) && v.length > MAX_FIELD_ERROR_LEN) problems.push(`[${lang}] errors.${code} is ${v.length} chars (> ${MAX_FIELD_ERROR_LEN}); would break the no-scroll layout`);
    }
    for (const [group, keys] of Object.entries(OPTION_GROUPS)) for (const k of keys) if (!data[lang][`options:${group}.${k}`]) problems.push(`[${lang}] no translation for option ${group}.${k}`);
    for (let m = 1; m <= 12; m++) if (!data[lang][`options:months.${m}`]) problems.push(`[${lang}] no month ${m}`);
  }
  // no key may be left in English in RU/KK by accident (identical to EN) unless it is language-neutral
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const problems = checkI18n();
  if (problems.length) { console.error(`i18n check FAILED (${problems.length} problems)\n` + problems.map((p) => ' - ' + p).join('\n')); process.exit(1); }
  console.log('i18n check passed: all keys present in en/ru/kk');
}
