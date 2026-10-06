/** Minimal RFC 5545 writer for a single event. CRLF line endings, text escaping, 75-octet line folding (UTF-8 aware). */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function fold(line: string): string {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out: string[] = [];
  let cur = '', bytes = 0, limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (bytes + n > limit) { out.push(cur); cur = ' '; bytes = 1; limit = 75; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join('\r\n');
}

export interface IcsEvent { uid: string; start: Date; durationMin: number; summary: string; location: string; description: string; status: 'CONFIRMED' | 'TENTATIVE' | 'CANCELLED'; sequence?: number; now?: Date }

export function buildIcs(e: IcsEvent): string {
  const end = new Date(e.start.getTime() + e.durationMin * 60_000);
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//SDU Career Match//Interview//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    `UID:${e.uid}@careermatch`, `DTSTAMP:${utc(e.now ?? new Date())}`, `DTSTART:${utc(e.start)}`, `DTEND:${utc(end)}`, `SEQUENCE:${e.sequence ?? 0}`,
    `SUMMARY:${esc(e.summary)}`, `LOCATION:${esc(e.location)}`, `DESCRIPTION:${esc(e.description)}`, `STATUS:${e.status}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Interview in 1 hour', 'TRIGGER:-PT1H', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
