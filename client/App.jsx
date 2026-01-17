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

  const doUndo = () => socket?.emit('undo')
  const doRedo = () => socket?.emit('redo')

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="flex min-h-screen flex-col gap-6 px-4 py-6 md:flex-row">
        <aside className="glass-panel h-max w-full rounded-2xl p-4 shadow-card md:w-80">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-lg font-semibold">
              <span className="h-3 w-3 rounded-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
              <span>Collaborative Canvas</span>
            </div>
            <span className={`text-xs ${connected ? 'text-emerald-400' : 'text-amber-400'}`}>
              {connected ? 'live' : 'offline'}
            </span>
          </div>

          <div className="mt-6 space-y-4">
            <section className="rounded-xl border border-white/5 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-slate-400">
                <span>Tools</span>
                <span className="text-xs text-slate-500">{tool}</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  className={`rounded-lg border border-white/10 px-3 py-2 text-sm transition ${
                    tool === 'pen' ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' : 'bg-slate-900/70'
                  }`}
                  onClick={() => setTool('pen')}
                >
                  Brush
                </button>
                <button
                  className={`rounded-lg border border-white/10 px-3 py-2 text-sm transition ${
                    tool === 'eraser' ? 'bg-cyan-500/20 text-cyan-200 border-cyan-400/40' : 'bg-slate-900/70'
                  }`}
                  onClick={() => setTool('eraser')}
                >
                  Eraser
                </button>
              </div>
            </section>

            <section className="rounded-xl border border-white/5 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-slate-400">
                <span>Color</span>
                <span className="text-xs text-slate-500">{color}</span>
              </div>
              <div className="grid grid-cols-4 gap-2">
                {palette.map(hex => (
                  <button
                    key={hex}
                    className={`h-10 rounded-lg border border-white/10 transition ${
                      color === hex ? 'ring-2 ring-cyan-300 ring-offset-2 ring-offset-slate-900' : ''
                    }`}
                    style={{ background: hex }}
                    onClick={() => setColor(hex)}
                  />
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-white/5 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-slate-400">
                <span>Stroke</span>
                <span className="text-xs text-slate-500">{size}px</span>
              </div>
              <input
                type="range"
                min="2"
                max="32"
                value={size}
                onChange={e => setSize(Number(e.target.value))}
                className="w-full accent-cyan-400"
              />
            </section>

            <section className="grid grid-cols-2 gap-3 rounded-xl border border-white/5 bg-white/5 p-4">
              <button
                className={`rounded-lg border border-white/10 px-3 py-2 text-sm transition ${
                  history.canUndo ? 'bg-slate-900/70 hover:border-cyan-300/50 hover:text-cyan-100' : 'opacity-40'
                }`}
                onClick={doUndo}
                disabled={!history.canUndo}
              >
                Undo
              </button>
              <button
                className={`rounded-lg border border-white/10 px-3 py-2 text-sm transition ${
                  history.canRedo ? 'bg-slate-900/70 hover:border-cyan-300/50 hover:text-cyan-100' : 'opacity-40'
                }`}
                onClick={doRedo}
                disabled={!history.canRedo}
              >
                Redo
              </button>
            </section>

            <section className="rounded-xl border border-white/5 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between text-sm uppercase tracking-wide text-slate-400">
                <span>Online ({users.length})</span>
                <span className="text-xs text-slate-500">you as {handle}</span>
              </div>
              <div className="scroll-thin grid max-h-32 grid-cols-1 gap-2 overflow-y-auto">
                {users.map(u => (
                  <div key={u.id} className="flex items-center justify-between rounded-lg bg-slate-900/60 px-3 py-2 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: u.color }}></span>
                      <span className="text-slate-200">{u.name}</span>
                    </div>
                    <span className="text-xs text-slate-500">{u.id === user?.id ? 'you' : 'live'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </aside>

        <main className="flex-1">
          <CanvasBoard socket={socket} user={user} tool={tool} color={color} size={size} onHistoryChange={setHistory} />
        </main>
      </div>
    </div>
  )
}
