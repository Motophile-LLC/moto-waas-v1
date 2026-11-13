import fs from 'fs';

const workdir = process.cwd();
const jtcPath = process.env.JTC || (workdir + '/Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md');
const cometicTxtPath = process.env.COMETIC_TXT || (workdir + '/pdf_text_alt/cometic.txt');
const jamesTxtPath = process.env.JAMES_TXT || (workdir + '/pdf_text_alt/james.txt');
const outPath = process.env.OUT || (workdir + '/parsed_catalog.json');

const ENGINE_FAMILIES = [
  {
    engineFamily: 'Milwaukee-Eight 2017-2025',
    platformHints: ['TRG','SFT','TRK'],
    yearSpan: { start: '17', end: '25' },
    yearSpanMode: 'inclusive',
  },
  {
    engineFamily: 'Twin Cam 1999-2017',
    platformHints: ['TRG','SFT','DYN'],
    yearSpan: { start: '00', end: '17' },
    yearSpanMode: 'inclusive',
  },
  {
    engineFamily: 'Evolution Sportster (XL) 2000-2022',
    platformHints: ['XL'],
    yearSpan: { start: '00', end: '22' },
    yearSpanMode: 'inclusive',
  },
  {
    engineFamily: 'Evolution 1340 (Big Twin)',
    platformHints: ['SFT','TRG','DYN'],
    yearSpan: { start: '00', end: '00' },
    yearSpanMode: 'exact',
  },
  {
    engineFamily: 'Revolution (V-Rod) 2002-2017',
    platformHints: ['VRSC'],
    yearSpan: { start: '02', end: '17' },
    yearSpanMode: 'inclusive',
  },
  {
    engineFamily: 'Revolution Max 2021-2025',
    platformHints: ['REV'],
    yearSpan: { start: '21', end: '25' },
    yearSpanMode: 'inclusive',
  },
];

const KEYWORDS = ['primary','stator','cam','rocker','cylinder'];

function read(p){ return fs.readFileSync(p,'utf8'); }

function stripJtcCode(raw){
  if (!raw) return null;
  let s = raw.toString();
  s = s.replace(/\\`/g,'`');
  s = s.replace(/[\`]/g,'');
  s = s.replace(/\\/g,'');
  s = s.trim();
  return s || null;
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

  const rows=[];
  for (let i = headerIdx+1; i < lines.length; i++){
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
      platformYearsRaw: cols[5],
    });
  }
  return rows;
}

function jobKeywords(jobNameRaw){
  const lower = (jobNameRaw || '').toLowerCase();
  return KEYWORDS.filter(k => lower.includes(k));
}

function platformYearMatch(platformYearsRaw, family){
  if (!platformYearsRaw) return false;
  const txt = platformYearsRaw.toString();

  const platformOk = family.platformHints.some(p => txt.includes(p));
  if (!platformOk) return false;

  // Extract patterns like [00-16:TRG] or [17-25:SFT] or [02:VRSC]
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

function extractPartsByActiveSectionHeader(catalogText, strictRegex, normalizeFn, manufacturer, keywordList, limit){
  const lines = catalogText.split(/\r?\n/);
  const parts = [];
  const re = new RegExp(strictRegex.source,'i');

  const kwLower = keywordList.map(k => k.toLowerCase());

  // Clustering-based header detection:
  // - Track most recent non-empty "descriptive" line.
  // - When we see a strict part-number token, that recent line becomes the active header.
  // - Additionally, if we encounter known marker words, we append them to the active header.
  let recentDescriptiveLine = '';
  let activeHeader = '';

  const markerWords = ['PRIMARY', 'TOP END', 'CAM CHANGE', 'ROCKER BOX', 'GASKET KIT', 'CYLINDER', 'STATOR'];

  function looksDescriptive(line){
    const t = (line || '').trim();
    if (t.length < 3) return false;
    // avoid very short artifacts / numbers-only lines
    if (/^[0-9]+$/.test(t)) return false;
    // avoid separator-like lines
    if (/^-{3,}$/.test(t)) return false;
    // allow title-ish lines
    return true;
  }

  for (let i = 0; i < lines.length; i++){
    const line = (lines[i] || '').trim();
    if (!line) continue;

    if (looksDescriptive(line)) {
      recentDescriptiveLine = line;
    }

    // marker injection (helps when headers are mangled)
    const upper = line.toUpperCase();
    for (const mw of markerWords){
      if (upper.includes(mw)) {
        activeHeader = (recentDescriptiveLine ? recentDescriptiveLine + ' ' : '') + mw;
        // keep marker in place for subsequent tokens
      }
    }

    const m = line.match(re);
    if (!m) continue;

    const raw = m[0];
    const pn = normalizeFn(raw);
    if (!pn) continue;

    // Set active header from clustering: immediately preceding descriptive line
    if (recentDescriptiveLine) activeHeader = recentDescriptiveLine;

    // Context acceptance:
    // 1) Prefer marker-word signal if present in the active header.
    // 2) If no marker words are present, fall back to jobName keyword matching.
    if (kwLower.length){
      const headerLower = (activeHeader || '').toLowerCase();
      const markerLower = markerWords.map(m => m.toLowerCase());
      const markerHit = markerLower.some(mw => headerLower.includes(mw));

      if (markerHit) {
        // accept based on marker presence
      } else {
        const ok = kwLower.some(k => headerLower.includes(k.toLowerCase()));
        if (!ok) continue;
      }
    }

    parts.push({ manufacturer, partNumber: pn, description: line.trim(), qty: 1 });
    if (parts.length >= limit) break;
  }

  return parts;
}

function validateEntry(o){
  if (!o || typeof o !== 'object') return false;
  if (!o.engineFamily || !o.jobName || !o.jtcCode) return false;
  if (!Array.isArray(o.requiredParts) || o.requiredParts.length < 2) return false;
  for (const p of o.requiredParts){
    if (!p.partNumber || !p.manufacturer) return false;
    if (p.manufacturer === 'Cometic'){
      if (!/^C\d[0-9A-Z\-]{2,}$/i.test(p.partNumber)) return false;
    }
    if (p.manufacturer === 'James'){
      if (!/^JGI-[0-9A-Z\-]+$/i.test(p.partNumber)) return false;
    }
  }
  return true;
}

const jtcMd = read(jtcPath);
const cometicTxt = read(cometicTxtPath);
const jamesTxt = read(jamesTxtPath);

let parsed = [];
try { parsed = JSON.parse(read(outPath)); } catch { parsed = []; }
if (!Array.isArray(parsed)) parsed = [];

// Create dedupe set for (engineFamily|jtcCode|jobName)
const existingKeys = new Set(parsed.map(o => `${o.engineFamily}|${o.jtcCode}|${o.jobName}`));

const sectionHeaders = [
  '## **Section 4.3: Engine, Top End, Cam Chest & Crankcase',
  '## **Section 4.6: Primary Drive, Clutch, Transmission & Final Drive Belt',
];

for (const family of ENGINE_FAMILIES){
  console.log('Processing family', family.engineFamily);

  let rows = [];
  for (const sh of sectionHeaders){
    const block = findSectionBlock(jtcMd, sh);
    if (!block) continue;
    rows.push(...parseTableRows(block));
  }

  rows = rows.filter(r => KEYWORDS.some(k => (r.jobNameRaw||'').toLowerCase().includes(k)));
  rows = rows.filter(r => platformYearMatch(r.platformYearsRaw, family));

  let appended = 0;

  for (const r of rows){
    const jtcCode = stripJtcCode(r.jtcCodeRaw);
    const jobName = (r.jobNameRaw || '').trim();
    if (!jtcCode || !jobName) continue;

    const key = `${family.engineFamily}|${jtcCode}|${jobName}`;
    if (existingKeys.has(key)) continue;

    const kw = jobKeywords(jobName);

    const comParts = extractPartsByActiveSectionHeader(
      cometicTxt,
      /^C\d[0-9A-Z\-]{2,}$/i,
      normalizeCometic,
      'Cometic',
      kw,
      1
    );
    const jaParts = extractPartsByActiveSectionHeader(
      jamesTxt,
      /^JGI-[0-9A-Z\-]+$/i,
      normalizeJames,
      'James',
      kw,
      1
    );

    if (!comParts.length || !jaParts.length) continue;

    const entry = {
      engineFamily: family.engineFamily,
      jobName,
      jtcCode,
      baseWarrantyHours: 2.5,
      requiredParts: [comParts[0], jaParts[0]],
    };

    if (!validateEntry(entry)) continue;

    parsed.push(entry);
    existingKeys.add(key);
    appended++;

    // periodic write-through
    if (appended % 25 === 0) {
      fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
      console.log('  appended so far for this family:', appended);
    }
  }

  // final write-through per family
  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Finished family', family.engineFamily, 'appended:', appended, 'TOTAL:', parsed.length);
}

// Final sanity: ensure no UNKNOWN
if (JSON.stringify(parsed).includes('UNKNOWN')){
  console.warn('Warning: UNKNOWN detected in parsed_catalog.json');
}

fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
console.log('Master automation complete. Total objects:', parsed.length);
