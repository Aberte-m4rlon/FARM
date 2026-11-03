import type { VercelRequest, VercelResponse } from '@vercel/node';

const DEFAULT_ORIGINS = ['https://alpasfarm.site', 'https://www.alpasfarm.site'];

export function applyApiCors(req: VercelRequest, res: VercelResponse): void {
  const configured = process.env.ALLOWED_FRONTEND_ORIGINS;
  const allowedOrigins = new Set(
    (configured ? configured.split(',') : DEFAULT_ORIGINS)
      .map((origin) => origin.trim().replace(/\/+$/, ''))
      .filter((origin) => origin && origin !== '*'),
  );
  const requestOrigin = req.headers.origin;
  if (typeof requestOrigin === 'string' && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
  }
  res.setHeader('Vary', 'Origin');
}
