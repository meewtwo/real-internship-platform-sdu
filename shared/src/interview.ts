import type { ErrorCode, FieldErrors } from './errors';
import { httpsUrl } from './resumeDoc';

export const INTERVIEW_FORMATS = ['onsite', 'online', 'phone'] as const;
export type InterviewFormat = (typeof INTERVIEW_FORMATS)[number];
export const INTERVIEW_MIN_LEAD_MIN = 30;
export const INTERVIEW_MAX_AHEAD_DAYS = 90;
export const MESSAGE_MAX = 2000;

const CTRL_LINE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const cp = (s: string) => Array.from(s).length;

export type Res<T> = { ok: true; data: T } | { ok: false; code?: ErrorCode; fields: FieldErrors };

/** Chat message: plain text, newlines kept (max 2 blank lines), control/bidi characters removed. */
export function validateMessage(v: unknown): Res<string> {
  if (typeof v !== 'string') return { ok: false, code: 'MESSAGE_INVALID', fields: {} };
  if (v.length > MESSAGE_MAX * 4) return { ok: false, code: 'TEXT_TOO_LONG', fields: {} };
  const s = v.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g, '').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!s) return { ok: false, code: 'MESSAGE_INVALID', fields: {} };
  if (cp(s) > MESSAGE_MAX) return { ok: false, code: 'TEXT_TOO_LONG', fields: {} };
  return { ok: true, data: s };
}

export interface InterviewProposal { applicationId: string; startsAt: string; durationMin: number; format: InterviewFormat; location: string; note: string | null }
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function validateInterviewProposal(input: unknown, now: Date = new Date()): Res<InterviewProposal> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, code: 'VALIDATION_FAILED', fields: {} };
  const o = input as Record<string, unknown>;
  if (Object.keys(o).some((k) => !['applicationId', 'startsAt', 'durationMin', 'format', 'location', 'note'].includes(k))) return { ok: false, code: 'UNKNOWN_FIELDS', fields: {} };
  const f: FieldErrors = {};
  const applicationId = typeof o.applicationId === 'string' && UUID.test(o.applicationId) ? o.applicationId : (f.applicationId = 'REQUIRED', '');
  let startsAt = '';
  if (typeof o.startsAt !== 'string' || !ISO.test(o.startsAt)) f.startsAt = 'INTERVIEW_TIME_INVALID';
  else {
    const t = new Date(o.startsAt).getTime();
    if (!Number.isFinite(t) || t < now.getTime() + INTERVIEW_MIN_LEAD_MIN * 60_000 || t > now.getTime() + INTERVIEW_MAX_AHEAD_DAYS * 86_400_000) f.startsAt = 'INTERVIEW_TIME_INVALID';
    else startsAt = new Date(t).toISOString();
  }
  const d = typeof o.durationMin === 'number' ? o.durationMin : NaN;
  if (!Number.isInteger(d) || d < 15 || d > 240) f.durationMin = 'INTERVIEW_TIME_INVALID';
  const format = (INTERVIEW_FORMATS as readonly unknown[]).includes(o.format) ? (o.format as InterviewFormat) : (f.format = 'VALIDATION_FAILED', 'onsite' as InterviewFormat);
  let location = '';
  if (typeof o.location !== 'string') f.location = 'REQUIRED';
  else {
    location = o.location.normalize('NFC').replace(CTRL_LINE, ' ').replace(/\s+/g, ' ').trim();
    if (!location) f.location = 'REQUIRED';
    else if (cp(location) > 200) f.location = 'TEXT_TOO_LONG';
    else if (format === 'online' && /^[a-z][a-z0-9+.-]*:/i.test(location) && !httpsUrl(location)) f.location = 'RESUME_URL_INVALID'; // an online meeting link must be a real https link (blocks javascript:/data: etc.)
  }
  let note: string | null = null;
  if (o.note !== undefined && o.note !== null) {
    if (typeof o.note !== 'string') f.note = 'VALIDATION_FAILED';
    else { const n = o.note.normalize('NFC').replace(CTRL_LINE, ' ').replace(/\s+/g, ' ').trim(); if (cp(n) > 500) f.note = 'TEXT_TOO_LONG'; else note = n || null; }
  }
  return Object.keys(f).length ? { ok: false, fields: f } : { ok: true, data: { applicationId, startsAt, durationMin: d, format, location, note } };
}
