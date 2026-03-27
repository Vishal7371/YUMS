const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { createWorker } = require('tesseract.js');
const sharp = require('sharp');

const UMS_BASE = 'https://ums.lpu.in/lpuums';
const UMS_LOGIN = `${UMS_BASE}/loginnew.aspx`;
const UMS_DASH = `${UMS_BASE}/StudentDashboard.aspx`;

// ── Session cookie persistence ───────────────────────────────────────────────
const SESSION_FILE = path.join(require('os').tmpdir(), 'yums_session.json');

function saveSession(cookies, regNo) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ cookies, regNo, savedAt: Date.now() }));
    console.log('[SESSION] Cookies saved to', SESSION_FILE);
  } catch (e) {
    console.warn('[SESSION] Could not save cookies:', e.message);
  }
}

function loadSession(regNo) {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    // Only reuse if same user and session is < 2 hours old
    if (data.regNo !== regNo) return null;
    if (Date.now() - data.savedAt > 2 * 60 * 60 * 1000) {
      console.log('[SESSION] Cookies expired, will do fresh login');
      return null;
    }
    console.log('[SESSION] Found valid saved session');
    return data;
  } catch (_) { return null; }
}

function checkSavedSession(regNo) {
  const data = loadSession(regNo);
  if (!data) return { valid: false };
  return { valid: true, savedAt: data.savedAt, ageMinutes: Math.round((Date.now() - data.savedAt) / 60000) };
}


// ── Exact UMS form field IDs (verified from live page) ──────────────────────
const SEL = {
  username: '#txtU',
  password: '#TxtpwdAutoId_8767',
  captchaImg: '#c_loginnew_examplecaptcha_CaptchaImage',
  captchaInput: '#CaptchaCodeTextBox',
  captchaReload: '#c_loginnew_examplecaptcha_ReloadLink',
  submitBtn: '#iBtnLogins150203125',
};

// ─── HELPERS ────────────────────────────────────────────────────────────────
const sleep = ms => new Promise(r => setTimeout(r, ms));

function launchBrowser() {
  const isDocker = !!process.env.PUPPETEER_EXECUTABLE_PATH;
  return puppeteer.launch({
    headless: isDocker ? 'new' : false,
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    defaultViewport: isDocker ? { width: 1280, height: 900 } : null,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-software-rasterizer',
      '--no-zygote',
      '--single-process',
      ...(isDocker ? [] : ['--start-maximized']),
    ],
  });
}

// ─── SAFE EVALUATE ─────────────────────────────────────────────────────────
// Retries page.evaluate up to N times if context is destroyed by a navigation.
async function safeEval(page, fn, ...args) {
  for (let i = 0; i < 5; i++) {
    try {
      return await page.evaluate(fn, ...args);
    } catch (e) {
      if (e.message.includes('context was destroyed') || e.message.includes('detached')) {
        await sleep(1500);
        continue;
      }
      throw e;
    }
  }
  throw new Error('safeEval: context destroyed repeatedly — page keeps navigating');
}

// ─── OCR CAPTCHA SOLVER ─────────────────────────────────────────────────────
async function solveCaptchaOCR(page) {
  try {
    const el = await page.$(SEL.captchaImg);
    if (!el) return null;

    const raw = path.join(__dirname, 'captcha_raw.png');
    const proc = path.join(__dirname, 'captcha_proc.png');

    await el.screenshot({ path: raw });
    await sharp(raw)
      .resize({ width: 300, kernel: sharp.kernel.lanczos3 })
      .greyscale()
      .normalize()
      .threshold(128)
      .toFile(proc);

    const worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      tessedit_pageseg_mode: '7',
    });
    const { data: { text } } = await worker.recognize(proc);
    await worker.terminate();

    for (const f of [raw, proc]) try { fs.unlinkSync(f); } catch (_) { }

    const cleaned = text.trim().replace(/\s+/g, '');
    console.log(`[CAPTCHA] OCR → "${cleaned}"`);
    return cleaned.length >= 4 ? cleaned : null;
  } catch (e) {
    console.warn('[CAPTCHA] OCR error:', e.message);
    return null;
  }
}

// ─── AUTOFILL CREDENTIALS ───────────────────────────────────────────────────
// Fills both username (regNo) and password for headless auto-login.
async function autofillCredentials(page, regNo, password) {
  try {
    await page.waitForSelector(SEL.username, { timeout: 20000 });
    await sleep(600);

    const loginHtml = await page.content().catch(() => '');
    fs.writeFileSync(path.join(__dirname, 'debug_login_page.html'), loginHtml);
    console.log('[UMS] Login page loaded — debug_login_page.html saved');

    await safeEval(page, (un, pw, uSel, pSel) => {
      function fill(el, val) {
        el.value = val;
        ['input', 'change', 'keyup'].forEach(evt =>
          el.dispatchEvent(new Event(evt, { bubbles: true }))
        );
      }
      const u = document.querySelector(uSel);
      if (u) fill(u, un);
      const p = document.querySelector(pSel);
      if (p) fill(p, pw);
    }, regNo, password, SEL.username, SEL.password);

    console.log('[UMS] ✅ Registration number + password filled');
  } catch (e) {
    console.warn('[UMS] Credential fill error:', e.message);
    try {
      const snapshot = await page.content();
      fs.writeFileSync(path.join(__dirname, 'debug_login_page.html'), snapshot);
    } catch (_) { }
  }
}

// ─── GRADE CARD SCRAPER ─────────────────────────────────────────────────────
// Tries to navigate to the UMS grade card page and extract subject-wise grades,
// credits, and grade points. Returns empty array if the page is unavailable.
async function scrapeGradeCard(browser) {
  let gradePage = null;
  try {
    gradePage = await browser.newPage();
    await gradePage.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Try the main course registration / grade card pages
    const gradeUrls = [
      'https://ums.lpu.in/lpuums/StudentGradeCard.aspx',
      'https://ums.lpu.in/lpuums/frmStudentGradeReport.aspx',
      'https://ums.lpu.in/lpuums/StudentCourseRegistration.aspx',
    ];

    let gradeData = [];

    for (const url of gradeUrls) {
      try {
        console.log(`[GRADES] Trying: ${url}`);
        await gradePage.goto(url, { waitUntil: 'networkidle2', timeout: 20000 });
        await sleep(2000);

        const currentUrl = gradePage.url().toLowerCase();
        if (currentUrl.includes('loginnew') || currentUrl.includes('login')) {
          console.log('[GRADES] Redirected to login — session may have expired');
          break;
        }

        const html = await gradePage.content();
        fs.writeFileSync(path.join(__dirname, 'debug_grades.html'), html);

        // Try to extract grade table data from the page
        const result = await safeEval(gradePage, () => {
          function parseNum(v) {
            const n = parseFloat(String(v || '').replace(/[^0-9.]/g, ''));
            return isNaN(n) ? null : n;
          }

          const grades = [];

          // Look for tables with grade-related columns
          const tables = Array.from(document.querySelectorAll('table'));
          for (const table of tables) {
            const headerRow = table.querySelector('tr');
            if (!headerRow) continue;
            const headers = Array.from(headerRow.querySelectorAll('th, td'))
              .map(th => (th.textContent || '').toLowerCase().trim());

            // Look for column hints: credits, grade, cgpa, gpa, points
            const hasCreditCol = headers.some(h => h.includes('credit') || h.includes('cr'));
            const hasGradeCol  = headers.some(h => h.includes('grade') || h.includes('gp'));
            const hasSubjectCol = headers.some(h => h.includes('subject') || h.includes('course') || h.includes('title'));

            if (!hasSubjectCol || (!hasCreditCol && !hasGradeCol)) continue;

            // Find column indices
            const subjectIdx = headers.findIndex(h => h.includes('subject') || h.includes('course') || h.includes('title'));
            const creditIdx  = headers.findIndex(h => h.includes('credit') || h.includes('cr'));
            const gradeIdx   = headers.findIndex(h => h.includes('grade') && !h.includes('point'));
            const gpIdx      = headers.findIndex(h => h.includes('grade point') || h.includes('gp') || h.includes('point'));

            const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header
            for (const row of rows) {
              const cells = Array.from(row.querySelectorAll('td'))
                .map(td => (td.textContent || '').trim());
              if (cells.length < 2) continue;

              const subject = subjectIdx >= 0 ? cells[subjectIdx] : '';
              if (!subject || subject.length < 3) continue;

              const credits    = creditIdx >= 0 ? parseNum(cells[creditIdx]) : null;
              const grade      = gradeIdx >= 0  ? cells[gradeIdx] : null;
              const gradePoints = gpIdx >= 0    ? parseNum(cells[gpIdx]) : null;

              if (credits || grade) {
                grades.push({ subject, credits, grade: grade || '–', gradePoints });
              }
            }

            if (grades.length > 0) break; // found a valid table
          }

          return grades;
        }).catch(() => []);

        if (result && result.length > 0) {
          console.log(`[GRADES] ✅ Found ${result.length} subjects from ${url}`);
          gradeData = result;
          break;
        }
      } catch (urlErr) {
        console.warn(`[GRADES] ${url} failed:`, urlErr.message);
      }
    }

    return gradeData;
  } catch (e) {
    console.warn('[GRADES] Grade scrape error:', e.message);
    return [];
  } finally {
    if (gradePage) try { await gradePage.close(); } catch (_) {}
  }
}

// ─── AUTOFILL + SUBMIT CAPTCHA ───────────────────────────────────────────────
async function fillAndSubmitCaptcha(page) {
  try {
    await page.waitForSelector(SEL.captchaImg, { timeout: 10000 });

    for (let attempt = 1; attempt <= 4; attempt++) {
      console.log(`[CAPTCHA] Attempt ${attempt}/4`);
      await sleep(800);

      const solved = await solveCaptchaOCR(page);
      if (solved) {
        await safeEval(page, (sel, val) => {
          const el = document.querySelector(sel);
          if (el) {
            el.value = val;
            ['input', 'change'].forEach(e => el.dispatchEvent(new Event(e, { bubbles: true })));
          }
        }, SEL.captchaInput, solved);

        console.log(`[CAPTCHA] Filled: "${solved}" — clicking submit`);
        await safeEval(page, sel => {
          const btn = document.querySelector(sel);
          if (btn) btn.click();
        }, SEL.submitBtn);

        return true;
      }

      // Reload CAPTCHA and retry
      if (attempt < 4) {
        console.log('[CAPTCHA] Reloading...');
        await safeEval(page, sel => {
          const el = document.querySelector(sel);
          if (el) el.click();
        }, SEL.captchaReload).catch(() => { });
        await sleep(1200);
      }
    }
    console.warn('[CAPTCHA] Auto-solve failed — user must fill manually');
    return false;
  } catch (e) {
    console.warn('[CAPTCHA] Error:', e.message);
    return false;
  }
}

// ─── WAIT FOR DASHBOARD ─────────────────────────────────────────────────────
// Polls all open tabs until one is on the UMS dashboard, returns that page.
async function waitForDashboard(browser, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(1500);
    try {
      const pages = await browser.pages();
      for (const p of pages) {
        const url = (p.url() || '').toLowerCase();
        if (
          url.includes('studentdashboard') ||
          url.includes('default3') ||
          (url.includes('ums.lpu.in') && !url.endsWith('/') && !url.includes('loginnew') && !url.includes('lpuums/') && url.length > 30)
        ) {
          console.log(`[UMS] Dashboard URL: ${url}`);
          return p;
        }
      }
    } catch (_) { }
  }
  return null;
}

// ─── INTERCEPT ATTENDANCE AJAX ─────────────────────────────────────────────
// Registers a response listener for the getAtt endpoint and returns a Promise
// that resolves with the parsed attendance rows (or rejects on timeout).
function interceptAttendanceAjax(page, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      page.off('response', handler);
      reject(new Error('Attendance AJAX response not received within timeout'));
    }, timeoutMs);

    async function handler(response) {
      try {
        const url = response.url().toLowerCase();
        // Match the getAtt endpoint (StudentDashboard.aspx/getAtt or similar)
        if (!url.includes('studentdashboard') || !url.includes('getatt')) return;

        console.log(`[UMS] Intercepted attendance response: ${response.url()}`);
        const raw = await response.text();
        fs.writeFileSync(path.join(__dirname, 'debug_att_ajax.json'), raw);

        // UMS returns: { "d": "[[\"CourseCode\",\"att%\",...], ...]" } (nested JSON string)
        const outer = JSON.parse(raw);
        const inner = outer.d !== undefined ? outer.d : raw;
        const rows = typeof inner === 'string' ? JSON.parse(inner) : inner;

        clearTimeout(timer);
        page.off('response', handler);
        resolve(rows);
      } catch (e) {
        // Not the right response or parse error — keep waiting
      }
    }

    page.on('response', handler);
  });
}

// ─── IS AGGREGATE ROW ? ──────────────────────────────────────────────────────
// UMS includes an "Aggregate Attendance" summary row — detect it so we can
// pull it out and show it in the overall ring instead of as a subject card.
function isAggregateRow(subject) {
  const s = (subject || '').toLowerCase();
  return s.includes('aggregate') || s.includes('total attendance') ||
    s.includes('overall') || s === 'total';
}

// ─── PARSE ATTENDANCE ROWS ─────────────────────────────────────────────────
// Returns { subjects: [...], aggregatePct: number|null }
function parseAttendanceRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return { subjects: [], aggregatePct: null };

  function parseNum(v) {
    if (!v && v !== 0) return 0;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : n;
  }

  let parsed = [];

  // Each row is an object (ASP.NET page methods)
  if (typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
    parsed = rows.map(r => {
      const subject = r.SubjectTitle || r.CourseName || r.Course || r.subject || '';
      const total = parseNum(r.TotalDelivered || r.total || r.TotalClasses || 0);
      const attended = parseNum(r.TotalAttended || r.attended || r.Present || 0);
      const pct = parseNum(r.Percentage || r.percentage || (total > 0 ? (attended / total * 100) : 0));
      return { subject, attended: Math.round(attended), total: Math.round(total), percentage: Math.round(pct) };
    }).filter(r => r.subject && r.total > 0);
  }

  // Each row is an array (positional)
  else if (Array.isArray(rows[0])) {
    parsed = rows.map(cells => {
      function parseSum(str) {
        if (!str || str === '-') return 0;
        return String(str).split(',').reduce((s, x) => s + (parseInt(x) || 0), 0);
      }
      const subject = String(cells[0] || '').trim();
      const total = parseSum(cells[3]);
      const attended = parseSum(cells[4]);
      const pctStr = String(cells[5] || '');
      const pctMatch = pctStr.match(/[\d.]+/);
      const pct = pctMatch ? parseFloat(pctMatch[0]) : (total > 0 ? Math.round(attended / total * 100) : 0);
      return { subject, attended: Math.round(attended), total: Math.round(total), percentage: Math.round(pct) };
    }).filter(r => r.subject && r.total > 0);
  }

  // Separate aggregate row from real subjects
  const aggRow = parsed.find(r => isAggregateRow(r.subject));
  const subjects = parsed.filter(r => !isAggregateRow(r.subject));
  const aggregatePct = aggRow ? aggRow.percentage : null;

  return { subjects, aggregatePct };
}

// ─── FALLBACK: SCRAPE TABLE FROM DOM ────────────────────────────────────────
// If AJAX intercept fails, wait for #AttSummary to populate and scrape DOM.
async function scrapeAttFromDom(dashPage) {
  console.log('[UMS] Fallback: scraping #AttSummary from DOM...');

  // Trigger the modal
  await safeEval(dashPage, () => {
    const attEl = document.querySelector('[onclick*="getAtt"], [data-target="#AttmyModal"], #AttPercent');
    if (attEl) { attEl.click(); return; }
    if (typeof $ !== 'undefined' && $('#AttmyModal').length) $('#AttmyModal').modal('show');
  }).catch(() => { });

  // Wait for rows
  try {
    await dashPage.waitForFunction(
      () => { const t = document.querySelector('#AttSummary'); return t && t.querySelectorAll('tr').length > 0; },
      { timeout: 20000, polling: 500 }
    );
  } catch (_) { }

  await sleep(2000);

  const html = await dashPage.content().catch(() => '');
  fs.writeFileSync(path.join(__dirname, 'debug_attendance.html'), html);

  return await safeEval(dashPage, () => {
    function parseSum(str) {
      if (!str || str === '-') return 0;
      return String(str).split(',').reduce((s, x) => s + (parseInt(x) || 0), 0);
    }
    const tbody = document.querySelector('#AttSummary');
    if (!tbody) return { err: 'No #AttSummary' };
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (!rows.length) return { err: 'AttSummary empty' };

    return rows.map(row => {
      const cells = Array.from(row.querySelectorAll('td')).map(td => td.innerText.trim());
      if (cells.length < 4) return null;
      const subject = cells[0] || '';
      const total = parseSum(cells[3]);
      const attended = parseSum(cells[4]);
      const pctM = (cells[5] || '').match(/[\d.]+/);
      const pct = pctM ? parseFloat(pctM[0]) : (total > 0 ? Math.round(attended / total * 100) : 0);
      if (!subject || !total) return null;
      return { subject, attended: Math.round(attended), total: Math.round(total), percentage: Math.round(pct) };
    }).filter(Boolean);
  }).catch(() => ({ err: 'DOM eval failed' }));
}



// ─── MAIN EXPORT ────────────────────────────────────────────────────────────
// onAttendance(data) fires as soon as attendance is ready — before timetable.
// onProgress(msg)    fires live status messages shown on the login page.
async function loginAndFetchAttendance({ regNo = '', password = '', onAttendance = null, onProgress = null } = {}) {
  const progress = (msg) => {
    console.log('[PROGRESS]', msg);
    if (typeof onProgress === 'function') try { onProgress(msg); } catch (_) { }
  };

  progress('🌐 Launching browser…');
  const browser = await launchBrowser();

  try {
    const page0 = await browser.newPage();
    await page0.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // ── 1. Try saved session cookies first ────────────────────────────────
    let dashPage = null;
    const savedSession = loadSession(regNo);
    if (savedSession) {
      progress('⚡ Found saved session — trying fast login…');
      try {
        await page0.setCookie(...savedSession.cookies);
        await page0.goto(UMS_DASH, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await sleep(1500);
        const url = page0.url().toLowerCase();
        if (url.includes('studentdashboard') || url.includes('default3')) {
          console.log('[SESSION] ✅ Cookie session valid — skipping login!');
          progress('✅ Session restored — reading attendance…');
          dashPage = page0;
        } else {
          console.log('[SESSION] Cookie session invalid — falling back to full login');
        }
      } catch (e) {
        console.warn('[SESSION] Cookie restore failed:', e.message);
      }
    }

    // ── 2. Full headless login flow ──────────────────────────────────────
    if (!dashPage) {
      progress('🔐 Opening UMS login page…');
      if (savedSession) {
        try { await page0.close(); } catch (_) { }
      }
      const loginPage = savedSession ? await browser.newPage() : page0;

      await loginPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await loginPage.goto(UMS_LOGIN, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(2000);

      progress('✋ Please log in with your credentials in the browser window');

      progress('⏳ Waiting for UMS dashboard…');
      dashPage = await waitForDashboard(browser, 180000);
      if (!dashPage) throw new Error('Login timeout — dashboard not detected within 3 minutes.');
    }

    progress('📊 Dashboard detected — reading your attendance…');
    await sleep(2000);

    // ── 5. Extract student info (safe, broad search) ──────────────────────
    let name = '', program = '';
    try {
      name = await safeEval(dashPage, () => {
        // 1. Priority selectors for common UMS label IDs
        const nameSels = [
          '[id*="lblStudentName"]', '[id*="lblStudent"]', '[id*="lblUser"]',
          '[id*="lblName"]', '[id*="StudentName"]', '.student-name',
          '#ctl00_cphHeading_lnkStudent', '#ctl00_cphHeading_lblStudent',
          '[id*="lnkStudent"]', '[id*="NameLabel"]',
        ];
        for (const s of nameSels) {
          const e = document.querySelector(s);
          const t = (e?.innerText || e?.textContent || '').trim();
          if (t && t.length > 2 && !/welcome|dear|logout|home|menu/i.test(t)) return t;
        }

        // 2. Try "Welcome, NAME" or "Dear NAME" patterns in any element
        const allEls = Array.from(document.querySelectorAll('span, div, td, p, h1, h2, h3, b, strong, a'));
        for (const el of allEls) {
          const t = (el.innerText || el.textContent || '').trim();
          // "Welcome, FIRSTNAME LASTNAME" pattern
          const welcomeMatch = t.match(/(?:welcome[,\s]+|dear\s+)([A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+)+)/i);
          if (welcomeMatch) return welcomeMatch[1].trim();
        }

        // 3. Broader ID scan: element whose id contains name/student/user
        const idScan = Array.from(document.querySelectorAll('span, label, td, div, a'));
        for (const el of idScan) {
          const id = (el.id || '').toLowerCase();
          if (!id.includes('name') && !id.includes('student') && !id.includes('user')) continue;
          const t = (el.innerText || el.textContent || '').trim();
          // A name: 2+ words, mostly letters, not a URL or long sentence
          if (t && t.length > 3 && t.length < 80 && t.split(' ').length >= 2 && /^[A-Za-z .']+$/.test(t)) return t;
        }

        // 4. Last resort: look for any text that looks like a ALLCAPS student name (LPU shows names in caps)
        for (const el of allEls) {
          const t = (el.innerText || el.textContent || '').trim();
          if (t.length > 5 && t.length < 60 && /^[A-Z][A-Z .']+$/.test(t) && t.split(' ').length >= 2
            && !/LOGOUT|DASHBOARD|ATTENDANCE|TIMETABLE|WELCOME|MENU|HOME|UMS|LPU/i.test(t)) {
            return t;
          }
        }
        return '';
      });

      program = await safeEval(dashPage, () => {
        const progSels = [
          '[id*="lblProgram"]', '[id*="lblCourse"]', '[id*="lblcourse"]',
          '[id*="lblBatch"]', '[id*="lblDep"]', '[id*="lblDept"]',
          '[id*="Program"]', '[id*="Branch"]', '[id*="Scheme"]',
          'span[id*="batch"]', 'span[id*="Batch"]',
        ];
        for (const s of progSels) {
          const e = document.querySelector(s);
          const t = e?.innerText?.trim() || e?.textContent?.trim();
          if (t && t.length > 2) return t;
        }
        return '';
      });
    } catch (_) { }
    // If name extraction completely failed, use regNo as display name
    if (!name) name = regNo || 'LPU Student';
    console.log(`[UMS] Student: "${name}" | Program: "${program}"`);

    // ── 6. Navigate to StudentDashboard if not already there ──────────────
    if (!dashPage.url().toLowerCase().includes('studentdashboard')) {
      console.log('[UMS] Navigating to StudentDashboard...');
      try {
        await dashPage.goto(UMS_DASH, { waitUntil: 'networkidle2', timeout: 40000 });
        await sleep(3000);
      } catch (e) {
        console.warn('[UMS] Navigation warning (continuing):', e.message);
        await sleep(3000);
      }
    }

    // ── 7. Try reading #AttSummary directly — UMS pre-renders it on page load ──
    console.log('[UMS] Reading attendance from #AttSummary (pre-rendered)...');
    let subjects = [];
    let aggregatePct = null;

    const directResult = await safeEval(dashPage, () => {
      function parseSum(str) {
        if (!str || str === '-') return 0;
        return String(str).split(',').reduce((s, x) => s + (parseInt(x) || 0), 0);
      }
      const tbody = document.querySelector('#AttSummary');
      if (!tbody) return null;
      const rows = Array.from(tbody.querySelectorAll('tr'));
      if (!rows.length) return null;

      const results = [];
      for (const row of rows) {
        const cells = Array.from(row.querySelectorAll('td')).map(td => (td.innerText || td.textContent || '').trim());
        if (cells.length < 5) continue;
        // Columns: [0]=Course, [1]=LastAttended, [2]=Tutored/Practical, [3]=TotalDelivered, [4]=TotalAttended, [5]=Percentage
        const subject = cells[0].replace(/<[^>]+>/g, '').trim();
        if (!subject) continue;
        const total = parseSum(cells[3]);
        const attended = parseSum(cells[4]);
        const pctStr = cells[5] || '';
        const pctMatch = pctStr.match(/[\d.]+/);
        const pct = pctMatch ? parseFloat(pctMatch[0]) : (total > 0 ? Math.round(attended / total * 100) : 0);
        if (!subject) continue;
        results.push({ subject, attended: Math.round(attended), total: Math.round(total), percentage: Math.round(pct) });
      }
      return results.length ? results : null;
    }).catch(() => null);

    if (directResult && Array.isArray(directResult) && directResult.length > 0) {
      console.log(`[UMS] ✅ Direct DOM read: ${directResult.length} rows`);
      subjects = directResult.filter(r => !isAggregateRow(r.subject));
      const aggRow = directResult.find(r => isAggregateRow(r.subject));
      if (aggRow) aggregatePct = aggRow.percentage;
      console.log(`[UMS] Parsed ${subjects.length} subjects (aggregate: ${aggregatePct}%)`);
    } else {
      // ── 8. Fallback: intercept AJAX + trigger modal ───────────────────────
      console.log('[UMS] #AttSummary empty — setting up AJAX interceptor and triggering modal...');
      const ajaxPromise = interceptAttendanceAjax(dashPage, 20000);
      await sleep(800);

      await safeEval(dashPage, () => {
        try { if (typeof getAtt === 'function') { getAtt(); return 'getAtt()'; } } catch (_) { }
        const el = document.querySelector('#AttPercent, [onclick*="getAtt"], [data-target="#AttmyModal"]');
        if (el) { el.click(); return 'click'; }
        if (typeof $ !== 'undefined' && $('#AttmyModal').length) { $('#AttmyModal').modal('show'); return 'jquery'; }
        return 'no trigger';
      }).catch(e => console.warn('[UMS] Trigger warning:', e.message));

      try {
        const rawRows = await ajaxPromise;
        console.log('[UMS] ✅ AJAX response captured!');
        fs.writeFileSync(path.join(__dirname, 'debug_att_ajax.json'), JSON.stringify(rawRows, null, 2));
        ({ subjects, aggregatePct } = parseAttendanceRows(rawRows));
        console.log(`[UMS] Parsed ${subjects.length} subjects (aggregate: ${aggregatePct}%)`);
      } catch (ajaxErr) {
        console.warn('[UMS] AJAX intercept failed:', ajaxErr.message);
        console.log('[UMS] Falling back to DOM scraping after delay...');
        const domResult = await scrapeAttFromDom(dashPage);
        if (Array.isArray(domResult)) {
          subjects = domResult.filter(r => !isAggregateRow(r.subject));
          const aggRow = domResult.find(r => isAggregateRow(r.subject));
          if (aggRow) aggregatePct = aggRow.percentage;
          console.log(`[UMS] DOM scraped ${subjects.length} subjects (aggregate: ${aggregatePct}%)`);
        } else {
          console.log('[UMS] DOM result:', JSON.stringify(domResult));
        }
      }
    }

    // Save debug snapshot of the dashboard page
    dashPage.content().then(html => {
      fs.writeFileSync(path.join(__dirname, 'debug_attendance.html'), html);
    }).catch(() => { });

    // ── 8.5 Extract Extended Profile Data (CGPA, Roll No, Term) ─────────────
    console.log('[UMS] Extracting extended profile data...');
    const profileData = await safeEval(dashPage, () => {
      let cgpa = null;
      let rollNo = null;
      let term = null;
      
      try {
        // CGPA is typically inside `<div id="cgpa"><b> CGPA</b> : 7.04...</div>`
        const cgpaEl = document.querySelector('#cgpa');
        if (cgpaEl) {
          const match = cgpaEl.innerText.match(/[\d.]+/);
          if (match) cgpa = match[0];
        }

        // Roll No and Term are found in the course cards (.mycoursesdiv)
        // e.g., `Term : 25262` and `Roll No : R424FEB32 / Group 2`
        const courseCards = document.querySelectorAll('.mycoursesdiv p');
        courseCards.forEach(p => {
          const text = p.innerText || p.textContent || '';
          if (text.includes('Term :')) {
            const tMatch = text.match(/Term\s*:\s*(\d+)/i);
            if (tMatch && !term) term = tMatch[1];
          }
          if (text.includes('Roll No :')) {
            const rMatch = text.match(/Roll No\s*:\s*([^/]+)/i);
            if (rMatch && !rollNo) rollNo = rMatch[1].trim();
          }
        });
      } catch (e) {}

      return { cgpa, rollNo, term };
    }).catch(() => ({ cgpa: null, rollNo: null, term: null }));

    console.log(`[UMS] Profile Data -> CGPA: ${profileData.cgpa}, Roll No: ${profileData.rollNo}, Term: ${profileData.term}`);

    // ── 9. Fire onAttendance callback NOW (before timetable) ───────────────
    // Build bunk stats first
    subjects = subjects.map(s => ({
      ...s,
      needed: s.percentage < 75 ? Math.ceil((0.75 * s.total - s.attended) / 0.25) : 0,
      canBunk: s.percentage >= 75 ? Math.floor((s.attended - 0.75 * s.total) / 0.75) : 0,
    }));

    // ── 9.5. Scrape grade card (non-blocking) ──────────────────────────────
    progress('⭐ Fetching grades & credits…');
    let gradeData = [];
    try {
      gradeData = await scrapeGradeCard(browser);
      console.log(`[GRADES] Final: ${gradeData.length} subjects`);
    } catch (ge) {
      console.warn('[GRADES] Grade fetch error (non-fatal):', ge.message);
    }

    if (typeof onAttendance === 'function') {
      try {
        onAttendance({ 
            name, 
            program, 
            subjects, 
            overallPct: aggregatePct,
            cgpa: profileData.cgpa,
            rollNo: profileData.rollNo,
            term: profileData.term,
            gradeData,
        });
        console.log('[SERVER] ⚡ onAttendance callback fired — client can render now!');
      } catch (cbErr) {
        console.warn('[SERVER] onAttendance callback error:', cbErr.message);
      }
    }

    // ── 10. Fetch Timetable (SSRS Report Viewer) ────────────────────────────
    // The timetable page uses Microsoft SSRS which renders via a postback AFTER
    // the initial page load. The export URL triggers a file download (ERR_ABORTED
    // if navigated to), so we use in-page fetch() to grab the export body directly.
    let timetable = [];
    try {
      progress('📅 Fetching your timetable…');
      const ttPage = await browser.newPage();
      await ttPage.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      // Load timetable page and wait for SSRS to fire its initial postback
      await ttPage.goto(
        'https://ums.lpu.in/lpuums/Reports/frmStudentTimeTable.aspx',
        { waitUntil: 'networkidle2', timeout: 30000 }
      );
      await sleep(4000); // let SSRS initialise and get a ReportSession

      // ── Strategy 1: in-page fetch() of SSRS HTML export ──────────────────
      // We call fetch() from within the page so it inherits all session cookies.
      // This avoids the ERR_ABORTED that happens when Puppeteer navigates to a
      // Content-Disposition:attachment URL.
      let exportHtml = null;
      try {
        exportHtml = await ttPage.evaluate(async () => {
          // Pull the ExportUrlBase from the inline JS
          let exportBase = null;
          for (const s of document.querySelectorAll('script')) {
            const m = s.textContent.match(/"ExportUrlBase"\s*:\s*"([^"]+)"/);
            if (m) { exportBase = m[1].replace(/\\u0026/g, '&'); break; }
          }
          if (!exportBase) return null;

          const url = 'https://ums.lpu.in' + exportBase + 'HTML4.0';
          try {
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) return null;
            return await res.text();
          } catch (e) { return null; }
        });
      } catch (_) {}

      if (exportHtml && exportHtml.length > 200) {
        console.log(`[UMS] SSRS fetch() response: ${exportHtml.length} bytes`);
        fs.writeFileSync(path.join(__dirname, 'debug_timetable_export.html'), exportHtml);

        // Parse inside Puppeteer using the real SSRS HTML structure:
        // Row 0 (header): [Timing, Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday]
        // Row 1+: [09-10 AM, <Mon cell>, <Tue cell>, <Wed cell>, ...]
        // Each cell: "Lecture / G:All C:CSR212 / R: 25-702 / S..."
        timetable = await ttPage.evaluate((html) => {
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const slots = [];

          const DAYS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
          const DAY_SET = new Set(DAYS);

          // Find the table that has day names in a header row
          const tables = Array.from(doc.querySelectorAll('table'));
          let gridTable = null;
          let headerRowIdx = -1;
          let dayColMap = {}; // col index → day name

          for (const t of tables) {
            const rows = Array.from(t.rows);
            for (let ri = 0; ri < rows.length; ri++) {
              const cells = Array.from(rows[ri].cells).map(c => (c.textContent || '').trim());
              const dayCount = cells.filter(c => DAY_SET.has(c)).length;
              if (dayCount >= 4) { // found header row
                gridTable = t;
                headerRowIdx = ri;
                cells.forEach((c, i) => { if (DAY_SET.has(c)) dayColMap[i] = c; });
                break;
              }
            }
            if (gridTable) break;
          }

          if (!gridTable || Object.keys(dayColMap).length === 0) return slots;

          const rows = Array.from(gridTable.rows);
          for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
            const cells = Array.from(rows[ri].cells).map(c => (c.textContent || '').replace(/\s+/g, ' ').replace(/\u00a0/g, '').trim());
            if (!cells.length) continue;

            // First cell is the time slot (e.g. "09-10 AM")
            const timeCell = cells[0];
            if (!timeCell || !/\d/.test(timeCell)) continue;

            // Normalise time to "HH:MM" format expected downstream
            // "09-10 AM" → store as-is, or convert to "09:00"
            const timeNorm = timeCell; // keep original e.g. "09-10 AM"

            // Iterate day columns
            Object.entries(dayColMap).forEach(([colStr, day]) => {
              const col = parseInt(colStr);
              const cellText = cells[col] || '';
              if (!cellText || cellText === '&nbsp;' || cellText.length < 4) return;

              // Extract course code: "C:CSR212"
              const codeMatch = cellText.match(/C:([A-Z]{2,6}\d{2,4})/i);
              if (!codeMatch) return;
              const courseCode = codeMatch[1].toUpperCase();

              // Extract room: "R: 25-702"
              const roomMatch = cellText.match(/R:\s*([\w-]+)/i);
              const room = roomMatch ? roomMatch[1] : '';

              // Determine class type
              const typeMatch = cellText.match(/^(Lecture|Practical|Tutorial|Project|Lab)/i);
              const classType = typeMatch ? typeMatch[1] : 'Class';

              slots.push({
                day,
                time: timeNorm,
                subject: courseCode,  // course code — will be matched against attendance
                courseCode,
                room,
                type: classType
              });
            });
          }

          return slots;
        }, exportHtml);

        console.log(`[UMS] ✅ SSRS in-page fetch parse: ${timetable.length} slots`);



      // ── Strategy 2: intercept SSRS async network response ──────────────────────
      // SSRS fires GET requests to ReportViewerWebControl.axd?OpType=ReportRenderingComplete
      // or similar. We reload the page, intercept the response that contains timetable data.
      if (!timetable.length) {
        console.log('[UMS] Strategy 1 failed — intercepting SSRS async responses...');

        let capturedHtml = null;
        const responseHandler = async (response) => {
          try {
            const url = response.url();
            if (!url.includes('ReportViewerWebControl') && !url.includes('frmStudent')) return;
            const ct = response.headers()['content-type'] || '';
            if (!ct.includes('html') && !ct.includes('text')) return;
            const body = await response.text().catch(() => '');
            if (body.length > 500 &&
                /Monday|Tuesday|Wednesday|Thursday|Friday/i.test(body) &&
                /\d{1,2}:\d{2}/.test(body)) {
              console.log(`[UMS] Intercepted SSRS response: ${url} (${body.length} bytes)`);
              capturedHtml = body;
            }
          } catch (_) {}
        };
        ttPage.on('response', responseHandler);

        await ttPage.goto(
          'https://ums.lpu.in/lpuums/Reports/frmStudentTimeTable.aspx',
          { waitUntil: 'networkidle2', timeout: 30000 }
        );
        await sleep(6000); // wait extra for async report rendering
        ttPage.off('response', responseHandler);

        if (capturedHtml) {
          fs.writeFileSync(path.join(__dirname, 'debug_timetable_intercept.html'), capturedHtml);
          // Reuse the DOMParser approach
          timetable = await ttPage.evaluate((html) => {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const slots = [];
            const DAYS = new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
            let currentDay = '';
            const tables = Array.from(doc.querySelectorAll('table'));
            let best = null, bestScore = 0;
            tables.forEach(t => {
              const txt = t.textContent || '';
              let s = 0;
              if (/Monday|Tuesday|Wednesday|Thursday|Friday/i.test(txt)) s += 15;
              if (/\d{1,2}:\d{2}/.test(txt)) s += 8;
              if (s > bestScore) { bestScore = s; best = t; }
            });
            if (!best || bestScore < 8) return slots;
            Array.from(best.rows).forEach(row => {
              const cells = Array.from(row.cells).map(c => (c.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
              if (!cells.length) return;
              if (DAYS.has(cells[0])) { currentDay = cells[0]; return; }
              const dm = cells[0].match(/^(Monday|Tuesday|Wednesday|Thursday|Friday)/i);
              if (dm) currentDay = dm[1];
              const timeCell = cells.find(c => /^\d{1,2}:\d{2}/.test(c));
              if (!timeCell || !currentDay) return;
              const subj = cells.filter(c => c !== timeCell && c.length > 3 && !/^\d/.test(c) && !DAYS.has(c))
                .reduce((a, b) => b.length > a.length ? b : a, '');
              if (!subj) return;
              slots.push({ day: currentDay, time: timeCell, subject: subj, room: '' });
            });
            return slots;
          }, capturedHtml);
          console.log(`[UMS] ✅ Intercept parse: ${timetable.length} slots`);
        }
      }

      // ── Strategy 3: full DOM scrape with longer wait ───────────────────────
      if (!timetable.length) {
        console.log('[UMS] Strategy 2 failed — DOM scrape with extended wait...');

        const ttHtml = await ttPage.content();
        fs.writeFileSync(path.join(__dirname, 'debug_timetable.html'), ttHtml);

        // Try scraping all iframes too (SSRS sometimes puts report in iframe)
        const frames = ttPage.frames();
        for (const frame of frames) {
          try {
            const frameSlots = await frame.evaluate(() => {
              const DAYS = new Set(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']);
              const slots = [];
              let currentDay = '';
              const tables = document.querySelectorAll('table');
              let best = null, bestScore = 0;
              tables.forEach(t => {
                const txt = t.textContent || '';
                let s = 0;
                if (/Monday|Tuesday|Wednesday|Thursday|Friday/i.test(txt)) s += 15;
                if (/\d{1,2}:\d{2}/.test(txt)) s += 8;
                if (s > bestScore) { bestScore = s; best = t; }
              });
              if (!best || bestScore < 8) return [];
              Array.from(best.rows).forEach(row => {
                const cells = Array.from(row.cells).map(c => (c.textContent||'').replace(/\s+/g,' ').trim()).filter(Boolean);
                if (!cells.length) return;
                if (DAYS.has(cells[0])) { currentDay = cells[0]; return; }
                const dm = cells[0].match(/^(Monday|Tuesday|Wednesday|Thursday|Friday)/i);
                if (dm) currentDay = dm[1];
                const timeCell = cells.find(c => /^\d{1,2}:\d{2}/.test(c));
                if (!timeCell || !currentDay) return;
                const subj = cells.filter(c => c !== timeCell && c.length > 3 && !/^\d/.test(c) && !DAYS.has(c))
                  .reduce((a, b) => b.length > a.length ? b : a, '');
                if (!subj) return;
                slots.push({ day: currentDay, time: timeCell, subject: subj, room: '' });
              });
              return slots;
            });
            if (frameSlots.length > 0) {
              timetable = frameSlots;
              console.log(`[UMS] ✅ Frame scrape: ${timetable.length} slots from frame ${frame.url()}`);
              break;
            }
          } catch (_) {}
        }
      }

      try { await ttPage.close(); } catch (_) {}

      if (timetable.length > 0) {
        fs.writeFileSync(path.join(__dirname, 'debug_timetable.json'), JSON.stringify(timetable, null, 2));
        console.log(`[UMS] ✅ Timetable saved: ${timetable.length} slots`);
      } else {
        console.warn('[UMS] ⚠️ Timetable: 0 slots found after all 3 strategies — check debug_timetable*.html');
      }

    }
    } catch (ttErr) {
      console.warn('[UMS] Timetable fetch failed (non-fatal):', ttErr.message);
    }



    // ── Save cookies for next fast-login ──────────────────────────────────
    try {
      const allPages = await browser.pages();
      if (allPages.length > 0) {
        const cookies = await allPages[0].cookies();
        if (cookies.length) saveSession(cookies, regNo);
      }
    } catch (e) { console.warn('[SESSION] Could not capture cookies:', e.message); }

    await browser.close();

    if (!subjects || subjects.length === 0) {
      throw new Error(
        'Could not find attendance data. ' +
        'Check server/debug_att_ajax.json or server/debug_attendance.html for clues.'
      );
    }

    return { name, program, subjects, overallPct: aggregatePct, timetable, gradeData };


  } catch (err) {
    try { await browser.close(); } catch (_) { }
    throw err;
  }
}

module.exports = { loginAndFetchAttendance, checkSavedSession };
