import fs from 'fs';

const workdir = process.cwd();
const jtcPath = workdir + '/Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md';
const cometicTxtPath = workdir + '/pdf_text_alt/cometic.txt';
const jamesTxtPath = workdir + '/pdf_text_alt/james.txt';

const jtcMd = fs.readFileSync(jtcPath, 'utf8');
const cometicTxt = fs.readFileSync(cometicTxtPath, 'utf8');
const jamesTxt = fs.readFileSync(jamesTxtPath, 'utf8');

const TARGET_JOBNAME = 'rear cylinder';

const family = {
  engineFamily: 'Twin Cam 1999-2017',
  platformHints: ['TRG','SFT','DYN'],
  yearSpan: { start: '00', end: '17' },
  yearSpanMode: 'inclusive'
};

const KEYWORDS = ['primary','stator','cam','rocker','cylinder'];

function stripJtcCode(raw){
  if (!raw) return null;
  let s = raw.toString();
  s = s.replace(/\\`/g,'`');
  s = s.replace(/[\`]/g,'');
  s = s.replace(/\\/g,'');
  return s.trim() || null;
}

function cleanPartNumber(raw){
  if (!raw) return null;
  let s = raw.toString().trim();
  s = s.replace(/^[\s\-•\*]+/,'');
  s = s.trim();
  s = s.replace(/[\s,;:.]+$/,'');
  return s;
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
    if (cols.length < 6) continue;

    rows.push({
      jtcCodeRaw: cols[0],
      jobNameRaw: cols[3],
      platformYearsRaw: (line.match(/\[\d{2}(?:-\d{2})?:\s*[A-Z0-9]+\]/g) || []).join(' '),
      rawLine: line
    });
  }

  return rows;
}

function platformYearMatch(platformYearsRaw, family){
  if (!platformYearsRaw) return false;
  const txt = platformYearsRaw.toString();
  const platformOk = family.platformHints.some(p => txt.includes(p));
  if (!platformOk) return false;

  const re = /\[(\d{2})(?:-(\d{2}))?:\s*([A-Z0-9]+)\]/g;
  let m;
  while ((m = re.exec(txt))){
    const y1 = m[1];
    const y2 = m[2] ?? m[1];
    const platform = m[3];

    if (!family.platformHints.includes(platform)) continue;

    const a = parseInt(y1,10);
    const b = parseInt(y2,10);

    if (family.yearSpanMode === 'exact'){
      const exact = parseInt(family.yearSpan.start,10);
      if (a <= exact && b >= exact) return true;
    } else {
      const start = parseInt(family.yearSpan.start,10);
      const end = parseInt(family.yearSpan.end,10);
      const overlap = !(b < start || a > end);
      if (overlap) return true;
    }
  }
  return false;
}

function jobKeywords(jobNameRaw){
  const lower = (jobNameRaw || '').toLowerCase();
  return KEYWORDS.filter(k => lower.includes(k));
}

function extractPartsByActiveSectionHeader(catalogText, strictRegex, normalizeFn, manufacturer, keywordList, limit){
  const lines = catalogText.split(/\r?\n/);
  const parts = [];
  const re = new RegExp(strictRegex.source,'i');

  const kwLower = keywordList.map(k => k.toLowerCase());

  const markerWords = ['PRIMARY', 'TOP END', 'CAM CHANGE', 'ROCKER BOX', 'GASKET KIT', 'CYLINDER', 'STATOR'];
  const markerLower = markerWords.map(m => m.toLowerCase());
  const markerAnchors = ['primary','top end','stator','cylinder','cam','rocker','gasket'];

  let recentDescriptiveLine = '';
  let activeHeader = '';

  function looksDescriptive(line){
    const t = (line || '').trim();
    if (t.length < 3) return false;
    if (/^[0-9]+$/.test(t)) return false;
    if (/^-{3,}$/.test(t)) return false;
    return true;
  }

  function hasMarkerInSameOrAdj(line, idx){
    const sliceStart = Math.max(0, idx - 1);
    const sliceEnd = Math.min(lines.length, idx + 2);
    const ctx = lines.slice(sliceStart, sliceEnd).join('\n').toLowerCase();
    return markerAnchors.some(m => ctx.includes(m));
  }

  for (let i = 0; i < lines.length; i++){
    if (parts.length >= limit) break;
    const line = (lines[i] || '').trim();
    if (!line) continue;

    if (looksDescriptive(line)) recentDescriptiveLine = line;

    const upper = line.toUpperCase();
    for (const mw of markerWords){
      if (upper.includes(mw)) activeHeader = (recentDescriptiveLine ? recentDescriptiveLine + ' ' : '') + mw;
    }

    const m = line.match(re);
    if (!m) continue;

    const raw = m[0];
    const pn = normalizeFn(raw);
    if (!pn) continue;

    if (recentDescriptiveLine) activeHeader = recentDescriptiveLine;

    const headerLower = (activeHeader || '').toLowerCase();
    const markerHit = markerLower.some(mw => headerLower.includes(mw));
    const adjMarker = hasMarkerInSameOrAdj(line, i);

    // v2 acceptance with marker-based logic + job keyword fallback
    let accept = true;
    if (kwLower.length){
      if (!(markerHit || adjMarker)) {
        const ok = kwLower.some(k => headerLower.includes(k.toLowerCase()));
        if (!ok) accept = false;
      }
    }

    if (!accept) continue;

    parts.push({ manufacturer, partNumber: pn, description: line.trim(), qty: 1 });
    if (parts.length >= limit) break;
  }

  return parts;
}

const sectionHeaders = [
  '## **Section 4.3: Engine, Top End, Cam Chest & Crankcase',
  '## **Section 4.6: Primary Drive, Clutch, Transmission & Final Drive Belt',
];

let rows = [];
for (const sh of sectionHeaders){
  const block = findSectionBlock(jtcMd, sh);
  if (!block) continue;
  rows.push(...parseTableRows(block));
}

const matches = rows.filter(r => (r.jobNameRaw || '').toLowerCase().includes(TARGET_JOBNAME));
if (!matches.length){
  console.log('No matching rows for jobName:', TARGET_JOBNAME);
  process.exit(1);
}

const row = matches[0];
const jtcCode = stripJtcCode(row.jtcCodeRaw);
const kw = jobKeywords(row.jobNameRaw);

console.log('=== Sanity check: master_parse_catalogs_v2 path ===');
console.log('rawLine:', row.rawLine);
console.log('\nplatformYearsRaw (regex captured):', row.platformYearsRaw);
console.log('platformYearMatch:', platformYearMatch(row.platformYearsRaw, family));

const comParts = extractPartsByActiveSectionHeader(cometicTxt, /^C\d[0-9A-Z\-]{2,}$/i, normalizeCometic, 'Cometic', kw, 3);
const jaParts = extractPartsByActiveSectionHeader(jamesTxt, /^JGI-[0-9A-Z\-]+$/i, normalizeJames, 'James', kw, 3);

console.log('\nDerived keywordList:', kw);
console.log('\nCometic returned array:', comParts);
console.log('\nJames returned array:', jaParts);
