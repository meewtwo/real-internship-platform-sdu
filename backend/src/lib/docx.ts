/** Minimal, dependency-free .docx writer (OOXML in a zip via fflate) for the résumé builder. Output is plain, ATS-friendly text. */
import { strToU8, zipSync } from 'fflate';
import { RESUME_LABELS as L, type ResumeDoc, type ResumeLang } from '@sdu/shared';

// XML 1.0 forbids most control characters; the validator already removed them, this is defence in depth for any other caller.
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const run = (text: string, o: { b?: boolean; i?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.b ? '<w:b/>' : ''}${o.i ? '<w:i/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (runs: string, o: { after?: number; before?: number; border?: boolean; indent?: number } = {}) =>
  `<w:p><w:pPr>${o.border ? '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="2F345C"/></w:pBdr>' : ''}<w:spacing w:before="${o.before ?? 0}" w:after="${o.after ?? 60}"/>${o.indent ? `<w:ind w:left="${o.indent}" w:hanging="200"/>` : ''}</w:pPr>${runs}</w:p>`;
const heading = (t: string) => para(run(t.toUpperCase(), { b: true, size: 24, color: '2F345C' }), { before: 200, after: 80, border: true });
const period = (start: string, end: string, present: string) => (start || end ? `${start || ''}${start && end ? ' – ' : ''}${end === 'present' ? present : end}` : '');

export function buildDocx(d: ResumeDoc, lang: ResumeLang): Uint8Array {
  const t = L[lang];
  const body: string[] = [];
  body.push(para(run(d.personal.fullName, { b: true, size: 40, color: '2F345C' }), { after: 40 }));
  if (d.personal.headline) body.push(para(run(d.personal.headline, { size: 26 }), { after: 40 }));
  const contact = [d.personal.email, d.personal.phone, d.personal.city, ...d.personal.links.map((l) => `${l.label}: ${l.url}`)].filter(Boolean);
  if (contact.length) body.push(para(run(contact.join('  |  '), { size: 20, color: '475569' }), { after: 80 }));
  if (d.summary) { body.push(heading(t.summary)); for (const line of d.summary.split('\n')) body.push(para(run(line))); }
  if (d.experience.length) {
    body.push(heading(t.experience));
    for (const e of d.experience) {
      body.push(para(run(e.role, { b: true }) + (e.company ? run(`, ${e.company}`, { b: true }) : '') + (e.location ? run(` — ${e.location}`) : ''), { after: 20, before: 80 }));
      const p = period(e.start, e.end, t.present); if (p) body.push(para(run(p, { i: true, size: 20, color: '475569' }), { after: 40 }));
      for (const b of e.bullets) body.push(para(run(`• ${b}`), { indent: 360, after: 30 }));
    }
  }
  if (d.education.length) {
    body.push(heading(t.education));
    for (const e of d.education) {
      body.push(para(run(e.institution, { b: true }) + (e.degree ? run(`, ${e.degree}`) : ''), { after: 20, before: 80 }));
      const p = period(e.start, e.end, t.present); if (p) body.push(para(run(p, { i: true, size: 20, color: '475569' }), { after: 20 }));
      if (e.details) body.push(para(run(e.details)));
    }
  }
  if (d.projects.length) {
    body.push(heading(t.projects));
    for (const p of d.projects) {
      body.push(para(run(p.name, { b: true }) + (p.url ? run(` — ${p.url}`, { size: 20, color: '475569' }) : ''), { after: 20, before: 80 }));
      if (p.description) body.push(para(run(p.description), { after: 20 }));
      if (p.tech.length) body.push(para(run(p.tech.join(', '), { i: true, size: 20 })));
    }
  }
  if (d.skills.length) { body.push(heading(t.skills)); for (const g of d.skills) body.push(para((g.group ? run(`${g.group}: `, { b: true }) : '') + run(g.items.join(', ')))); }
  if (d.languages.length) { body.push(heading(t.languages)); body.push(para(run(d.languages.map((l) => (l.level ? `${l.name} (${l.level})` : l.name)).join(', ')))); }
  if (d.certificates.length) { body.push(heading(t.certificates)); for (const c of d.certificates) body.push(para(run(c.name, { b: true }) + run([c.issuer, c.year].filter(Boolean).length ? ` — ${[c.issuer, c.year].filter(Boolean).join(', ')}` : ''), { after: 30 })); }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
  });
}
