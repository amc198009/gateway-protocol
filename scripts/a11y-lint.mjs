#!/usr/bin/env node
// Lightweight, dependency-free static accessibility lint for the renderer
// markup. It is NOT a full axe run (that needs a real DOM); it catches the
// highest-value, low-false-positive WCAG issues in static HTML so regressions
// fail CI. Dynamic content is out of scope by design.
//
// Usage: node scripts/a11y-lint.mjs [file ...]   (defaults to the renderer)
import fs from 'node:fs';

const files = process.argv.slice(2);
if (!files.length) files.push('electron-app/renderer/index.html');

let errors = 0;
const err = (file, msg) => { errors++; console.error(`  ✖ ${file}: ${msg}`); };

for (const file of files) {
  let html;
  try { html = fs.readFileSync(file, 'utf8'); }
  catch { console.error(`  ✖ cannot read ${file}`); errors++; continue; }
  console.log(`\n· ${file}`);

  // 1. <html lang>
  if (!/<html[^>]*\blang\s*=/.test(html)) err(file, '<html> is missing a lang attribute (WCAG 3.1.1)');

  // 2. A main landmark must exist (WCAG 1.3.1 / 2.4.1)
  if (!/<main[\s>]/.test(html) && !/role\s*=\s*["']main["']/.test(html))
    err(file, 'no main landmark (<main> or role="main") found');

  // 3. <img> without alt (WCAG 1.1.1)
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt\s*=/.test(m[0])) err(file, `<img> without alt: ${m[0].slice(0, 80)}`);
  }

  // 4. Duplicate ids (WCAG 4.1.1)
  const ids = {};
  for (const m of html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)) ids[m[1]] = (ids[m[1]] || 0) + 1;
  for (const [id, n] of Object.entries(ids)) if (n > 1) err(file, `duplicate id "${id}" (${n}×)`);

  // 5. Positive tabindex is an anti-pattern (WCAG 2.4.3)
  for (const m of html.matchAll(/\btabindex\s*=\s*["']?(\d+)/gi))
    if (parseInt(m[1], 10) > 0) err(file, `positive tabindex="${m[1]}" — use 0 or -1`);

  // 6. Buttons with no text and no accessible name (WCAG 4.1.2)
  for (const m of html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)) {
    const attrs = m[1], inner = m[2].replace(/<[^>]*>/g, '').trim();
    const named = /\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\btitle\s*=/.test(attrs);
    if (!inner && !named) err(file, `<button> with no text or accessible name: <button${attrs.slice(0, 60)}>`);
  }

  // 7. Inputs without an accessible name (WCAG 1.3.1 / 4.1.2)
  const labelFor = new Set([...html.matchAll(/<label\b[^>]*\bfor\s*=\s*["']([^"']+)["']/gi)].map(m => m[1]));
  // Spans of <label>…</label> so we can treat wrapped inputs as labeled.
  const labelSpans = [...html.matchAll(/<label\b[^>]*>[\s\S]*?<\/label>/gi)].map(m => [m.index, m.index + m[0].length]);
  const wrapped = (idx) => labelSpans.some(([a, b]) => idx > a && idx < b);
  for (const m of html.matchAll(/<input\b([^>]*)>/gi)) {
    const attrs = m[1];
    const type = (attrs.match(/\btype\s*=\s*["']([^"']+)["']/i) || [, 'text'])[1].toLowerCase();
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(type)) continue;
    const id = (attrs.match(/\bid\s*=\s*["']([^"']+)["']/i) || [])[1];
    const named = /\baria-label\s*=/.test(attrs) || /\baria-labelledby\s*=/.test(attrs) || /\btitle\s*=/.test(attrs)
      || (id && labelFor.has(id)) || wrapped(m.index);
    if (!named) err(file, `<input type="${type}"> without a label/aria-label/title: <input${attrs.slice(0, 70)}>`);
  }
}

if (errors) { console.error(`\n✖ a11y-lint: ${errors} issue(s) found.\n`); process.exit(1); }
console.log('\n✓ a11y-lint: no issues found.\n');
