## Social Contract App

I built this as a lightweight accountability app: create a contract, invite a friend, and keep each other honest with check‑ins and chat. It’s intentionally simple and fast to run.

### Quick start
- `cd backend`
- `npm install`
- `npm run dev` (API + static frontend on `http://localhost:4000`)

### How it’s set up
- `backend/server.js` – Express API + serves the frontend bundle.
- `backend/db.js` / `backend/data.sqlite` – SQLite schema and local data store.
- `backend/public/` – compiled frontend assets.

### Notes
- PWA bits are disabled in this build to avoid a Workbox error in this environment.
