#!/usr/bin/env node
// Lightweight performance budget — fails CI if the renderer payload grows past
// agreed ceilings, so the single-file renderer can't balloon unnoticed. Full
// modularization / bundling is tracked separately (V6_ROADMAP.md · T8). Raise a
// ceiling here deliberately (with intent) rather than letting it drift.
import fs from 'node:fs';

const BUDGETS = [
  { file: 'electron-app/renderer/app.js',         maxKB: 300 },
  { file: 'electron-app/renderer/app-visuals.js', maxKB: 60 },
  { file: 'electron-app/renderer/app-affect.js',  maxKB: 60 },
  { file: 'electron-app/renderer/app-data.js',    maxKB: 45 },
  { file: 'electron-app/renderer/index.html',     maxKB: 175 },
];

let fail = 0;
console.log('· performance budget');
for (const b of BUDGETS) {
  let kb;
  try { kb = fs.statSync(b.file).size / 1024; }
  catch { console.error(`  ✖ missing ${b.file}`); fail++; continue; }
  const ok = kb <= b.maxKB;
  console.log(`  ${ok ? '✓' : '✖'} ${b.file}: ${kb.toFixed(1)} KB / ${b.maxKB} KB`);
  if (!ok) fail++;
}

if (fail) {
  console.error(`\n✖ perf-budget: ${fail} file(s) over budget. Trim the payload, or raise the ceiling deliberately in scripts/perf-budget.mjs.\n`);
  process.exit(1);
}
console.log('\n✓ perf-budget: within budget.\n');
