import fs from 'fs';

function readText(p) {
  return fs.readFileSync(p, 'utf8');
}

function safeTrim(s) {
  return (s ?? '').toString().trim();
}

function findJtcCodeForJob(jtcGuide, jobName) {
  const idx = jtcGuide.toLowerCase().indexOf(jobName.toLowerCase());
  if (idx === -1) return null;
  const slice = jtcGuide.slice(idx, idx + 8000);
  const m = slice.match(/\|\s*([0-9]{4,5}(?:\([^\)]*\))?)\s*\|/);
  return m ? m[1] : null;
}

function extractPartsFromText(txt, manufacturer) {
  const parts = [];
  // Heuristic: find line(s) mentioning manufacturer and extract a plausible partNumber token.
  // Note: Cometic/James layouts vary; this will be refined once we inspect extracted text.
  const lines = txt.split(/\r?\n/);
  for (const line of lines) {
    if (parts.length >= 20) break;
    if (!line.toLowerCase().includes(manufacturer.toLowerCase())) continue;

    // part-like token: alnum plus optional dashes/letters, contains at least one digit
    // part-like token: letters/digits/dashes, must include at least one digit
    const m = line.match(/([A-Za-z0-9-]{4,}[0-9][A-Za-z0-9-]+)/);
    if (!m) continue;

    const partNumber = safeTrim(m[1]);
    const description = safeTrim(line);
    parts.push({ manufacturer, partNumber, description, qty: 1 });
  }
  return parts;
}

const jtcPath = process.env.JTC;
const cometicTxt = process.env.COMETIC_TXT;
const jamesTxt = process.env.JAMES_TXT;
const outPath = process.env.OUT;
const engineFamily = process.env.ENGINE_FAMILY;
const jobName = process.env.JOB_NAME;

if (!jtcPath || !cometicTxt || !jamesTxt || !outPath || !engineFamily || !jobName) {
  throw new Error('Missing required env vars');
}

const jtcGuide = readText(jtcPath);
const cometic = readText(cometicTxt);
const james = readText(jamesTxt);

const jtcCode = findJtcCodeForJob(jtcGuide, jobName) || 'UNKNOWN';
const baseWarrantyHours = parseFloat(process.env.BASE_WARRANTY_HOURS || '2.5');

const comParts = extractPartsFromText(cometic, 'Cometic');
const jaParts = extractPartsFromText(james, 'James');

const requiredParts = [];
if (comParts[0]) requiredParts.push(comParts[0]);
if (jaParts[0]) requiredParts.push(jaParts[0]);

const obj = {
  engineFamily,
  jobName,
  jtcCode,
  baseWarrantyHours,
  requiredParts,
};

let existing = [];
if (fs.existsSync(outPath)) {
  try {
    existing = JSON.parse(readText(outPath));
  } catch {
    existing = [];
  }
}

existing.push(obj);
fs.writeFileSync(outPath, JSON.stringify(existing, null, 2), 'utf8');
console.log('Appended object. Total objects:', existing.length);
