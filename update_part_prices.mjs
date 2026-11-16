import fs from 'fs';

const workdir = process.cwd();
const priceListPath = `${workdir}/parts_price_list.json`;
const catalogPath = `${workdir}/parsed_catalog.json`;

const args = process.argv.slice(2);
const limitArg = args.find(a => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 25;
const staleDays = 30;
const refreshStale = args.includes('--stale');
const dryRun = args.includes('--dry-run');

function isStale(dateStr) {
  if (!dateStr) return true;
  const ageMs = Date.now() - new Date(dateStr).getTime();
  return ageMs > staleDays * 86400 * 1000;
}

async function fetchEstimatedPrice(part) {
  const query = part.oeNumber
    ? `"${part.partNumber}" OR "${part.oeNumber}" harley gasket price`
    : `"${part.partNumber}" harley price`;
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) return null;
  const html = await res.text();

  // Extract USD prices like $14.95, $129.99 (ignore < $1 or > $999)
  const prices = [];
  const re = /\$\s*(\d{1,3}\.\d{2})\b/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const val = parseFloat(m[1]);
    if (val >= 1.0 && val <= 999.0) prices.push(val);
  }
  if (!prices.length) return null;

  // Use median of first 7 prices to avoid outliers
  const sample = prices.slice(0, 7).sort((a, b) => a - b);
  const median = sample[Math.floor(sample.length / 2)];
  return Math.round(median * 100) / 100;
}

function syncPricesToCatalog(priceList) {
  if (!fs.existsSync(catalogPath)) return 0;
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const priceMap = new Map(priceList.map(p => [p.partNumber, p]));
  let updatedCount = 0;

  for (const job of catalog) {
    for (const p of [...(job.requiredParts || []), ...(job.breakdownParts || [])]) {
      const entry = priceMap.get(p.partNumber);
      if (entry && entry.estimatedCost != null) {
        p.estimatedCost = entry.estimatedCost;
        p.priceSource = entry.priceSource;
        updatedCount++;
      }
    }
  }
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2), 'utf8');
  return updatedCount;
}

async function main() {
  const priceList = JSON.parse(fs.readFileSync(priceListPath, 'utf8'));
  const targets = priceList.filter(p =>
    p.estimatedCost == null || (refreshStale && isStale(p.lastUpdated))
  ).slice(0, limit);

  console.log(`Loaded ${priceList.length} parts. Checking ${targets.length} missing/stale parts (limit=${limit}, dryRun=${dryRun})...`);

  let updated = 0;
  for (const part of targets) {
    try {
      const est = await fetchEstimatedPrice(part);
      if (est != null) {
        console.log(`  [FOUND] ${part.partNumber} (OEM: ${part.oeNumber || '—'}) -> Est. $${est.toFixed(2)}`);
        if (!dryRun) {
          part.estimatedCost = est;
          part.priceSource = 'web_search';
          part.lastUpdated = new Date().toISOString().slice(0, 10);
        }
        updated++;
      } else {
        console.log(`  [MISS]  ${part.partNumber}`);
      }
    } catch (err) {
      console.log(`  [ERR]   ${part.partNumber}: ${err.message}`);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  if (!dryRun) {
    fs.writeFileSync(priceListPath, JSON.stringify(priceList, null, 2), 'utf8');
    const synced = syncPricesToCatalog(priceList);
    console.log(`Updated ${updated} prices in parts_price_list.json and synced ${synced} part refs in parsed_catalog.json.`);
  } else {
    console.log(`Dry run complete. Would have updated ${updated} parts.`);
  }
}

main();
