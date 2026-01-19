import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'

const clamp01 = n => Math.min(1, Math.max(0, n))

const toCanvasPoint = (evt, rect) => ({
  x: clamp01((evt.clientX - rect.left) / rect.width),
  y: clamp01((evt.clientY - rect.top) / rect.height)
})

const scalePoint = (pt, dims) => ({ x: pt.x * dims.width, y: pt.y * dims.height })

const drawLine = (ctx, stroke, from, to) => {
  if (!from || !to) return
  ctx.save()
  if (stroke.tool === 'eraser') {
    const dash = Math.max(10, stroke.size * 1.1)
    const gap = Math.max(6, stroke.size * 0.7)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.setLineDash([dash, gap])
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  } else {
    ctx.setLineDash([])
    ctx.shadowColor = 'transparent'
    ctx.shadowBlur = 0
    ctx.strokeStyle = stroke.color
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const width = stroke.tool === 'eraser' ? stroke.size * 1.6 : Math.max(6, stroke.size)
  ctx.lineWidth = width
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.stroke()
  ctx.restore()
}

const replayStrokes = (ctx, strokes, dims) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  strokes
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .forEach(stroke => {
      for (let i = 1; i < stroke.points.length; i += 1) {
        const from = scalePoint(stroke.points[i - 1], dims)
        const to = scalePoint(stroke.points[i], dims)
        drawLine(ctx, stroke, from, to)
      }
    })
}

const CanvasBoard = forwardRef(function CanvasBoard({ socket, user, tool, color, size, theme, onHistoryChange }, ref) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const dimsRef = useRef({ width: 0, height: 0 })
  const strokesRef = useRef([])
  const undoneRef = useRef([])
  const liveRef = useRef(new Map())
  const cursorRef = useRef(new Map())
  const [cursors, setCursors] = useState([])
  const [ready, setReady] = useState(false)
  const [metrics, setMetrics] = useState({ fps: 0, latency: null })

  const dpr = useMemo(() => Math.min(window.devicePixelRatio || 1, 2), [])

  const cursorStyle = useMemo(() => {
    if (tool !== 'eraser') return 'crosshair'
    const r = Math.max(6, Math.min(size * 1.1, 28))
    const stroke = theme === 'light' ? '#0f172a' : '#ffffff'
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${r * 2}" height="${r * 2}" viewBox="0 0 ${r * 2} ${r * 2}"><circle cx="${r}" cy="${r}" r="${r - 2}" fill="none" stroke="${stroke}" stroke-width="2"/></svg>`
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${r} ${r}, crosshair`
  }, [tool, size, theme])

  const updateHistoryState = currentTool => {
    const t = currentTool ?? tool
    const canUndo = strokesRef.current.some(s => s.tool === t)
    const canRedo = undoneRef.current.some(s => s.tool === t)
    onHistoryChange?.({ canUndo, canRedo })
  }

  useImperativeHandle(ref, () => ({
    exportSession: () => ({
      strokes: strokesRef.current.map(stroke => ({
        ...stroke,
        points: stroke.points.map(p => ({ ...p }))
      }))
    }),
    importSession: payload => {
      if (!payload?.strokes || !ctxRef.current) return
      strokesRef.current = payload.strokes.map(stroke => ({
        ...stroke,
        points: stroke.points.map(p => ({ ...p }))
      }))
      undoneRef.current = []
      replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current)
      updateHistoryState()
    }
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    dimsRef.current = { width: rect.width, height: rect.height }
    const ctx = canvas.getContext('2d')
    ctxRef.current = ctx
    ctx.scale(dpr, dpr)
  }, [dpr])

  useEffect(() => {
    let frameId
    let frames = 0
    let last = performance.now()

    const tick = () => {
      const now = performance.now()
      frames += 1
      if (now - last >= 1000) {
        const fps = Math.round((frames * 1000) / (now - last))
        setMetrics(prev => ({ ...prev, fps }))
        frames = 0
        last = now
      }
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frameId)
  }, [])

  useEffect(() => {
    if (!socket) return
    const handlePong = payload => {
      if (!payload?.ts) return
      const rtt = Math.round(performance.now() - payload.ts)
      setMetrics(prev => ({ ...prev, latency: rtt }))
    }

    const timer = setInterval(() => {
      socket.emit('ping', { ts: performance.now() })
    }, 2000)

    socket.on('pong', handlePong)
    return () => {
      clearInterval(timer)
      socket.off('pong', handlePong)
    }
  }, [socket])

  useEffect(() => {
    if (!socket) return
    const handleInit = payload => {
      if (dimsRef.current.width === 0 && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect()
        dimsRef.current = { width: rect.width, height: rect.height }
      }
      strokesRef.current = payload.strokes || []
      undoneRef.current = []
      updateHistoryState()
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current)
      }
      setReady(true)
    }

    const handleStrokeStart = stroke => {
      if (!ctxRef.current) return
      liveRef.current.set(stroke.id, { ...stroke, points: [] })
    }

    const handleStrokePoints = payload => {
      const ctx = ctxRef.current
      if (!ctx) return
      const live = liveRef.current.get(payload.strokeId)
      if (!live) return
      const pts = payload.points || []
      pts.forEach(pt => {
        const last = live.points[live.points.length - 1]
        const from = last ? scalePoint(last, dimsRef.current) : null
        const point = { x: pt.x, y: pt.y }
        const scaled = scalePoint(point, dimsRef.current)
        drawLine(ctx, live, from, scaled)
        live.points.push(point)
      })
    }

    const handleStrokeCommit = stroke => {
      liveRef.current.delete(stroke.id)
      strokesRef.current.push(stroke)
      undoneRef.current = []
      updateHistoryState()
    }

    const handleUndo = payload => {
      const idx = strokesRef.current.findIndex(s => s.id === payload.strokeId)
      if (idx === -1) return
      const [removed] = strokesRef.current.splice(idx, 1)
      undoneRef.current.push(removed)
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current)
      }
      updateHistoryState()
    }

    const handleRedo = stroke => {
      strokesRef.current.push(stroke)
      undoneRef.current = undoneRef.current.filter(s => s.id !== stroke.id)
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current)
      }
      updateHistoryState()
    }

    const handleCursor = payload => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      cursorRef.current.set(payload.userId, {
        userId: payload.userId,
        name: payload.name,
        color: payload.color,
        x: clamp01(payload.x) * rect.width,
        y: clamp01(payload.y) * rect.height
      })
      setCursors(Array.from(cursorRef.current.values()))
    }

    socket.on('init', handleInit)
    socket.on('stroke:start', handleStrokeStart)
    socket.on('stroke:points', handleStrokePoints)
    socket.on('stroke:commit', handleStrokeCommit)
    socket.on('stroke:undo', handleUndo)
    socket.on('stroke:redo', handleRedo)
    socket.on('cursor', handleCursor)

    return () => {
      socket.off('init', handleInit)
      socket.off('stroke:start', handleStrokeStart)
      socket.off('stroke:points', handleStrokePoints)
      socket.off('stroke:commit', handleStrokeCommit)
      socket.off('stroke:undo', handleUndo)
      socket.off('stroke:redo', handleRedo)
      socket.off('cursor', handleCursor)
    }
  }, [socket, dpr, onHistoryChange])

  useEffect(() => {
    if (!socket || !ctxRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    let drawing = false
    let stroke

    const rect = () => canvas.getBoundingClientRect()

    const handlePointerDown = evt => {
      if (!user) return
      drawing = true
      canvas.setPointerCapture(evt.pointerId)
      const point = toCanvasPoint(evt, rect())
      stroke = {
        id: uuid(),
        userId: user.id,
        tool,
        color,
        size,
        points: [point]
      }
      socket.emit('stroke:start', { strokeId: stroke.id, tool, color, size })
    }

    const handlePointerMove = evt => {
      const bounds = rect()
      const nx = clamp01((evt.clientX - bounds.left) / bounds.width)
      const ny = clamp01((evt.clientY - bounds.top) / bounds.height)
      socket.emit('cursor:move', { x: nx, y: ny })
      if (!drawing || !stroke) return
      const point = toCanvasPoint(evt, bounds)
      const last = stroke.points[stroke.points.length - 1]
      const from = last ? scalePoint(last, dimsRef.current) : null
      const scaled = scalePoint(point, dimsRef.current)
      drawLine(ctxRef.current, stroke, from, scaled)
      stroke.points.push(point)
      socket.emit('stroke:points', { strokeId: stroke.id, points: [point] })
    }

    const endStroke = () => {
      if (!drawing || !stroke) return
      drawing = false
      socket.emit('stroke:end', { strokeId: stroke.id })
      liveRef.current.set(stroke.id, { ...stroke })
      stroke = null
    }

    canvas.addEventListener('pointerdown', handlePointerDown)
    canvas.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', endStroke)
    canvas.addEventListener('pointerleave', endStroke)

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', endStroke)
      canvas.removeEventListener('pointerleave', endStroke)
    }
  }, [socket, user, tool, color, size, dpr])

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current
      if (!canvas || !ctxRef.current) return
      const bounds = canvas.getBoundingClientRect()
      canvas.width = bounds.width * dpr
      canvas.height = bounds.height * dpr
      dimsRef.current = { width: bounds.width, height: bounds.height }
      const ctx = canvas.getContext('2d')
      ctxRef.current = ctx
      ctx.scale(dpr, dpr)
      replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [dpr])

  return (
    <div className="canvas-shell relative h-full w-full rounded-2xl shadow-card">
      <div className="metrics-chip">
        <span>FPS {metrics.fps}</span>
        <span>RTT {metrics.latency ?? '—'}ms</span>
      </div>
      <canvas ref={canvasRef} className="canvas-surface h-full w-full rounded-2xl" style={{ cursor: cursorStyle }} />
      <div className="pointer-events-none absolute inset-0">
        {cursors
          .filter(c => c.userId !== user?.id)
          .map(cursor => (
            <div
              key={cursor.userId}
              className="cursor-chip text-xs"
              style={{ left: `${cursor.x}px`, top: `${cursor.y}px` }}
            >
              <span className="dot" style={{ background: cursor.color }}></span>
              <span>{cursor.name}</span>
            </div>
          ))}
      </div>
      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-muted">
          Connecting...
        </div>
      )}
    </div>
  )
})

export default CanvasBoard
