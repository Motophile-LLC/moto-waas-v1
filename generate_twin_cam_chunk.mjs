import fs from 'fs';

const workdir = process.cwd();
const jtcPath = process.env.JTC || (workdir + '/Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md');
const cometicTxt = process.env.COMETIC_TXT;
const jamesTxt = process.env.JAMES_TXT;
const outPath = process.env.OUT || (workdir + '/parsed_catalog.json');

const ENGINE_FAMILY = 'Twin Cam 1999-2017';

function read(p){ return fs.readFileSync(p,'utf8'); }

function stripJtcCode(raw){
  if (!raw) return null;
  let s = raw.toString();
  s = s.replace(/\\`/g,'`');
  // Remove backticks and any escaped backtick wrappers
  s = s.replace(/[`]/g,'');
  s = s.replace(/\\/g,'');
  s = s.trim();
  return s || null;
}

function cleanPartNumber(raw){
  if (!raw) return null;
  let s = raw.toString().trim();
  s = s.replace(/^[\s\-•\*]+/,'');
  s = s.replace(/[\s,;:.]+$/,'');
  return s.trim();
}

function normalizeCometic(part){
  const s = cleanPartNumber(part);
  if (!s) return null;
  const re = /^C\d[0-9A-Z\-]{2,}$/i;
  return re.test(s) ? s.toUpperCase() : null;
}

function normalizeJames(part){
  const s = cleanPartNumber(part);
  if (!s) return null;
  const re = /^JGI-[0-9A-Z\-]+$/i;
  return re.test(s) ? s.toUpperCase() : null;
}

function findSectionBlock(md, sectionHeader){
  const idx = md.indexOf(sectionHeader);
  if (idx === -1) return null;
  const next = md.indexOf('\n## ', idx + 1);
  return next === -1 ? md.slice(idx) : md.slice(idx, next);
}

function parseTableRows(block){
  const lines = block.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.includes('JTC Code'));
  if (headerIdx === -1) return [];

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++){
    const line = lines[i];
    if (line && line.startsWith('## ')) break;
    if (!line) continue;

    if (!line.startsWith('\\|')) {
      if (rows.length) break;
      continue;
    }

    if (line.includes(':---')) continue;

    const cols = line.replace(/^\\\|/,'').split('\\|').map(s=>s.trim()).filter(Boolean);
    if (cols.length < 4) continue;

    rows.push({
      jtcCodeRaw: cols[0],
      jobNameRaw: cols[3],
    });
  }
  return rows;
}

function jobKeywords(jobName){
  const lower = (jobName || '').toLowerCase();
  const keys = ['primary','stator','cam','rocker','cylinder'];
  return keys.filter(k => lower.includes(k));
}

function extractPartsByNearbyContext(catalogText, strictRegex, normalizeFn, manufacturer, keywordList, limit){
  const lines = catalogText.split(/\r?\n/);
  const parts = [];
  const re = new RegExp(strictRegex.source,'i');
  const kwLower = keywordList.map(k => k.toLowerCase());

  for (let i = 0; i < lines.length; i++){
    if (parts.length >= limit) break;
    const line = lines[i];
    if (!line) continue;

    const m = line.match(re);
    if (!m) continue;

    const raw = m[0];
    const pn = normalizeFn(raw);
    if (!pn) continue;

    // Context window: ±8 lines
    const start = Math.max(0, i - 8);
    const end = Math.min(lines.length, i + 9);
    const window = lines.slice(start, end).join('\n').toLowerCase();

    if (kwLower.length){
      const ok = kwLower.some(k => window.includes(k));
      if (!ok) continue;
    }

    parts.push({ manufacturer, partNumber: pn, description: lines[i].trim(), qty: 1 });
  }

  return parts;
}

const jtcMd = read(jtcPath);
if (!cometicTxt || !jamesTxt) throw new Error('Missing COMETIC_TXT or JAMES_TXT');

const cometic = read(cometicTxt);
const james = read(jamesTxt);

let parsed;
try { parsed = JSON.parse(read(outPath)); } catch { parsed = []; }
if (!Array.isArray(parsed)) parsed = [];

const blocks = [
  findSectionBlock(jtcMd, '## **Section 4.3: Engine, Top End, Cam Chest & Crankcase'),
  findSectionBlock(jtcMd, '## **Section 4.6: Primary Drive, Clutch, Transmission & Final Drive Belt'),
].filter(Boolean);

let rows=[];
for (const block of blocks){
  rows.push(...parseTableRows(block));
}

// keyword filter on jobName
const keywordKeys = ['primary','stator','cam','rocker','cylinder'];
rows = rows.filter(r => keywordKeys.some(k => (r.jobNameRaw||'').toLowerCase().includes(k)));

// generate up to 6 objects
const seen = new Set();
for (const r of rows){
  if (parsed.filter(o => o.engineFamily === ENGINE_FAMILY).length >= 6) break;
  const jobName = (r.jobNameRaw || '').trim();
  const jtcCode = stripJtcCode(r.jtcCodeRaw);
  if (!jobName || !jtcCode) continue;

  const key = jtcCode + '|' + jobName;
  if (seen.has(key)) continue;

  const kw = jobKeywords(jobName);

  const comParts = extractPartsByNearbyContext(
    cometic,
    /^C\d[0-9A-Z\-]{2,}$/i,
    normalizeCometic,
    'Cometic',
    kw,
    1
  );

  const jaParts = extractPartsByNearbyContext(
    james,
    /^JGI-[0-9A-Z\-]+$/i,
    normalizeJames,
    'James',
    kw,
    1
  );

  if (!comParts.length || !jaParts.length) continue;

  parsed.push({
    engineFamily: ENGINE_FAMILY,
    jobName,
    jtcCode,
    baseWarrantyHours: 2.5,
    requiredParts: [comParts[0], jaParts[0]]
  });
  seen.add(key);
}

fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
console.log('Twin Cam regenerated. Objects:', parsed.filter(o => o.engineFamily === ENGINE_FAMILY).length);
