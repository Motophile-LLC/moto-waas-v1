import fs from 'fs';

const workdir = process.cwd();
const jtcPath = process.env.JTC || `${workdir}/Harley-Davidson 2000-2025 Master JTC Labor Guide (Complete All-Models & Years).md`;
const cometicTxtPath = process.env.COMETIC_TXT || `${workdir}/pdf_text_alt/cometic.txt`;
const jamesTxtPath = process.env.JAMES_TXT || `${workdir}/pdf_text_alt/james.txt`;
const outPath = process.env.OUT || `${workdir}/parsed_catalog.json`;

// ---------------------------------------------------------------------------
// 1. Helpers: Year & Platform Normalization
// ---------------------------------------------------------------------------
function toFullYear(y) {
  const n = parseInt(y, 10);
  if (isNaN(n)) return null;
  if (n >= 1900) return n;
  return n >= 36 ? 1900 + n : 2000 + n;
}

function extractYearSpanFromText(text) {
  const t = (text || '').replace(/[–—]/g, '-');
  // Match "2017 to Present", "2007-Present", "17-UP", "2017-19", "07-16", "1999-2017", "1984 - 1999"
  let m = t.match(/\b(19\d{2}|20\d{2})\s*(?:to|-)\s*(?:Present|UP)\b/i);
  if (m) return [parseInt(m[1], 10), 2025];

  m = t.match(/\b(\d{2})\s*(?:to|-)\s*(?:Present|UP)\b/i);
  if (m) return [toFullYear(m[1]), 2025];

  m = t.match(/\b(19\d{2}|20\d{2})\s*-\s*(19\d{2}|20\d{2}|\d{2})\b/);
  if (m) {
    const y1 = parseInt(m[1], 10);
    let y2 = parseInt(m[2], 10);
    if (y2 < 100) y2 = Math.floor(y1 / 100) * 100 + y2;
    return [y1, y2];
  }

  m = t.match(/\b(\d{2})\s*-\s*(\d{2})\b/);
  if (m) {
    const y1 = toFullYear(m[1]);
    const y2 = toFullYear(m[2]);
    if (y1 && y2 && y2 >= y1) return [y1, y2];
  }

  m = t.match(/\b(20\d{2}|19[789]\d)\b/);
  if (m) {
    const y = parseInt(m[1], 10);
    return [y, y];
  }

  return null;
}

function inferPlatformsFromText(text) {
  const u = (text || '').toUpperCase();
  const plats = new Set();

  if (/\b(FLH|FLT|FLHR|FLHT|FLHX|FLTR|TOURING|ROAD KING|STREET GLIDE|ROAD GLIDE|ELECTRA)\b|\bFL\s+MODEL/i.test(u)) plats.add('TRG');
  if (/\b(FXST|FLST|SOFTAIL|FXBR|FXFB|FXLR|FXBB|FLHC|FLSB|FLDE|FLSL)\b/i.test(u)) plats.add('SFT');
  if (/\b(FXD|FLD|DYNA)\b/i.test(u)) plats.add('DYN');
  if (/\b(XL|XR1200|SPORTSTER|883|1200)\b/i.test(u) && !/SPORTSTER S/i.test(u)) plats.add('XL');
  if (/\b(VRSC|V-ROD|VROD|NIGHT ROD)\b/i.test(u)) plats.add('VRSC');
  if (/\b(REV MAX|REVOLUTION MAX|RA1250|RH1250|RH975|PAN AMERICA|SPORTSTER S|NIGHTSTER)\b/i.test(u)) plats.add('REV');
  if (/\b(TRIKE|TRI GLIDE|FREEWHEELER|FLHTCUTG|FLRT|FLTRT)\b/i.test(u)) plats.add('TRK');
  if (/\b(XG500|XG750|STREET 500|STREET 750|STREET ROD)\b/i.test(u)) plats.add('XG');

  // Engine-family fallbacks if no explicit model codes
  if (/\b(MILWAUKEE|M8|M-8)\b/i.test(u)) {
    plats.add('TRG'); plats.add('SFT'); plats.add('TRK');
  }
  if (/\b(TWIN CAM|TWIN-CAM|TC88|TC96|TC103|TC110)\b/i.test(u)) {
    plats.add('TRG'); plats.add('SFT'); plats.add('DYN');
  }
  if (/\b(BIG TWIN|EVOLUTION|EVO)\b/i.test(u) && !plats.has('XL')) {
    plats.add('TRG'); plats.add('SFT'); plats.add('DYN');
  }

  return [...plats];
}

function inferCategoriesFromText(text) {
  const u = (text || '').toLowerCase();
  const cats = new Set();

  if (/primary/.test(u) && /kit/.test(u)) cats.add('primary_kit');
  if (/primary/.test(u)) cats.add('primary');
  if (/derby|inspection cover/.test(u)) cats.add('derby_inspection');
  if (/cam/.test(u) && /kit/.test(u)) cats.add('cam_kit');
  if (/cam/.test(u)) cats.add('cam');
  if (/rocker/.test(u) && /kit/.test(u)) cats.add('rocker_kit');
  if (/rocker/.test(u)) cats.add('rocker');
  if (/head gasket|cylinder head/.test(u)) cats.add('head_gasket');
  if (/base gasket|cylinder base/.test(u)) cats.add('base_gasket');
  if (/top end|top-end|t\/e kit/.test(u)) cats.add('top_end');
  if (/valve|seal|spring/.test(u) && /valve/.test(u)) cats.add('valve');
  if (/pushrod|tappet|lifter/.test(u)) cats.add('pushrod_tappet');
  if (/exhaust|muffler|header/.test(u)) cats.add('exhaust');
  if (/intake|manifold|carb|throttle body|air cleaner/.test(u)) cats.add('intake');
  if (/transmission|trans|clutch|mainshaft/.test(u)) cats.add('transmission');
  if (/crankcase|crank|flywheel|main bearing|sprocket/.test(u)) cats.add('crankcase');
  if (/oil pump/.test(u)) cats.add('oil_pump');
  if (/oil filter|drain plug|oil change|oil o-ring/.test(u)) cats.add('oil_service');
  if (/stator|alternator|charging|rotor|magneto/.test(u)) cats.add('stator');
  if (/starter/.test(u)) cats.add('starter');
  if (/fork/.test(u) && /seal/.test(u) && !/drain/.test(u)) cats.add('fork_seal');
  if (/wheel/.test(u) && /seal|bearing/.test(u)) cats.add('wheel_seal');
  if (/complete engine/.test(u)) cats.add('complete_engine');

  return [...cats];
}

function isVintageOrExcluded(text) {
  return /\b(shovelhead|panhead|knucklehead|flathead|ironhead|4-speed|4 speed|pre-2000|1936|1948|1965|1970|1984)\b/i.test(text || '');
}

function inferEraTag(text) {
  const u = (text || '').toUpperCase();
  if (/\b(MILWAUKEE|M8|M-8)\b/.test(u)) return 'M8';
  if (/\b(TWIN CAM|TWIN-CAM|TC88|TC96|TC103|TC110|120R)\b/.test(u)) return 'TC';
  if (/\b(SPORTSTER|XL|883|1200)\b/.test(u) && !/SPORTSTER S/i.test(u)) return 'XL';
  if (/\b(V-ROD|VRSC)\b/.test(u)) return 'VRSC';
  if (/\b(REVOLUTION MAX|RA1250|RH1250|RH975)\b/.test(u)) return 'REV';
  if (/\b(EVOLUTION|EVO)\b/.test(u)) return 'EVO';
  return null;
}

// ---------------------------------------------------------------------------
// 2. Parse Cometic Harley-Davidson Catalog (Pages 178-220)
// ---------------------------------------------------------------------------
function parseCometicCatalog() {
  const lines = fs.readFileSync(cometicTxtPath, 'utf8').split(/\r?\n/);
  const hdStart = lines.findIndex(l => l.includes('=== PAGE 178 ==='));
  const hdLines = lines.slice(hdStart === -1 ? 0 : hdStart);

  let currentSection = 'Harley-Davidson Gaskets';
  const parts = [];
  const seen = new Set();

  for (let i = 0; i < hdLines.length; i++) {
    const line = hdLines[i].trim();
    if (!line || line.startsWith('=== PAGE') || /^(Gaskets for Harley-Davidson|Cometic Part #|OE#|Description|Price|Single|5 Pack)$/i.test(line)) continue;

    if (!/^C\d[0-9A-Z\-]{2,}/i.test(line) && !line.includes('...') && !line.includes('$') && line.length > 5 && line.length < 95 && !/^\d{5}-\d{2}/.test(line)) {
      if (/gasket|kit|primary|cam|rocker|head|base|exhaust|intake|transmission|seal|o-ring|milwaukee|twin cam|evo|sportster|v-rod|fork/i.test(line)) {
        currentSection = line.replace(/^[•.\s]+/, '').trim();
      }
    }

    const pm = line.match(/^(C\d[0-9A-Z\-]{2,})(?:\s|$|\.)/i);
    if (!pm) continue;

    const partNumber = pm[1].toUpperCase();
    // Skip 5-pack duplicates if we already have F1 or single, or keep unique
    const nextPartIdx = hdLines.slice(i + 1, i + 10).findIndex(l => {
      const lt = l.trim();
      if (/^C\d[0-9A-Z\-]{2,}(?:\s|$|\.)/i.test(lt)) return true;
      if (/^(Cometic Part #|Gaskets for Harley-Davidson|=== PAGE)/i.test(lt)) return true;
      if (!lt.includes('...') && !lt.includes('$') && /Gaskets?\s+(Big Twin|Sportster|Twin Cam|MLS)|Cover Gaskets/i.test(lt)) return true;
      return false;
    });
    const boundedLines = nextPartIdx === -1 ? hdLines.slice(i, i + 8) : hdLines.slice(i, i + 1 + nextPartIdx);
    const bounded = boundedLines.join(' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').trim();

    const priceMatch = bounded.match(/\$\s*(\d+\.\d{2})/);
    const oeMatch = bounded.match(/\b(\d{5}-\d{2}[A-Z]?|\d{8}[A-Z]?)\b/);

    let desc = bounded
      .replace(new RegExp('^' + partNumber, 'i'), '')
      .replace(/\bC\d[0-9A-Z\-]{2,}\b/gi, '')
      .replace(/\$\s*\d+\.\d{2}/g, '')
      .replace(/\b\d+\.\d{2}\b(?=\s*$)/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (oeMatch) desc = desc.replace(oeMatch[1], '').trim();
    // Trim trailing table headers if any bled in
    desc = desc.replace(/(Cometic Part #|OE#|Description|Single|5 Pack|Price).*$/i, '').trim();

    const fullText = `${currentSection} ${desc}`;
    if (isVintageOrExcluded(fullText)) continue;
    const yearSpan = extractYearSpanFromText(fullText);
    if (yearSpan && yearSpan[1] < 2000) continue;
    const platforms = inferPlatformsFromText(fullText);
    const categories = inferCategoriesFromText(fullText);
    const eraTag = inferEraTag(fullText);

    if (!seen.has(partNumber)) {
      seen.add(partNumber);
      parts.push({
        manufacturer: 'Cometic',
        partNumber,
        oeNumber: oeMatch ? oeMatch[1] : null,
        section: currentSection,
        description: desc || currentSection,
        price: priceMatch ? `$${priceMatch[1]}` : null,
        y1: yearSpan ? yearSpan[0] : 1999,
        y2: yearSpan ? yearSpan[1] : 2025,
        platforms,
        categories,
        eraTag,
      });
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// 3. Parse James Gaskets Catalog (Pages 5-234) + Cross Reference OEM Map
// ---------------------------------------------------------------------------
function parseJamesOemMap(lines) {
  const oemMap = new Map();
  let inXref = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('CROSS REFERENCE & PAGE NUMBER GUIDE')) {
      inXref = true;
      continue;
    }
    if (!inXref) continue;
    // Match one or more "JGI-XXX  OEMXXX  PAGE" pairs on a line
    const re = /\b(JGI-[0-9A-Z\-]+)\s+([0-9A-Z\-\/]+)\s+\d{1,3}\b/g;
    let m;
    while ((m = re.exec(line)) !== null) {
      const jgi = m[1].toUpperCase();
      const oem = m[2].toUpperCase();
      if (oem !== 'N/A' && oem !== 'NA' && oem.length >= 4) {
        oemMap.set(jgi, oem);
      }
    }
  }
  return oemMap;
}

function parseJamesCatalog() {
  const lines = fs.readFileSync(jamesTxtPath, 'utf8').split(/\r?\n/);
  const oemMap = parseJamesOemMap(lines);
  const SKIP_SECTIONS = /POLARIS|VICTORY|INDIAN|APPAREL|GASKET BOARD|CROSS REFERENCE|TABLE OF CONTENTS/i;

  let pageSection = '';
  const parts = [];
  const seen = new Set();
  let buf = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (line.startsWith('=== PAGE ')) {
      const n1 = (lines[i + 1] || '').trim();
      const n2 = (lines[i + 2] || '').trim();
      const cand = n1.includes('All manufacturer names') ? n2 : n1;
      if (cand && cand.length < 70 && /^[A-Z0-9\s,&\/\-\.®]+$/.test(cand)) {
        pageSection = cand;
      }
      buf = [];
      continue;
    }

    if (line.includes('All manufacturer names, symbols')) continue;
    if (/^\d{1,3}$/.test(line)) continue;
    if (SKIP_SECTIONS.test(pageSection)) continue;

    const jgiMatches = [...line.matchAll(/\b(JGI-[0-9A-Z\-]+)\b/g)];
    if (jgiMatches.length > 0) {
      const context = buf.slice(-12).join(' | ');
      const usedOnMatch = context.match(/Used On:\s*([^|]+)/i);
      const modelsMatch = context.match(/Models:\s*([^|]+)/i);

      let title = '';
      for (let b = buf.length - 1; b >= 0; b--) {
        if (/^[A-Z][A-Z0-9\s,\-\/\.®'&]+$/.test(buf[b]) && buf[b].length > 4 && !/^(Used On|Models|Pack|Kit|Starting|Final)/i.test(buf[b])) {
          title = buf[b];
          break;
        }
      }

      const rawDesc = buf.slice(-6).join(' ').replace(/\s+/g, ' ').trim();
      const fullText = `${pageSection} ${title} ${usedOnMatch ? usedOnMatch[1] : ''} ${modelsMatch ? modelsMatch[1] : ''} ${rawDesc}`;
      if (isVintageOrExcluded(fullText)) { buf = []; continue; }
      const yearSpan = extractYearSpanFromText(usedOnMatch ? usedOnMatch[1] : fullText);
      if (yearSpan && yearSpan[1] < 2000) { buf = []; continue; }
      const platforms = inferPlatformsFromText(fullText);
      const categories = inferCategoriesFromText(fullText);
      const eraTag = inferEraTag(fullText);

      for (const m of jgiMatches) {
        const partNumber = m[1].toUpperCase();
        if (seen.has(partNumber)) continue;
        seen.add(partNumber);
        const oeNumber = oemMap.get(partNumber) || null;
        parts.push({
          manufacturer: 'James',
          partNumber,
          ...(oeNumber ? { oeNumber } : {}),
          section: pageSection,
          description: [title, modelsMatch ? modelsMatch[1].trim() : '', usedOnMatch ? `(${usedOnMatch[1].trim()})` : ''].filter(Boolean).join(' — ') || rawDesc || pageSection,
          y1: yearSpan ? yearSpan[0] : 1999,
          y2: yearSpan ? yearSpan[1] : 2025,
          platforms,
          categories,
          eraTag,
        });
      }
      buf = [];
    } else {
      buf.push(line);
      if (buf.length > 20) buf.shift();
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// 4. Parse JTC Markdown Guide (All Sections, Exact Columns)
// ---------------------------------------------------------------------------
function mapModelTokenToPlatform(tok) {
  const t = tok.trim().toUpperCase();
  const known = ['TRG', 'SFT', 'DYN', 'XL', 'TRK', 'VRSC', 'REV', 'XG', 'EV', 'SDC', 'ALL'];
  if (known.includes(t)) return t;
  if (/^(FLH|FLT|FLHR|FLHT|FLHX|FLTR|FLR|FLHP|FLHPE)/.test(t)) return 'TRG';
  if (/^(FLHTCUTG|FLRT|FLTRT|FLHXXX)/.test(t)) return 'TRK';
  if (/^(FXST|FLST|FLS|FXS|FXBR|FXFB|FXLR|FXBB|FLHC|FLFB|FLDE|FLSL|FXCW|FXSB|FXSE|FXDR|FLI|FXRST)/.test(t)) return 'SFT';
  if (/^(FXD|FLD|FXR)/.test(t)) return 'DYN';
  if (/^(XL|XR1200)/.test(t)) return 'XL';
  if (/^VR/.test(t)) return 'VRSC';
  if (/^(RA1250|RH1250|RH975)/.test(t)) return 'REV';
  if (/^XG/.test(t)) return 'XG';
  if (/^(ELW|LWZ|HD350|HD500)/.test(t)) return 'EV';
  if (/^(SIDECAR|TLE)/.test(t)) return 'SDC';
  return null;
}

function getEngineEra(platform, year) {
  if (platform === 'TRG' || platform === 'TRK') {
    if (year >= 2017) return 'M8';
    if (year <= 2000) return 'EVO1340';
    return 'TC';
  }
  if (platform === 'SFT') {
    if (year >= 2018) return 'M8';
    if (year <= 2000) return 'EVO1340';
    return 'TC';
  }
  if (platform === 'DYN') {
    return year <= 2000 ? 'EVO1340' : 'TC';
  }
  return platform;
}

function getEngineFamilyLabel(platform, y1, y2) {
  if (platform === 'REV') return 'Revolution Max 2021-2025';
  if (platform === 'VRSC') return 'Revolution (V-Rod) 2002-2017';
  if (platform === 'XL') return 'Evolution Sportster (XL) 2000-2022';
  if (platform === 'XG') return 'Street 500/750 (XG) 2015-2020';
  if (platform === 'EV') return 'LiveWire / Electric (EV) 2020-2025';
  if (platform === 'DYN') return y2 <= 2000 ? 'Evolution 1340 (Big Twin) 2000-2000' : 'Twin Cam 1999-2017';
  if (platform === 'TRG' || platform === 'TRK') {
    if (y1 >= 2017) return 'Milwaukee-Eight 2017-2025';
    if (y2 <= 2000) return 'Evolution 1340 (Big Twin) 2000-2000';
    return 'Twin Cam 1999-2017';
  }
  if (platform === 'SFT') {
    if (y1 >= 2018) return 'Milwaukee-Eight 2018-2025';
    if (y2 <= 2000) return 'Evolution 1340 (Big Twin) 2000-2000';
    return 'Twin Cam 2000-2017';
  }
  return `${platform} ${y1}-${y2}`;
}

function parseJtcRows(md) {
  const lines = md.split(/\r?\n/);
  const rows = [];
  let section = '';

  for (const line of lines) {
    if (line.startsWith('## ')) {
      section = line.replace(/^##\s*\**/, '').replace(/\**$/, '').trim();
      continue;
    }
    if (!section.startsWith('Section 3') && !section.startsWith('Section 4')) continue;
    if (!line.startsWith('\\|') && !line.startsWith('|')) continue;
    if (line.includes(':---') || line.includes('JTC Code')) continue;

    // Preserve empty columns!
    const rawCols = line.split(/\\\||\|/).map(s => s.replace(/\\/g, '').trim());
    // Leading and trailing pipes produce empty strings at index 0 and last
    const cols = rawCols.slice(1, rawCols.length - 1);
    if (cols.length < 6) continue;

    const jtcCode = cols[0].replace(/`/g, '').trim();
    const system = cols[1];
    const operation = cols[2];
    const condition = cols[3];
    const hoursCol = cols[5];

    if (!jtcCode || !operation || !hoursCol) continue;

    const jobName = (condition && condition !== '—' && condition !== '-')
      ? `${operation} - ${condition}`
      : operation;

    // Parse **Xh**[YY-YY:PLAT,MOD; ...]
    const tierRegex = /\*\*(\d+(?:\.\d+)?)h\*\*\[([^\]]+)\]/g;
    let m;
    const platformEntries = new Map(); // key: `${platform}|${y1}|${y2}` -> hours[]
    const modelHoursByEra = new Map(); // key: `${platform}|${era}` -> Map<modelCode, hours>

    while ((m = tierRegex.exec(hoursCol)) !== null) {
      const hours = parseFloat(m[1]);
      for (const spec of m[2].split(';')) {
        const colonIdx = spec.indexOf(':');
        if (colonIdx === -1) continue;
        const yearsPart = spec.slice(0, colonIdx).trim();
        const modelsPart = spec.slice(colonIdx + 1).trim();

        // yearsPart can be "14-16", "08", "00-02,07-09"
        const yearRanges = [];
        for (const yr of yearsPart.split(',')) {
          const ym = yr.trim().match(/^(\d{2})(?:-(\d{2}))?$/);
          if (!ym) continue;
          yearRanges.push([toFullYear(ym[1]), toFullYear(ym[2] || ym[1])]);
        }

        const plats = new Set();
        for (const tok of modelsPart.split(',')) {
          const cleanTok = tok.trim().toUpperCase();
          const p = mapModelTokenToPlatform(cleanTok);
          if (p) {
            plats.add(p);
            // If token is a specific model code (not a platform/ALL), record exact modelHours
            if (!['TRG', 'SFT', 'DYN', 'XL', 'TRK', 'VRSC', 'REV', 'XG', 'EV', 'SDC', 'ALL'].includes(cleanTok)) {
              for (const [ry1, ry2] of yearRanges) {
                for (let yr = ry1; yr <= ry2; yr++) {
                  const era = getEngineEra(p, yr);
                  const ek = `${p}|${era}`;
                  if (!modelHoursByEra.has(ek)) modelHoursByEra.set(ek, new Map());
                  modelHoursByEra.get(ek).set(cleanTok, hours);
                }
              }
            }
          }
        }

        if (plats.has('ALL')) {
          plats.delete('ALL');
          ['TRG', 'SFT', 'DYN', 'XL', 'VRSC', 'REV', 'TRK', 'XG', 'EV'].forEach(p => plats.add(p));
        }

        for (const p of plats) {
          for (const [y1, y2] of yearRanges) {
            const k = `${p}|${y1}|${y2}`;
            if (!platformEntries.has(k)) platformEntries.set(k, []);
            platformEntries.get(k).push(hours);
          }
        }
      }
    }

    // Merge by (platform, engineEra) so M8 / Twin Cam / Evo 1340 get exact era hours & parts
    const byPlatformEra = new Map();
    for (const [k, hrsList] of platformEntries.entries()) {
      const [p, y1s, y2s] = k.split('|');
      const y1 = parseInt(y1s, 10);
      const y2 = parseInt(y2s, 10);
      const avgH = Math.round((hrsList.reduce((a, b) => a + b, 0) / hrsList.length) * 10) / 10;

      // Split span if it crosses M8/TC/EVO boundaries
      for (let yr = y1; yr <= y2; yr++) {
        const era = getEngineEra(p, yr);
        const eraKey = `${p}|${era}`;
        if (!byPlatformEra.has(eraKey)) byPlatformEra.set(eraKey, { platform: p, years: new Set(), hours: [] });
        const entry = byPlatformEra.get(eraKey);
        entry.years.add(yr);
        entry.hours.push(avgH);
      }
    }

    for (const [eraKey, { platform, years, hours: hrsList }] of byPlatformEra.entries()) {
      const yrs = [...years].sort((a, b) => a - b);
      const minY = yrs[0];
      const maxY = yrs[yrs.length - 1];
      const hours = Math.round((hrsList.reduce((a, b) => a + b, 0) / hrsList.length) * 10) / 10;
      const mMap = modelHoursByEra.get(eraKey);
      const modelHours = (mMap && mMap.size > 0) ? Object.fromEntries(mMap.entries()) : null;
      rows.push({
        section,
        jtcCode,
        system,
        jobName,
        platform,
        y1: minY,
        y2: maxY,
        baseWarrantyHours: hours,
        ...(modelHours ? { modelHours } : {}),
      });
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// 5. Match JTC Jobs to Cometic & James Parts + Classify Service Track
// ---------------------------------------------------------------------------
function classifyServiceTrack(row) {
  const txt = `${row.section} ${row.system} ${row.jobName}`.toLowerCase();
  if (/tire|wheel.*balance|engine|cylinder|head gasket|piston|cam|crank|stator|transmission|clutch|primary|rocker|valve|starter/.test(txt)) {
    return 'PARTS_REQUIRED';
  }
  return 'STANDARD_SERVICE';
}

function mapJobToTargetCategories(row) {
  const txt = `${row.system} ${row.jobName}`.toLowerCase();
  const cats = [];
  if (/primary/.test(txt)) cats.push('primary_kit', 'primary');
  if (/derby|inspection cover/.test(txt)) cats.push('derby_inspection', 'primary');
  if (/cam/.test(txt)) cats.push('cam_kit', 'cam');
  if (/rocker/.test(txt)) cats.push('rocker_kit', 'rocker');
  if (/cylinder head|head gasket/.test(txt)) cats.push('head_gasket', 'top_end');
  if (/cylinder base|base gasket|cylinder\b/.test(txt)) cats.push('base_gasket', 'top_end');
  if (/valve seal|valve spring|valve guide/.test(txt)) cats.push('valve', 'top_end');
  if (/pushrod|tappet|lifter/.test(txt)) cats.push('pushrod_tappet');
  if (/stator|alternator|rotor/.test(txt)) cats.push('stator', 'primary_kit', 'primary');
  if (/exhaust|muffler|header/.test(txt)) cats.push('exhaust');
  if (/intake|manifold|throttle body|carburetor/.test(txt)) cats.push('intake');
  if (/transmission|clutch|mainshaft/.test(txt)) cats.push('transmission');
  if (/crankcase|crank|flywheel/.test(txt)) cats.push('crankcase', 'complete_engine');
  if (/oil pump/.test(txt)) cats.push('oil_pump');
  if (/oil filter|1,000 mile|5,000 mile|10,000 mile|15,000 mile|20,000 mile/.test(txt)) cats.push('oil_service');
  if (/fork/.test(txt) && /seal/.test(txt)) cats.push('fork_seal');
  if (/wheel/.test(txt) && /seal|bearing/.test(txt)) cats.push('wheel_seal');
  if (/starter/.test(txt)) cats.push('starter');
  return [...new Set(cats)];
}

function findRankedParts(partsList, row, targetCats, limit = 5) {
  if (!targetCats.length) return [];
  const rowEra = getEngineEra(row.platform, row.y1);
  const jobLower = (row.jobName || '').toLowerCase();
  const isRebuildJob = /kit|rebuild|overhaul|complete|top end/.test(jobLower);
  const isSinglePartJob = !isRebuildJob && /gasket|seal|o-ring|cover/.test(jobLower);
  const scored = [];

  for (const p of partsList) {
    // Year overlap required
    if (p.y2 < row.y1 || p.y1 > row.y2) continue;

    // Category match required
    const catHits = targetCats.filter(c => p.categories.includes(c));
    if (!catHits.length) continue;

    // Platform match: require explicit platform match if part has platform tags
    const platMatch = p.platforms.includes(row.platform);
    if (p.platforms.length > 0 && !platMatch) continue;

    // Reject explicit cross-era mismatches (e.g. Twin Cam 120R part on Sportster or M8)
    if (p.eraTag && rowEra && p.eraTag !== rowEra) {
      if (!(rowEra === 'EVO1340' && p.eraTag === 'EVO')) continue;
    }

    let score = catHits.length * 10;
    if (platMatch) score += 20;
    if (p.eraTag && p.eraTag === rowEra) score += 30;
    if (p.categories.includes(targetCats[0])) score += 15;
    if (p.oeNumber) score += 5;

    const pText = `${p.section || ''} ${p.description || ''}`.toLowerCase();
    const pIsFullKit = /complete engine|motor.*kit|top end.*kit|engine gasket kit/.test(pText);
    if (isSinglePartJob && pIsFullKit) score -= 25;
    if (isRebuildJob && pIsFullKit) score += 15;

    const overlapYears = Math.min(p.y2, row.y2) - Math.max(p.y1, row.y1);
    score += Math.min(overlapYears, 10);

    scored.push({ part: p, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.part);
}

// ---------------------------------------------------------------------------
// Main Execution
// ---------------------------------------------------------------------------
console.log('Parsing Cometic catalog...');
const cometicParts = parseCometicCatalog();
console.log(`  Cometic HD parts: ${cometicParts.length}`);

console.log('Parsing James catalog...');
const jamesParts = parseJamesCatalog();
console.log(`  James HD parts: ${jamesParts.length}`);

console.log('Parsing JTC Labor Guide...');
const jtcMd = fs.readFileSync(jtcPath, 'utf8');
const jtcRows = parseJtcRows(jtcMd);
console.log(`  JTC (job x platform) rows: ${jtcRows.length}`);

const catalog = [];
const seenKeys = new Set();

for (const row of jtcRows) {
  const targetCats = mapJobToTargetCategories(row);
  const cometicMatches = findRankedParts(cometicParts, row, targetCats, 4);
  const jamesMatches = findRankedParts(jamesParts, row, targetCats, 4);
  const cometicMatch = cometicMatches[0] || null;
  const jamesMatch = jamesMatches[0] || null;

  const isCommonService = row.section.startsWith('Section 3')
    || row.section.startsWith('Section 4.2')
    || row.section.startsWith('Section 4.5')
    || /brake|tire|wheel|fork|oil|fluid|clutch|belt|stator|starter|battery|handlebar|exhaust/i.test(row.jobName);
  if (!cometicMatch && !jamesMatch && !isCommonService) continue;

  const key = `${row.platform}|${row.y1}|${row.y2}|${row.jtcCode}|${row.jobName}`;
  if (seenKeys.has(key)) continue;
  seenKeys.add(key);

  const toPartObj = (p) => ({
    manufacturer: p.manufacturer,
    partNumber: p.partNumber,
    ...(p.oeNumber ? { oeNumber: p.oeNumber } : {}),
    description: p.description,
    ...(p.price ? { price: p.price } : {}),
    qty: 1,
  });

  const requiredParts = [];
  if (cometicMatch) requiredParts.push(toPartObj(cometicMatch));
  if (jamesMatch) requiredParts.push(toPartObj(jamesMatch));

  const breakdownParts = [
    ...cometicMatches.slice(1).map(toPartObj),
    ...jamesMatches.slice(1).map(toPartObj),
  ];

  catalog.push({
    engineFamily: getEngineFamilyLabel(row.platform, row.y1, row.y2),
    platform: row.platform,
    y1: row.y1,
    y2: row.y2,
    jtcCode: row.jtcCode,
    system: row.system,
    jobName: row.jobName,
    baseWarrantyHours: row.baseWarrantyHours,
    ...(row.modelHours ? { modelHours: row.modelHours } : {}),
    serviceTrack: classifyServiceTrack(row),
    requiredParts,
    ...(breakdownParts.length ? { breakdownParts } : {}),
  });
}

// Build / update parts_price_list.json (preserving any existing web_search or manual prices)
const priceListPath = `${workdir}/parts_price_list.json`;
let existingPrices = new Map();
if (fs.existsSync(priceListPath)) {
  try {
    const prev = JSON.parse(fs.readFileSync(priceListPath, 'utf8'));
    for (const item of prev) {
      if (item && item.partNumber) existingPrices.set(item.partNumber, item);
    }
  } catch (_) {}
}

// Build OEM -> Cometic price lookup and job-paired Cometic price lookup for James cross-ref estimates
const oemToCometicPrice = new Map();
for (const p of cometicParts) {
  if (p.oeNumber && p.price) {
    const c = parseFloat(String(p.price).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(c)) oemToCometicPrice.set(p.oeNumber.toUpperCase(), c);
  }
}

const pairedCometicPrice = new Map(); // jamesPartNumber -> cometicPrice[]
for (const job of catalog) {
  const com = (job.requiredParts || []).find(p => p.manufacturer === 'Cometic' && p.price);
  const jam = (job.requiredParts || []).find(p => p.manufacturer === 'James');
  if (com && jam) {
    const c = parseFloat(String(com.price).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(c)) {
      if (!pairedCometicPrice.has(jam.partNumber)) pairedCometicPrice.set(jam.partNumber, []);
      pairedCometicPrice.get(jam.partNumber).push(c);
    }
  }
}

const priceMap = new Map();
for (const job of catalog) {
  for (const p of [...(job.requiredParts || []), ...(job.breakdownParts || [])]) {
    if (priceMap.has(p.partNumber)) continue;
    const prev = existingPrices.get(p.partNumber);
    const catalogCost = p.price ? parseFloat(String(p.price).replace(/[^0-9.]/g, '')) : null;

    let crossRefCost = null;
    if (!Number.isFinite(catalogCost) && p.manufacturer === 'James') {
      if (p.oeNumber && oemToCometicPrice.has(p.oeNumber.toUpperCase())) {
        crossRefCost = oemToCometicPrice.get(p.oeNumber.toUpperCase());
      } else if (pairedCometicPrice.has(p.partNumber)) {
        const arr = pairedCometicPrice.get(p.partNumber).slice().sort((a, b) => a - b);
        crossRefCost = arr[Math.floor(arr.length / 2)];
      }
    }

    const keepPrev = prev && prev.estimatedCost != null && !['cometic_catalog', 'cometic_cross_ref_est'].includes(prev.priceSource);
    const estimatedCost = keepPrev
      ? prev.estimatedCost
      : (Number.isFinite(catalogCost) ? catalogCost : (crossRefCost != null ? crossRefCost : (prev ? prev.estimatedCost : null)));
    const priceSource = keepPrev
      ? prev.priceSource
      : (Number.isFinite(catalogCost) ? 'cometic_catalog' : (crossRefCost != null ? 'cometic_cross_ref_est' : (prev ? prev.priceSource : null)));

    priceMap.set(p.partNumber, {
      partNumber: p.partNumber,
      manufacturer: p.manufacturer,
      oeNumber: p.oeNumber || (prev ? prev.oeNumber : null) || null,
      description: p.description,
      estimatedCost: estimatedCost ?? null,
      priceSource: priceSource || null,
      lastUpdated: (prev && prev.lastUpdated) ? prev.lastUpdated : (estimatedCost != null ? new Date().toISOString().slice(0, 10) : null),
    });
  }
}

// Sync estimatedCost back onto catalog parts so index.html has them embedded
for (const job of catalog) {
  for (const p of [...(job.requiredParts || []), ...(job.breakdownParts || [])]) {
    const entry = priceMap.get(p.partNumber);
    if (entry && entry.estimatedCost != null) {
      p.estimatedCost = entry.estimatedCost;
      p.priceSource = entry.priceSource;
    }
  }
}

const priceList = [...priceMap.values()].sort((a, b) => a.partNumber.localeCompare(b.partNumber));
fs.writeFileSync(priceListPath, JSON.stringify(priceList, null, 2), 'utf8');

fs.writeFileSync(outPath, JSON.stringify(catalog, null, 2), 'utf8');
console.log(`DONE. Wrote ${catalog.length} records to ${outPath}`);
console.log(`Wrote ${priceList.length} unique parts to ${priceListPath}`);

const uniqueCometic = new Set(catalog.flatMap(j => j.requiredParts.filter(p => p.manufacturer === 'Cometic').map(p => p.partNumber)));
const uniqueJames = new Set(catalog.flatMap(j => j.requiredParts.filter(p => p.manufacturer === 'James').map(p => p.partNumber)));
console.log(`Unique Cometic parts used: ${uniqueCometic.size}, Unique James parts used: ${uniqueJames.size}`);
