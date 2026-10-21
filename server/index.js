const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const helmet = require('helmet');
const { migrate } = require('./db');
const { seedBase } = require('./seed');
const { auth } = require('./lib');

const app = express();
app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", 'https://cdnjs.cloudflare.com'],
      'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      'font-src': ["'self'", 'https://fonts.gstatic.com'],
      'img-src': ["'self'", 'data:', 'blob:'],
      'connect-src': ["'self'"]
    }
  }
}));
app.use(compression());
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());

app.get('/healthz', (req, res) => res.send('ok'));

const masters = require('./routes/masters');
app.use('/api', masters.publicRouter);
app.use('/api', auth, masters.router);
app.use('/api', auth, require('./routes/finance'));
app.use('/api', auth, require('./routes/ops'));
app.use('/api', auth, require('./routes/store'));
app.use('/api', auth, require('./routes/dash').router);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.get('/vendor/chart.umd.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'chart.js', 'dist', 'chart.umd.js'), { maxAge: '7d' }));
app.get('/vendor/xlsx.full.min.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'node_modules', 'xlsx', 'dist', 'xlsx.full.min.js'), { maxAge: '7d' }));
// Always re-check app files with the server (cheap 304 when unchanged) so new releases show up immediately.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  index: 'index.html',
  setHeaders: (res, file) => { res.setHeader('Cache-Control', /\.(png|svg|ico)$/.test(file) ? 'public, max-age=86400' : 'no-cache'); }
}));
app.use((req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(path.join(__dirname, '..', 'public', 'index.html')); });

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on the server. Please try again.' : err.message });
});

const PORT = process.env.PORT || 3000;
(async () => {
  await migrate();
  let loaded = false;
  if (process.env.SEED_DEMO === 'true') loaded = await require('./seed-demo').loadDemoDump().catch((e) => { console.error('Demo dataset load failed:', e.message); return false; });
  await seedBase();
  app.listen(PORT, () => console.log(`S-CUBUS Operations running on :${PORT}`));
  if (process.env.SEED_DEMO === 'true' && !loaded && process.env.SEED_DEMO_GENERATE === 'true') {
    require('./seed-demo').seedDemo().catch((e) => console.error('Demo seed failed:', e));
  }
})().catch((e) => { console.error(e); process.exit(1); });
