## Social Contract App

Starter Python/Flask project scaffold. Nothing complex is wired yet so you can build features as you go.

### Quick start
- From the repo root: `cd social_contract_app`
- Create/activate a virtualenv.
- `pip install -r requirements.txt`
- `flask --app app/main run --debug`

### Run on your local network
- Find your LAN IP (macOS: `ipconfig getifaddr en0`, Linux: `hostname -I`, Windows: `ipconfig`).
- Backend: `cd backend && npm install && npm run dev` (binds to all interfaces on port 4000).
- Frontend: `cd frontend && npm install && npm run dev` (binds to all interfaces on port 5173).
- On another device on the same Wi‑Fi, open `http://<your-ip>:5173` for the React app; it will call the API at `http://<your-ip>:4000`.

### Structure
- `app/main.py` – minimal Flask app entrypoint.
- `app/templates/` – add Jinja templates here.
- `app/static/css/` – place your CSS assets here.
- `frontend/` – React (Vite) scaffold with `src/App.jsx`.

Feel free to swap Flask for another stack if you prefer; this is just a lightweight starting point.

### Frontend (React + Vite)
- `cd frontend`
- `npm install`
- `npm run dev` (Vite dev server; LAN-friendly by default)
- `npm run build` to emit `dist/` (you can serve it via Flask static later if you want).

### PWA / Add to Home Screen
- PWA configured via `vite-plugin-pwa` with manifest and icons.
- Build: `npm run build` (or `npm run dev -- --host` to test on LAN).
- Deploy over HTTPS (Netlify/Vercel/etc.). Open on iPhone Safari → Share → “Add to Home Screen”.
- Assets: `frontend/public/icon-192.png`, `frontend/public/icon-512.png`, `frontend/public/favicon.svg` (can replace with your own branding).

### Backend (Express + Socket.io + SQLite)
- `cd backend`
- `npm install`
- `npm run dev` (starts API on port 4000)
- API: create users/contracts, random/friend matching, chat, check-ins; websocket via Socket.io.
