require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { loginAndFetchAttendance, checkSavedSession } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Serve the client folder
app.use(express.static(path.join(__dirname, '../client')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'YUMS server is running' });
});

// ── Session status ─────────────────────────────────────────────────────────────
app.get('/api/session/status', (req, res) => {
    const { regNo = '' } = req.query;
    if (!regNo) return res.json({ valid: false });
    res.json(checkSavedSession(regNo));
});

// ── Session clear ─────────────────────────────────────────────────────────────
app.delete('/api/session/clear', (req, res) => {
    const fs = require('fs');
    const os = require('os');
    const p = require('path').join(os.tmpdir(), 'yums_session.json');
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (_) {}
    res.json({ cleared: true });
});

// ── In-memory state ────────────────────────────────────────────────────────────
let sessionInProgress = false;

// ── Progressive login via SSE ─────────────────────────────────────────────────
app.get('/api/login/stream', async (req, res) => {
    if (sessionInProgress) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
        res.write(`event: error\ndata: ${JSON.stringify({ error: 'A session is already running. Please wait.' })}\n\n`);
        return res.end();
    }

    const { regNo = '', password = '' } = req.query;

    // SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
    });

    let clientConnected = true;
    req.on('close', () => {
        clientConnected = false;
        console.log('[SERVER] Client navigated away — scraper continues in background');
    });

    const send = (event, data) => {
        if (!clientConnected) return;
        try { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch (_) { clientConnected = false; }
    };

    const keepAlive = setInterval(() => {
        if (!clientConnected) { clearInterval(keepAlive); return; }
        try { res.write(': ping\n\n'); } catch (_) { clientConnected = false; }
    }, 10000);

    // Mark session as in-progress
    sessionInProgress = true;

    console.log('[SERVER] Session started for:', regNo);

    try {
        const onAttendance = (data) => {
            // data contains name, program, subjects, overallPct, and timetable
            send('attendance', data);
            console.log(`[SERVER] ⚡ Attendance streamed: "${data.name}" — ${data.subjects?.length || 0} subjects`);
        };

        const onProgress = (msg) => {
            send('progress', { msg });
        };

        const finalData = await loginAndFetchAttendance({ regNo, password, onAttendance, onProgress });
        send('done', finalData);

    } catch (err) {
        console.error('[SERVER] Error:', err.message);
        send('error', { error: err.message || 'Login failed. Please try again.' });
    } finally {
        clearInterval(keepAlive);
        sessionInProgress = false;
        try { res.end(); } catch (_) { }
    }
});

// ── Legacy JSON login ─────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    if (sessionInProgress) {
        return res.status(429).json({ error: 'A session is already in progress.' });
    }
    const { regNo = '' } = req.body;
    sessionInProgress = true;
    try {
        const result = await loginAndFetchAttendance({ regNo });
        res.json({ success: true, ...result });
    } catch (err) {
        res.status(500).json({ error: err.message || 'Failed.' });
    } finally {
        sessionInProgress = false;
    }
});

// ── Global safety net ─────────────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    console.error('[SERVER] Unhandled rejection:', reason?.message || reason);
    sessionInProgress = false;
});

// ── Start ─────────────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
    console.log(`\n🎓 YUMS Server running at http://localhost:${PORT}`);
    console.log(`📊 Open http://localhost:${PORT} in your browser to get started.\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.warn(`\n⚠️  Port ${PORT} is in use — killing stale process and retrying...`);
        const { execSync } = require('child_process');
        try {
            execSync(`lsof -ti:${PORT} | xargs kill -9`, { stdio: 'ignore' });
            setTimeout(() => {
                const retry = app.listen(PORT, () => {
                    console.log(`\n🎓 YUMS Server running at http://localhost:${PORT}`);
                    console.log(`📊 Open http://localhost:${PORT} in your browser to get started.\n`);
                });
                retry.on('error', (e2) => {
                    console.error(`\n❌ Could not start server: ${e2.message}\n`);
                    process.exit(1);
                });
            }, 500);
        } catch (killErr) {
            console.error(`\n❌ Port ${PORT} in use. Run: kill -9 $(lsof -t -i:${PORT})\n`);
            process.exit(1);
        }
    } else throw err;
});
