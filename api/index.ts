// Vercel serverless entry point.
// All `/api/*` requests are rewritten to this function (see vercel.json) and
// served by the same Express app that runs locally via `npm run dev`.
import handler from '../server.ts';

export default handler;
