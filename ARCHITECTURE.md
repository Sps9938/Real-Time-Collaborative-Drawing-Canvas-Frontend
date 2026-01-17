# Architecture

## Data Flow
```
[Pointer/Touch]
     ↓
[CanvasBoard] --(stroke:start/points/end)--> Socket.io client
     ↓                                                ↓
 local draw (prediction)                         WebSocket
                                                    ↓
                                      Socket.io server (room state)
                                                    ↓
                              broadcast stroke/cursor/undo/redo
                                                    ↓
                                        other clients redraw
```
- Strokes stream as normalized points; each client rescales to its canvas for consistent geometry.
- Server keeps the authoritative ordered stroke list; clients render incrementally and replay on undo/redo or resize.

## WebSocket Protocol
- `join { name }` → server assigns id/color, replies `init { user, users, strokes }`.
- `stroke:start { strokeId, tool, color, size }` → broadcast `stroke:start`.
- `stroke:points { strokeId, points[] }` → broadcast `stroke:points` (points are normalized `{x,y}` in [0,1]).
- `stroke:end { strokeId }` → server commits stroke, broadcasts `stroke:commit { stroke }`.
- `undo` → server removes last stroke, broadcasts `stroke:undo { strokeId }`.
- `redo` → server reapplies, broadcasts `stroke:redo { stroke }`.
- `cursor:move { x, y }` → broadcast `cursor { userId, name, color, x, y }`.
- `user:joined` / `user:left` maintain presence list.

## Undo/Redo Strategy
- Server holds a global stack of committed strokes plus an undone stack.
- New stroke commits clear the redo stack.
- Undo pops the latest committed stroke regardless of author and broadcasts removal; redo pushes the last undone stroke back.
- Clients replay the authoritative stroke list when undo/redo fires to keep canvases identical.

## Performance Decisions
- Normalize points before transport to avoid per-device pixel drift; redraw scales to current canvas size.
- Device-pixel-ratio aware canvas sizing for crisp strokes without overdraw beyond 2x.
- Incremental drawing during pointer move for immediacy; full replay only on undo/redo or resize.
- Lightweight data model (stroke array) avoids heavy diffing; no external drawing libs.

## Conflict Resolution
- Strokes are ordered by server-side sequence; later strokes render atop earlier ones (last-writer-wins at pixel level).
- Eraser strokes use canvas `destination-out`, affecting underlying strokes consistently for all clients.
- Cursor updates are fire-and-forget; if dropped, the next update refreshes position.
