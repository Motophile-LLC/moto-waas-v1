import fs from 'fs';

const workdir = process.cwd();
const jtcPath = process.env.JTC || (workdir + '/Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md');
const cometicTxtPath = process.env.COMETIC_TXT || (workdir + '/pdf_text_alt/cometic.txt');
const jamesTxtPath = process.env.JAMES_TXT || (workdir + '/pdf_text_alt/james.txt');
const outPath = process.env.OUT || (workdir + '/parsed_catalog.json');

const ENGINE_FAMILIES = [
  { engineFamily: 'Milwaukee-Eight 2017-2025', platformHints: ['TRG','SFT','TRK'], yearSpan: { start: '17', end: '25' }, yearSpanMode: 'inclusive' },
  { engineFamily: 'Twin Cam 1999-2017', platformHints: ['TRG','SFT','DYN'], yearSpan: { start: '00', end: '17' }, yearSpanMode: 'inclusive' },
  { engineFamily: 'Evolution Sportster (XL) 2000-2022', platformHints: ['XL'], yearSpan: { start: '00', end: '22' }, yearSpanMode: 'inclusive' },
  { engineFamily: 'Evolution 1340 (Big Twin)', platformHints: ['SFT','TRG','DYN'], yearSpan: { start: '00', end: '00' }, yearSpanMode: 'exact' },
  { engineFamily: 'Revolution (V-Rod) 2002-2017', platformHints: ['VRSC'], yearSpan: { start: '02', end: '17' }, yearSpanMode: 'inclusive' },
  { engineFamily: 'Revolution Max 2021-2025', platformHints: ['REV'], yearSpan: { start: '21', end: '25' }, yearSpanMode: 'inclusive' },
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

    if (!line.startsWith('\\|') && !line.startsWith('|')) {
      if (rows.length) break;
      continue;
    }
    if (line.includes(':---')) continue;

    const cols = line.split(/\\\||\|/).map(s => s.replace(/\\/g, '').trim()).filter(Boolean);
    if (cols.length < 4) continue;

    const jtcCodeRaw = cols[0];
    const operation = cols[2] || '';
    const condition = cols[3] || '';
    const hoursColRaw = cols[5] || cols[cols.length - 1] || '';

    const jobNameRaw = (condition && condition !== '—' && condition !== '-') 
      ? `${operation} - ${condition}` 
      : operation;

    rows.push({
      jtcCodeRaw,
      jobNameRaw,
      hoursColRaw,
      platformYearsRaw: (() => {
        const strict = (line.match(/\[\d{2}(?:-\d{2})?:\s*[A-Z0-9]+\]/g) || []);
        if (strict.length) return strict.join(' ');
        const loose = (line.match(/\d{2}(?:-\d{2})?:[A-Z]{2,4}/g) || []);
        return loose.join(' ');
      })(),
      rawLine: line,
    });
  }
  return rows;
}

function extractHoursForFamily(hoursColText, family) {
  const cleanText = (hoursColText || '').replace(/\\/g, '');
  const regex = /\*\*(\d+(?:\.\d+)?)h\*\*\[([^\]]+)\]/g;
  let match;
  let fallbackHours = null;

  while ((match = regex.exec(cleanText)) !== null) {
    const hours = parseFloat(match[1]);
    const specsStr = match[2];
    const specs = specsStr.split(';');
    
    for (const spec of specs) {
      const parts = spec.trim().split(':');
      if (parts.length < 2) continue;
      const yearsPart = parts[0].trim();
      const modelsPart = parts[1].trim();

      const models = modelsPart.split(',').map(m => m.trim());
      
      const directMatch = family.platformHints.some(hint => models.includes(hint)) || models.includes('ALL');

      const yearMatch = yearsPart.match(/(\d{2})(?:-(\d{2}))?/);
      if (!yearMatch) continue;

      const a = parseInt(yearMatch[1], 10);
      const b = yearMatch[2] ? parseInt(yearMatch[2], 10) : a;

      const fStart = parseInt(family.yearSpan.start, 10);
      const fEnd = parseInt(family.yearSpan.end, 10);

      let yearOverlap = false;
      if (family.yearSpanMode === 'exact') {
        if (a <= fStart && b >= fStart) yearOverlap = true;
      } else {
        yearOverlap = !(b < fStart || a > fEnd);
      }

      if (directMatch && yearOverlap) {
        return hours;
      }

      if (!fallbackHours && yearOverlap) {
        let modelPrefixMatch = false;
        if (family.platformHints.includes('TRG') && models.some(m => m.startsWith('FLH') || m.startsWith('FLT') || m.startsWith('FLR') || m.startsWith('FLP'))) modelPrefixMatch = true;
        if (family.platformHints.includes('SFT') && models.some(m => m.startsWith('FXS') || m.startsWith('FLS') || m.startsWith('FXST') || m.startsWith('FLST'))) modelPrefixMatch = true;
        if (family.platformHints.includes('DYN') && models.some(m => m.startsWith('FXD') || m.startsWith('FLD'))) modelPrefixMatch = true;
        if (family.platformHints.includes('XL') && models.some(m => m.startsWith('XL') || m.startsWith('XR'))) modelPrefixMatch = true;
        if (family.platformHints.includes('VRSC') && models.some(m => m.startsWith('VR') || m.startsWith('VRS'))) modelPrefixMatch = true;
        if (family.platformHints.includes('REV') && models.some(m => m.startsWith('RA') || m.startsWith('RH') || m.includes('REV'))) modelPrefixMatch = true;

        if (modelPrefixMatch) {
          fallbackHours = hours;
        }
      }
    }
  }
  return fallbackHours;
}

function extractYYPlatformPairs(s){
  if (!s) return [];
  const txt = String(s);

  const re = /\[(\d{2})(?:-(\d{2}))?:\s*([A-Z0-9]+)\]|(\d{2})(?:-(\d{2}))?:\s*([A-Z0-9]+)/g;
  const pairs = [];

  let m;
  while ((m = re.exec(txt))){
    if (m[1] !== undefined){
      const y1 = parseInt(m[1],10);
      const y2 = parseInt(m[2] ?? m[1],10);
      const platform = m[3];
      pairs.push({y1,y2,platform});
    } else {
      const y1 = parseInt(m[4],10);
      const y2 = parseInt(m[5] ?? m[4],10);
      const platform = m[6];
      pairs.push({y1,y2,platform});
    }
  }
  return pairs;
}

function platformYearMatch(platformYearsRaw, family){
  const pairs = extractYYPlatformPairs(platformYearsRaw);
  if (!pairs.length) return false;

  for (const p of pairs){
    if (!family.platformHints.includes(p.platform)) continue;

    const a = p.y1;
    const b = p.y2;

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

    // Primary acceptance: marker (either in header or adj). If no marker, tie-break by job keywords.
    let accept = true;
    if (kwLower.length){
      if (!(markerHit || adjMarker)){
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

function validateEntry(o){
  if (!o || typeof o !== 'object') return false;
  if (!o.engineFamily || !o.jobName || !o.jtcCode) return false;
  if (!Array.isArray(o.requiredParts) || o.requiredParts.length < 1) return false;
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
const existingKeys = new Set();

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

    const comParts = extractPartsByActiveSectionHeader(cometicTxt, /^C\d[0-9A-Z\-]{2,}$/i, normalizeCometic, 'Cometic', kw, 1);
    const jaParts = extractPartsByActiveSectionHeader(jamesTxt, /^JGI-[0-9A-Z\-]+$/i, normalizeJames, 'James', kw, 1);

    if (!comParts.length && !jaParts.length) continue;

    const requiredParts = [];
    if (comParts[0]) requiredParts.push(comParts[0]);
    if (jaParts[0]) requiredParts.push(jaParts[0]);

    const baseWarrantyHours = extractHoursForFamily(r.hoursColRaw, family) || 2.5;

    const entry = { engineFamily: family.engineFamily, jobName, jtcCode, baseWarrantyHours, requiredParts };
    if (!validateEntry(entry)) continue;

    parsed.push(entry);
    existingKeys.add(key);
    appended++;

    if (appended % 25 === 0) fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
  }

  fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
  console.log('Finished family', family.engineFamily, 'appended', appended, 'TOTAL', parsed.length);
}

fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2), 'utf8');
console.log('DONE. Total objects:', parsed.length);
