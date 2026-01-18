import React, { useEffect, useMemo, useState } from 'react'
import { io } from 'socket.io-client'
import CanvasBoard from './components/CanvasBoard.jsx'

const palette = ['#06b6d4', '#f472b6', '#a78bfa', '#22d3ee', '#f97316', '#10b981', '#ef4444', '#eab308']

const randomHandle = () => {
  const adjectives = ['bold', 'calm', 'loud', 'bright', 'swift', 'steady', 'lucky', 'brisk']
  const animals = ['orca', 'lynx', 'otter', 'falcon', 'sparrow', 'tiger', 'ibis', 'yak']
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)]
  const animal = animals[Math.floor(Math.random() * animals.length)]
  return `${adj}-${animal}-${Math.floor(Math.random() * 90 + 10)}`
}

export default function App() {
  const [socket, setSocket] = useState(null)
  const [user, setUser] = useState(null)
  const [users, setUsers] = useState([])
  const [tool, setTool] = useState('pen')
  const [color, setColor] = useState(palette[0])
  const [size, setSize] = useState(6)
  const [history, setHistory] = useState({ canUndo: false, canRedo: false })
  const [connected, setConnected] = useState(false)
  const [handle] = useState(randomHandle())
  const [theme, setTheme] = useState(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('rtc-canvas-theme') : null
    if (stored === 'light' || stored === 'dark') return stored
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
    return 'dark'
  })

  const serverUrl = useMemo(() => import.meta.env.VITE_SERVER_URL || 'http://localhost:3001', [])

  useEffect(() => {
    const s = io(serverUrl, { transports: ['websocket'] })
    setSocket(s)

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => setConnected(false))

    s.on('init', payload => {
      setUser(payload.user)
      setUsers(payload.users || [])
      if (payload.user?.color) {
        setColor(payload.user.color)
      }
    })

    s.on('user:joined', joined => {
      setUsers(prev => {
        const next = prev.filter(u => u.id !== joined.id)
        return [...next, joined]
      })
    })

    s.on('user:left', payload => {
      setUsers(prev => prev.filter(u => u.id !== payload.userId))
    })

    s.emit('join', { name: handle })

    return () => s.disconnect()
  }, [serverUrl, handle])

  useEffect(() => {
    document.body.dataset.theme = theme
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('rtc-canvas-theme', theme)
    }
  }, [theme])

  const doUndo = () => socket?.emit('undo')
  const doRedo = () => socket?.emit('redo')

  const toggleTheme = () => setTheme(prev => (prev === 'dark' ? 'light' : 'dark'))

  return (
    <div className="app-shell min-h-screen">
      <div className="flex min-h-screen flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="glass-panel h-max w-full rounded-2xl p-4 shadow-card md:w-80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span className="h-3 w-3 rounded-full bg-accent shadow-[0_0_12px_rgba(34,211,238,0.55)]" />
              <span>Collaborative Canvas</span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-xs ${connected ? 'badge-live' : 'badge-off'}`}>
                {connected ? 'live' : 'offline'}
              </span>
              <button className="surface-button theme-toggle rounded-full px-3 py-1 text-xs font-medium" onClick={toggleTheme}>
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            <section className="section rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-muted">
                <span>Tools</span>
                <span className="text-xs text-muted">{tool}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  className={`surface-button rounded-lg px-3 py-2 text-sm transition ${tool === 'pen' ? 'surface-button--active' : ''}`}
                  onClick={() => setTool('pen')}
                >
                  Brush
                </button>
                <button
                  className={`surface-button rounded-lg px-3 py-2 text-sm transition ${tool === 'eraser' ? 'surface-button--active' : ''}`}
                  onClick={() => setTool('eraser')}
                >
                  Eraser
                </button>
              </div>
            </section>

            <section className="section rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-muted">
                <span>Color</span>
                <span className="text-xs text-muted">{color}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {palette.map(hex => (
                  <button
                    key={hex}
                    className={`color-swatch h-10 rounded-lg border transition ${color === hex ? 'color-swatch--active' : ''}`}
                    style={{ background: hex }}
                    onClick={() => setColor(hex)}
                    aria-label={`Select ${hex}`}
                  />
                ))}
              </div>
            </section>

            <section className="section rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-muted">
                <span>Stroke</span>
                <span className="text-xs text-muted">{size}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="32"
                value={size}
                onChange={e => setSize(Number(e.target.value))}
                className="w-full"
              />
            </section>

            <section className="section grid grid-cols-2 gap-3 rounded-xl p-4">
              <button
                className={`surface-button rounded-lg px-3 py-2 text-sm transition ${history.canUndo ? 'hoverable' : 'surface-button--disabled'}`}
                onClick={doUndo}
                disabled={!history.canUndo}
              >
                Undo
              </button>
              <button
                className={`surface-button rounded-lg px-3 py-2 text-sm transition ${history.canRedo ? 'hoverable' : 'surface-button--disabled'}`}
                onClick={doRedo}
                disabled={!history.canRedo}
              >
                Redo
              </button>
            </section>

            <section className="section rounded-xl p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-muted">
                <span>Online ({users.length})</span>
                <span className="text-xs text-muted">you as {handle}</span>
              </div>
              <div className="scroll-thin grid max-h-32 grid-cols-1 gap-2 overflow-y-auto">
                {users.map(u => (
                  <div key={u.id} className="user-chip flex items-center justify-between rounded-lg px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color }}></span>
                      <span>{u.name}</span>
                    </div>
                    <span className="text-xs text-muted">{u.id === user?.id ? 'you' : 'live'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>

        <main className="flex-1">
          <CanvasBoard socket={socket} user={user} tool={tool} color={color} size={size} theme={theme} onHistoryChange={setHistory} />
        </main>
      </div>
    </div>
  )
}
