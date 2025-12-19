## Social Contract App

Everything now runs from a single Node/Express backend that also serves the prebuilt UI.

### Quick start
- `cd backend`
- `npm install`
- `npm run dev` (starts API + static frontend on `http://localhost:4000`)

### Structure
- `backend/server.js` – Express API (auth, contracts, chat, check-ins) plus static file hosting.
- `backend/db.js` / `backend/data.sqlite` – SQLite schema and data.
- `backend/public/` – compiled frontend assets that the server serves at `/`.

### Notes
- The PWA plugin was disabled during the static build to avoid a failing Workbox step in this environment; the main app features remain intact.
