# Collaborative Canvas

Real-time multi-user drawing board built with React, Tailwind, and Socket.io.

## Setup

1. Install dependencies:
   - `npm install`
2. Run in dev mode (starts server on 3001 and Vite on 5173):
   - `npm run dev`
3. Open the app:
   - http://localhost:5173

### Other scripts
- `npm run server` – start only the Socket.io/Express server
- `npm run client` – start only the Vite dev server
- `npm run build` – bundle client to `dist/` (served by the server when `NODE_ENV=production`)

### Environment
- `VITE_SERVER_URL` (client) – URL of the websocket server, defaults to `http://localhost:3001`
- `CLIENT_ORIGIN` (server) – allowed origin for CORS, defaults to `*`

## How to test multi-user
- Open the app in two browser windows or devices pointing at the same server URL.
- Draw in one window; strokes, cursors, and undo/redo should reflect in the other immediately.

## Features
- Brush/eraser, color palette, stroke width slider
- Live cursor indicators per user with assigned colors
- Real-time stroke streaming (point-level), conflict-free ordering, and global undo/redo
- Responsive canvas with Tailwind UI

## Known limitations
- Canvas state is in-memory only; restart drops history.
- Undo/redo works at stroke granularity, not per-segment.
- No auth; names are ephemeral.
- Latency display is basic; conflict resolution is order-based (last stroke wins at the pixel).


