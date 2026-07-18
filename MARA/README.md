# MARA frontend

The deployed MARA interface — Next.js 15, static-exported, served by Vercel.
Pages: `/` (landing) · `/terminal` (live cognition) · `/portfolio` (desk) ·
`/duel` (Signal Duel) · `/replay` (Time Machine).

Every number on screen comes from the macromind engine (REST + WebSocket at
`NEXT_PUBLIC_API_URL`); the generative art (guilloche fields, monetary core,
particle canvas) is explicitly decorative and carries no fabricated data.

```bash
npm install
npm run dev     # http://localhost:3000 against a local backend on :3001
npm run build   # static export to out/ (what Vercel deploys)
```

See the repository root README for the full system documentation.
