import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { pool } from './db.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';

const ROOT = process.env.SITE_ROOT || path.resolve(process.cwd(), '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: false, limit: '200kb' }));
app.use(cookieParser());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

const sendPage = (file) => (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(ROOT, file));
};

app.get('/', sendPage('index.html'));
app.get('/admin', sendPage('admin.html'));
app.get('/track', sendPage('track.html'));

// No max-age: browsers revalidate on each load, so edited front-end files show
// up immediately instead of being served from a stale hour-long cache.
app.use('/assets', express.static(path.join(ROOT, 'assets'), { index: false, etag: true, lastModified: true }));
app.use(
  '/uploads',
  express.static(process.env.UPLOAD_DIR || path.resolve(ROOT, 'uploads'), { index: false, etag: true, lastModified: true }),
);

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Database unavailable' });
  }
});

// Admin routes first: they must never fall through to the public API.
app.use('/api/admin', adminRoutes);
app.use('/api', publicRoutes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((req, res) => res.status(404).type('text/plain').send('Not found'));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error('[error]', req.method, req.originalUrl, err.message);
  if (res.headersSent) return;
  res.status(status).json({
    error: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
    ...(err.fields ? { fields: err.fields } : {}),
  });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[api] listening on http://0.0.0.0:${PORT} (site root ${ROOT})`);
});

const shutdown = () => {
  server.close(() => pool.end().finally(() => process.exit(0)));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
