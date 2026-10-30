# Personal Tracker — merged build

This repository combines **DeepSeek's frontend design** with **Sonnet's stronger tracker/chat logic**.

- Next.js App Router + React + TypeScript + Tailwind CSS
- DeepSeek's dashboard, chat and individual tracker pages remain the design source of truth.
- Sonnet's deterministic server-side chat interpreter, validation, Drizzle data store, CRUD operations and chat history handlers are adapted behind API routes.
- Demo mode remains the safe default and runs without a database.
- The API adapter maps the server's record model to the DeepSeek UI's domain model.

## Run the demo

```bash
npm install
cp .env.example .env.local
npm run dev
```

The demo is intentionally explicit: it uses the in-memory mock service, not Supabase or an actual AI provider. It is useful for testing UI and interactions. Demo records reset when the app process/page runtime is restarted.

## GitHub Pages deployment

Pushing to `main` triggers the workflow at `.github/workflows/deploy-pages.yml`. It builds a static export for:

`https://blueii24-cmyk.github.io/personal-tracker-merged/`

GitHub Pages only hosts static files, so this deployment runs in **demo mode**. The workflow temporarily excludes `src/app/api` from the build output only; the API source files remain in this repository. Tracker changes are held in browser memory and do not persist after a full reload. The demo chat uses the local deterministic interpreter and does not call an external AI provider.

The GitHub Pages build is not a replacement for the full Next.js server deployment. Use a Node.js host such as Vercel for API routes and database-backed behavior.

## Optional private local database mode

The imported Sonnet-style Drizzle store is a **single shared workspace** and currently has no user authentication or per-user database ownership. Therefore all database API routes are disabled in production builds. Do not expose this mode on a public deployment.

For private development on your own computer only:

1. Create a local PostgreSQL database.
2. Set `DATABASE_URL` in `.env.local`.
3. Set `TRACKER_PRIVATE_SINGLE_USER=true`.
4. Set `NEXT_PUBLIC_BACKEND_MODE=live`.
5. Create the schema with `npm run db:push`.
6. Run `npm run dev`.

If the database is not ready or the guard is disabled, database API routes return an explicit error rather than pretending that writes worked.

**Before public deployment:** implement Supabase Auth (or another real authentication system), per-user database ownership and RLS, session verification in every API route, and migrate the single-workspace schema. Do not switch the guard off as a shortcut.

## AI status

The current chat interpreter is deterministic and rule-based. API key environment variables are placeholders for future provider adapters; the app does not claim to call an external model merely because those variables exist.

## Useful commands

```bash
npm run dev
npm run typecheck
npm run lint
npm run build
npm run db:push       # requires DATABASE_URL
npm run db:generate   # requires DATABASE_URL
```

## What was merged

- Retained DeepSeek's UI components, themes, dashboard composition and frontend tracker store.
- Added a typed API-backed `HttpTrackerService` selected only when `NEXT_PUBLIC_BACKEND_MODE=live`.
- Ported the Sonnet database schema/store and rule-based chat interpreter under separate server domain types to avoid breaking the DeepSeek UI's domain contracts.
- Added `/api/state`, `/api/tracker` and `/api/chat` adapters.
- Added a private-development guard because the inherited backend is not multi-user safe yet.
