import { unzipSync } from 'fflate';
import type { ErrorCode } from '@sdu/shared';

export const PDF_MIME = 'application/pdf';
export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const MAX_CV_BYTES = 2 * 1024 * 1024;
const MAX_XML_BYTES = 8 * 1024 * 1024; // zip-bomb guard: refuse to inflate more than this

export type ParsedCv = { ok: true; mime: string; text: string } | { ok: false; code: ErrorCode };

const startsWith = (b: Uint8Array, s: string, at = 0) => [...s].every((c, i) => b[at + i] === c.charCodeAt(0));
const decodeXml = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** Detects the real type from magic bytes (the extension/mime sent by the client is never trusted) and extracts plain text. */
export async function parseCv(bytes: Uint8Array): Promise<ParsedCv> {
  if (startsWith(bytes, '%PDF-')) {
    try {
      const { extractText, getDocumentProxy } = await import('unpdf');
      const pdf = await getDocumentProxy(new Uint8Array(bytes));
      if (pdf.numPages > 30) return { ok: false, code: 'CV_UNREADABLE' };
      const { text } = await extractText(pdf, { mergePages: true });
      return finish(PDF_MIME, Array.isArray(text) ? text.join('\n') : text);
    } catch {
      return { ok: false, code: 'CV_UNREADABLE' };
    }
  }
  if (startsWith(bytes, 'PK\x03\x04')) {
    try {
      const files = unzipSync(bytes, { filter: (f) => f.name === 'word/document.xml' && f.originalSize <= MAX_XML_BYTES });
      const xml = files['word/document.xml'];
      if (!xml) return { ok: false, code: 'CV_TYPE_INVALID' };
      const raw = new TextDecoder('utf-8').decode(xml)
        .replace(/<w:tab\s*\/>/g, '\t').replace(/<w:br\s*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '');
      return finish(DOCX_MIME, decodeXml(raw));
    } catch {
      return { ok: false, code: 'CV_UNREADABLE' };
    }
  }
  return { ok: false, code: 'CV_TYPE_INVALID' };
}

function finish(mime: string, text: string): ParsedCv {
  const t = text.normalize('NFC').replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮﻿]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (t.replace(/\s/g, '').length < 20) return { ok: false, code: 'CV_EMPTY_TEXT' };
  return { ok: true, mime, text: t.slice(0, 200_000) };
}

/** Strips any path, control chars and quotes; keeps at most 120 chars. Returns null unless the extension is .pdf/.docx. */
export function safeFilename(name: string): string | null {
  const base = name.split(/[\\/]/).pop() ?? '';
  const cleaned = base.normalize('NFC').replace(/[\u0000-\u001F\u007F"<>|:*?]/g, '').trim();
  if (!/\.(pdf|docx)$/i.test(cleaned) || cleaned.length < 5) return null;
  if (cleaned.length <= 120) return cleaned;
  const ext = /\.(pdf|docx)$/i.exec(cleaned)![0];
  return cleaned.slice(0, 120 - ext.length) + ext;
}
