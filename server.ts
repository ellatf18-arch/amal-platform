import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import cookieParser from 'cookie-parser';
import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { sql } from 'drizzle-orm';
import { db } from './src/db';
import { authRouter } from './server/routes/authRoutes';
import { publicAndWorkerRouter } from './server/routes/publicAndWorkerRoutes';
import { tenantRouter } from './server/routes/tenantRoutes';

function checkTcpPort(host: string, port: number, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function ensureLocalDevPostgres(): Promise<void> {
  if (process.env.NODE_ENV === 'production' || process.env.VITEST) return;
  const host = process.env.SQL_HOST || '127.0.0.1';
  const port = Number(process.env.SQL_PORT || 5432);
  if (host !== '127.0.0.1' && host !== 'localhost') return;

  const alive = await checkTcpPort(host, port);
  if (alive) return;

  const pgCtl = '/usr/lib/postgresql/15/bin/pg_ctl';
  const pgData = '/var/tmp/amal-pgdata';
  if (fs.existsSync(pgCtl) && fs.existsSync(path.join(pgData, 'PG_VERSION'))) {
    try {
      if (typeof process.getuid === 'function' && process.getuid() === 0) {
        execFileSync(
          'su',
          [
            '-s',
            '/bin/sh',
            'postgres',
            '-c',
            `${pgCtl} -D ${pgData} -l /var/tmp/amal-pg.log -o '-k /var/tmp/amal-pgrun' start`,
          ],
          { stdio: 'ignore' }
        );
      } else {
        execFileSync(
          pgCtl,
          ['-D', pgData, '-l', '/var/tmp/amal-pg.log', '-o', '-k /var/tmp/amal-pgrun', 'start'],
          { stdio: 'ignore' }
        );
      }
    } catch {
      // Surface connection errors via /api/v1/health if startup fails
    }
  }
}

export function createServerApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);

  // Preserve iFrame embedding in AI Studio preview while keeping hardening headers active
  app.use(
    helmet({
      contentSecurityPolicy: false,
      xFrameOptions: false,
      crossOriginResourcePolicy: false,
    })
  );

  app.use(cookieParser());

  // Preserve exact raw bytes for HMAC webhook signature verification
  app.use('/api/v1/webhooks/payments', express.raw({ type: 'application/json', limit: '1mb' }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/v1/health', async (_req: Request, res: Response) => {
    try {
      await db.execute(sql`SELECT 1`);
      res.json({
        ok: true,
        db: 'connected',
        paymentMode: (process.env.PAYMENT_MODE || 'disabled').toLowerCase(),
      });
    } catch (err) {
      res.status(503).json({
        ok: false,
        db: 'unavailable',
        error: err instanceof Error ? err.message : 'Database check failed',
      });
    }
  });

  app.use('/api/v1', authRouter);
  app.use('/api/v1', tenantRouter);
  app.use('/api/v1', publicAndWorkerRouter);

  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API route not found' });
  });

  // Structured API error handler (never leaks raw SQL/stack traces)
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api')) {
      next(err);
      return;
    }
    const status =
      typeof err === 'object' &&
      err !== null &&
      'status' in err &&
      typeof (err as { status?: unknown }).status === 'number'
        ? ((err as { status: number }).status)
        : 500;
    const message =
      status < 500 && err instanceof Error
        ? err.message
        : 'Internal server error';
    if (status >= 500 && process.env.NODE_ENV !== 'test') {
      console.error('[AMAL API ERROR]', req.method, req.path, err);
    }
    res.status(status).json({ error: message });
  });

  return app;
}

async function startServer(): Promise<void> {
  await ensureLocalDevPostgres();

  const app = createServerApp();
  const httpServer = http.createServer(app);
  const isProd = process.env.NODE_ENV === 'production';
  const port = Number(process.env.PORT || 3000);

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true,
        ws: { server: httpServer },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path.startsWith('/api')) {
        next();
        return;
      }
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  httpServer.listen(port, '0.0.0.0', () => {
    console.log(`AMAL server listening on http://0.0.0.0:${port} (${isProd ? 'production' : 'development'})`);
  });
}

const isEntrypoint =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint && !process.env.VITEST) {
  startServer().catch((err) => {
    console.error('Failed to start AMAL server:', err);
    process.exit(1);
  });
}
