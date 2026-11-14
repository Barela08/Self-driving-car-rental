// Vercel rewrites /api/* to this serverless function. The backend bundle exports
// createApp (a named export), not a default request handler.
import { createApp } from './_server.mjs';

let appPromise;

export default async function handler(req, res) {
  try {
    appPromise ||= createApp();
    const app = await appPromise;
    return app(req, res);
  } catch (error) {
    console.error('Vercel API function failed to initialize:', error);
    return res.status(500).json({ error: 'API function failed to initialize.' });
  }
}
