function extractYYPlatformPairs(s){
  if (!s) return [];
  const txt = String(s);

  // Collect patterns of forms:
  // 1) [08-13:XL]
  // 2) 02-03:TRG
  // 3) 17:VRSC
  const re = /\[(\d{2})(?:-(\d{2}))?:\s*([A-Z0-9]+)\]|(\d{2})(?:-(\d{2}))?:\s*([A-Z0-9]+)/g;
  const pairs = [];

  let m;
  while ((m = re.exec(txt))){
    if (m[1] !== undefined){
      const y1 = m[1];
      const y2 = m[2] ?? m[1];
      const platform = m[3];
      pairs.push({ y1: parseInt(y1,10), y2: parseInt(y2,10), platform });
    } else {
      const y1 = m[4];
      const y2 = m[5] ?? m[4];
      const platform = m[6];
      pairs.push({ y1: parseInt(y1,10), y2: parseInt(y2,10), platform });
    }
  }

  return pairs;
}

function platformYearMatch(platformYearsRaw, family){
  const pairs = extractYYPlatformPairs(platformYearsRaw);
  if (!pairs.length) return false;

  const platformOk = pairs.some(p => family.platformHints.includes(p.platform));
  if (!platformOk) return false;

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

const familyM8 = {
  platformHints: ['TRG','SFT','TRK'],
  yearSpan: { start: '17', end: '25' },
  yearSpanMode: 'inclusive'
};

const tests = [
  '02-03:TRG',
  '08-13:XL',
  '17-25:SFT',
  '21:REV',
  '[08-13:XL]',
  '14-16:FLHT',
  '17-22:TRG; 17-25:TRK'
];

for (const t of tests){
  console.log('\nINPUT:', t);
  console.log('pairs:', extractYYPlatformPairs(t));
  console.log('match M8:', platformYearMatch(t, familyM8));
}
