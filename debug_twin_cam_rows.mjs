import fs from 'fs';

const md = fs.readFileSync('./Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md','utf8');

function findSectionBlock(md, sectionHeader){
  const idx = md.indexOf(sectionHeader);
  if (idx === -1) return null;
  const next = md.indexOf('\n## ', idx + 1);
  return next === -1 ? md.slice(idx) : md.slice(idx, next);
}

function parseTableRows(block){
  const lines = block.split(/\r?\n/);
  const headerIdx = lines.findIndex(l => l.includes('JTC Code'));
  if (headerIdx === -1) return { headerIdx:-1, headerCols:[], rows:[] };

  const headerLine = lines[headerIdx];
  const headerCols = headerLine.replace(/^\\\|/,'').split('\\|').map(s=>s.trim()).filter(Boolean);

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

    rows.push({
      jtcCodeRaw: cols[0],
      jobNameRaw: cols[3],
      colsLen: cols.length
    });
    if (rows.length >= 50) break;
  }
  return { headerIdx, headerCols, rows };
}

const sections = [
  '## **Section 4.3: Engine, Top End, Cam Chest & Crankcase',
  '## **Section 4.6: Primary Drive, Clutch, Transmission & Final Drive Belt',
];

for (const header of sections){
  const block = findSectionBlock(md, header);
  console.log('SECTION', header);
  console.log('blockLen', block?.length);
  const parsed = parseTableRows(block);
  console.log('headerIdx', parsed.headerIdx, 'headerCols', parsed.headerCols);
  console.log('rowsFound', parsed.rows.length);
  const filtered = parsed.rows.filter(r => ['primary','stator','cam','rocker','cylinder'].some(k => (r.jobNameRaw||'').toLowerCase().includes(k)));
  console.log('filtered', filtered.length);
  console.log('sampleAll', parsed.rows.slice(0,3));
  console.log('sampleFiltered', filtered.slice(0,3));
}
