// Vercel serverless entry point.
// `/api/*` requests are rewritten here (see vercel.json). The Express app from
// server.ts is bundled to ./_server.mjs by `npm run build` (scripts/bundle-server.mjs),
// because Vercel does not compile server.ts and its `.ts` imports on its own.
import handler from './_server.mjs';

export default handler;
