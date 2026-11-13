import fs from 'fs';

const md = fs.readFileSync('./Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md','utf8');

const TARGET_JOBNAME = 'rear cylinder';

const family = {
  engineFamily: 'Twin Cam 1999-2017',
  platformHints: ['TRG','SFT','DYN'],
  yearSpan: { start: '00', end: '17' },
  yearSpanMode: 'inclusive'
};

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
    if (cols.length < 4) continue;

    const rawMatches = line.match(/\\[[0-9]{2}(?:-[0-9]{2})?:\\s*[A-Z0-9]+\\]/g) || [];

    rows.push({
      jtcCodeRaw: cols[0],
      jobNameRaw: cols[3],
      platformYearsRaw: rawMatches.join(' '),
      platformYearsRawRaw: rawMatches,
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

const blocks = [
  findSectionBlock(md,'## **Section 4.3: Engine, Top End, Cam Chest & Crankcase'),
  findSectionBlock(md,'## **Section 4.6: Primary Drive, Clutch, Transmission & Final Drive Belt'),
].filter(Boolean);

let rows=[];
for(const b of blocks) rows.push(...parseTableRows(b));

const matches = rows.filter(r => (r.jobNameRaw||'').toLowerCase().includes(TARGET_JOBNAME));
if (!matches.length){
  console.log('No matches');
  process.exit(1);
}

const row = matches[0];

console.log('--- rawLine ---');
console.log(row.rawLine);
console.log('\nplatformYearsRawRaw (array):', row.platformYearsRawRaw);
console.log('\nplatformYearsRaw (string):', row.platformYearsRaw);
console.log('type(platformYearsRaw):', typeof row.platformYearsRaw);

console.log('\nplatformYearMatch =>', platformYearMatch(row.platformYearsRaw, family));
