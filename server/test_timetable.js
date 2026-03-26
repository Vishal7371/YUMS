/**
 * Standalone timetable fetch test.
 * Uses saved session cookies from yums_session.json
 * Run: node test_timetable.js
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_FILE = path.join(os.tmpdir(), 'yums_session.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  // Load saved session
  if (!fs.existsSync(SESSION_FILE)) {
    console.error('❌ No saved session found. Please log in via the app first.');
    process.exit(1);
  }
  const { cookies } = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: ['--start-maximized', '--no-sandbox'],
  });

  const page = await browser.newPage();
  await page.setCookie(...cookies);
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

  console.log('🔍 Loading timetable page...');
  await page.goto('https://ums.lpu.in/lpuums/Reports/frmStudentTimeTable.aspx', {
    waitUntil: 'networkidle2', timeout: 30000
  });
  await sleep(4000);

  // Save initial page
  const html1 = await page.content();
  fs.writeFileSync(path.join(__dirname, 'debug_tt_initial.html'), html1);
  console.log(`📄 Initial page: ${html1.length} bytes — saved to debug_tt_initial.html`);

  // ── Strategy 1: in-page fetch of SSRS HTML export ──
  console.log('\n--- Strategy 1: in-page fetch() of SSRS export ---');
  let exportHtml = null;
  try {
    exportHtml = await page.evaluate(async () => {
      let exportBase = null;
      for (const s of document.querySelectorAll('script')) {
        const m = s.textContent.match(/"ExportUrlBase"\s*:\s*"([^"]+)"/);
        if (m) { exportBase = m[1].replace(/\\u0026/g, '&'); break; }
      }
      console.log('ExportBase found:', exportBase);
      if (!exportBase) return null;
      const url = 'https://ums.lpu.in' + exportBase + 'HTML4.0';
      console.log('Fetching:', url);
      try {
        const res = await fetch(url, { credentials: 'include' });
        console.log('Response status:', res.status, res.headers.get('content-type'));
        if (!res.ok) return 'STATUS:' + res.status;
        return await res.text();
      } catch (e) { return 'ERROR:' + e.message; }
    });
    console.log(`Export result: ${exportHtml ? exportHtml.slice(0, 200) : 'null'}`);
    if (exportHtml && exportHtml.length > 200 && !exportHtml.startsWith('ERROR') && !exportHtml.startsWith('STATUS')) {
      fs.writeFileSync(path.join(__dirname, 'debug_tt_export.html'), exportHtml);
      console.log(`✅ Export HTML saved: ${exportHtml.length} bytes`);

      // Check for day names
      const hasDays = /Monday|Tuesday|Wednesday|Thursday|Friday/i.test(exportHtml);
      const hasTimes = /\d{1,2}:\d{2}/.test(exportHtml);
      console.log(`Has day names: ${hasDays}, has times: ${hasTimes}`);
    }
  } catch (e) {
    console.error('Strategy 1 error:', e.message);
  }

  // ── Strategy 2: check iframes ──
  console.log('\n--- Strategy 2: iframes ---');
  const frames = page.frames();
  console.log(`Found ${frames.length} frames`);
  for (const frame of frames) {
    const url = frame.url();
    console.log(`  Frame: ${url}`);
    try {
      const text = await frame.evaluate(() => document.body?.textContent?.slice(0, 300) || '');
      if (text.trim()) console.log(`    Content preview: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    } catch (e) { console.log(`    (eval failed: ${e.message})`); }
  }

  // ── Log all SSRS-related network requests ──
  console.log('\n--- Reloading with network interception ---');
  const intercepted = [];
  page.on('response', async (response) => {
    const url = response.url();
    if (url.includes('ReportViewer') || url.includes('frmStudent') || url.includes('TimeTable')) {
      const ct = response.headers()['content-type'] || '';
      const status = response.status();
      console.log(`  [NET] ${status} ${ct} — ${url.slice(0, 120)}`);
      intercepted.push({ url, ct, status });
    }
  });

  await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
  await sleep(6000);

  console.log(`\nIntercepted ${intercepted.length} relevant requests.`);

  await browser.close();
  console.log('\n✅ Done. Check the debug_tt_*.html files for analysis.');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
