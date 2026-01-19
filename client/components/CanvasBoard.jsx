import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { v4 as uuid } from 'uuid'

const clamp01 = n => Math.min(1, Math.max(0, n))

const toCanvasPoint = (evt, rect) => ({
  x: clamp01((evt.clientX - rect.left) / rect.width),
  y: clamp01((evt.clientY - rect.top) / rect.height)
})

const scalePoint = (pt, dims) => ({ x: pt.x * dims.width, y: pt.y * dims.height })

const drawLine = (ctx, stroke, from, to, imageCache) => {
  if (!from) return
  const target = to || from
  ctx.save()

  const isShape = stroke.tool === 'rect' || stroke.tool === 'ellipse' || stroke.tool === 'line'
  const isText = stroke.tool === 'text'
  const isImage = stroke.tool === 'image'

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
    ctx.fillStyle = stroke.color
  }
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  const width = stroke.tool === 'eraser' ? stroke.size * 1.6 : Math.max(6, stroke.size)
  ctx.lineWidth = width

  if (isText) {
    const fontSize = Math.max(14, stroke.size * 4)
    ctx.font = `${fontSize}px "Inter", system-ui, sans-serif`
    ctx.textBaseline = 'top'
    ctx.fillText(stroke.text || '', target.x, target.y)
    ctx.restore()
    return
  }

  if (isImage) {
    const src = stroke.src
    const w = stroke.width || 180
    const h = stroke.height || 180
    if (!src) {
      ctx.restore()
      return
    }
    const drawImg = img => {
      ctx.drawImage(img, target.x, target.y, w, h)
    }
    const cached = imageCache.get(src)
    if (cached && cached.complete) {
      drawImg(cached)
      ctx.restore()
      return
    }
    const img = cached || new Image()
    img.onload = () => {
      imageCache.set(src, img)
      drawImg(img)
    }
    if (!cached) {
      img.src = src
      imageCache.set(src, img)
    }
    ctx.restore()
    return
  }

  if (isShape) {
    const x = Math.min(from.x, target.x)
    const y = Math.min(from.y, target.y)
    const w = Math.abs(target.x - from.x)
    const h = Math.abs(target.y - from.y)
    ctx.beginPath()
    if (stroke.tool === 'rect') {
      ctx.rect(x, y, w, h)
    } else if (stroke.tool === 'ellipse') {
      const rx = w / 2
      const ry = h / 2
      ctx.ellipse(x + rx, y + ry, rx, ry, 0, 0, Math.PI * 2)
    } else {
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(target.x, target.y)
    }
    ctx.stroke()
    ctx.restore()
    return
  }

  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(target.x, target.y)
  ctx.stroke()
  ctx.restore()
}

const replayStrokes = (ctx, strokes, dims, imageCache) => {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  strokes
    .slice()
    .sort((a, b) => a.seq - b.seq)
    .forEach(stroke => {
      const pts = stroke.points || []
      if (pts.length === 1) {
        const p = scalePoint(pts[0], dims)
        drawLine(ctx, stroke, p, p, imageCache)
        return
      }
      for (let i = 1; i < pts.length; i += 1) {
        const from = scalePoint(pts[i - 1], dims)
        const to = scalePoint(pts[i], dims)
        drawLine(ctx, stroke, from, to, imageCache)
      }
    })
}

const CanvasBoard = forwardRef(function CanvasBoard(
  { socket, user, tool, color, size, theme, imageSrc, onHistoryChange },
  ref
) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const dimsRef = useRef({ width: 0, height: 0 })
  const strokesRef = useRef([])
  const undoneRef = useRef([])
  const liveRef = useRef(new Map())
  const cursorRef = useRef(new Map())
  const imageCacheRef = useRef(new Map())
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

  const updateHistoryState = () => {
    const canUndo = strokesRef.current.length > 0
    const canRedo = undoneRef.current.length > 0
    onHistoryChange?.({ canUndo, canRedo })
  }

  const clearLocal = () => {
    strokesRef.current = []
    undoneRef.current = []
    liveRef.current.clear()
    cursorRef.current.clear()
    setCursors([])
    if (ctxRef.current) {
      ctxRef.current.clearRect(0, 0, ctxRef.current.canvas.width, ctxRef.current.canvas.height)
    }
    updateHistoryState()
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
      replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
      updateHistoryState()
    },
    clearCanvas: clearLocal
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
      const incoming = Array.isArray(payload.strokes) ? payload.strokes : []
      strokesRef.current = incoming
      undoneRef.current = []
      updateHistoryState()
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
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
        const point = { x: pt.x, y: pt.y }
        const isStream = live.tool === 'pen' || live.tool === 'eraser'
        const isShape = live.tool === 'line' || live.tool === 'rect' || live.tool === 'ellipse'
        const isSingle = live.tool === 'image' || live.tool === 'text'

        if (isStream) {
          const scaled = scalePoint(point, dimsRef.current)
          if (last) {
            const from = scalePoint(last, dimsRef.current)
            drawLine(ctx, live, from, scaled, imageCacheRef.current)
          }
          live.points.push(point)
          return
        }

        if (isShape) {
          const start = live.points[0] || point
          live.points = [start, point]
          const preview = [...strokesRef.current, live]
          replayStrokes(ctx, preview, dimsRef.current, imageCacheRef.current)
          return
        }

        if (isSingle) {
          live.points = [point]
          const preview = [...strokesRef.current, live]
          replayStrokes(ctx, preview, dimsRef.current, imageCacheRef.current)
          return
        }
      })
    }

    const handleStrokeCommit = stroke => {
      liveRef.current.delete(stroke.id)
      // Avoid duplicates if the stroke already exists (should not, but guard for latency)
      const exists = strokesRef.current.some(s => s.id === stroke.id)
      if (!exists) {
        strokesRef.current.push(stroke)
      }
      undoneRef.current = []
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
      }
      updateHistoryState()
    }

    const handleUndo = payload => {
      const idx = strokesRef.current.findIndex(s => s.id === payload.strokeId)
      if (idx === -1) return
      const [removed] = strokesRef.current.splice(idx, 1)
      undoneRef.current.push(removed)
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
      }
      updateHistoryState()
    }

    const handleRedo = stroke => {
      strokesRef.current.push(stroke)
      undoneRef.current = undoneRef.current.filter(s => s.id !== stroke.id)
      if (ctxRef.current) {
        replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
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

    const handleClear = () => {
      clearLocal()
    }

    socket.on('init', handleInit)
    socket.on('stroke:start', handleStrokeStart)
    socket.on('stroke:points', handleStrokePoints)
    socket.on('stroke:commit', handleStrokeCommit)
    socket.on('stroke:undo', handleUndo)
    socket.on('stroke:redo', handleRedo)
    socket.on('cursor', handleCursor)
    socket.on('clear', handleClear)

    return () => {
      socket.off('init', handleInit)
      socket.off('stroke:start', handleStrokeStart)
      socket.off('stroke:points', handleStrokePoints)
      socket.off('stroke:commit', handleStrokeCommit)
      socket.off('stroke:undo', handleUndo)
      socket.off('stroke:redo', handleRedo)
      socket.off('cursor', handleCursor)
      socket.off('clear', handleClear)
    }
  }, [socket, dpr, onHistoryChange])

  useEffect(() => {
    if (!socket || !ctxRef.current) return
    const canvas = canvasRef.current
    if (!canvas) return
    let drawing = false
    let stroke

    const rect = () => canvas.getBoundingClientRect()
    const isShapeTool = tool === 'line' || tool === 'rect' || tool === 'ellipse'
    const isTextTool = tool === 'text'
    const isImageTool = tool === 'image'

    const handlePointerDown = evt => {
      if (!user) return
      const bounds = rect()
      const point = toCanvasPoint(evt, bounds)

      if (isTextTool) {
        const content = window.prompt('Enter text')
        if (!content || !content.trim()) return
        const text = content.trim()
        const id = uuid()
        socket.emit('stroke:start', { strokeId: id, tool: 'text', color, size, text })
        socket.emit('stroke:points', { strokeId: id, points: [point] })
        socket.emit('stroke:end', { strokeId: id })
        return
      }

      if (isImageTool) {
        if (!imageSrc?.src) return
        drawing = true
        canvas.setPointerCapture(evt.pointerId)
        stroke = {
          id: uuid(),
          userId: user.id,
          tool: 'image',
          color,
          size,
          src: imageSrc.src,
          width: imageSrc.width,
          height: imageSrc.height,
          points: [point]
        }
        socket.emit('stroke:start', {
          strokeId: stroke.id,
          tool: stroke.tool,
          color,
          size,
          src: stroke.src,
          width: stroke.width,
          height: stroke.height
        })
        socket.emit('stroke:points', { strokeId: stroke.id, points: [point] })
        return
      }

      drawing = true
      canvas.setPointerCapture(evt.pointerId)
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

      if (isShapeTool) {
        stroke.points[1] = point
        const preview = [...strokesRef.current, stroke]
        replayStrokes(ctxRef.current, preview, dimsRef.current, imageCacheRef.current)
        socket.emit('stroke:points', { strokeId: stroke.id, points: [point] })
        return
      }

      if (isImageTool) {
        stroke.points = [point]
        const preview = [...strokesRef.current, stroke]
        replayStrokes(ctxRef.current, preview, dimsRef.current, imageCacheRef.current)
        socket.emit('stroke:points', { strokeId: stroke.id, points: [point] })
        return
      }

      const last = stroke.points[stroke.points.length - 1]
      const from = last ? scalePoint(last, dimsRef.current) : null
      const scaled = scalePoint(point, dimsRef.current)
      drawLine(ctxRef.current, stroke, from, scaled, imageCacheRef.current)
      stroke.points.push(point)
      socket.emit('stroke:points', { strokeId: stroke.id, points: [point] })
    }

    const endStroke = () => {
      if (!drawing || !stroke) return
      drawing = false
      if (isShapeTool && stroke.points.length < 2) {
        stroke = null
        return
      }
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
  }, [socket, user, tool, color, size, dpr, imageSrc])

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
      replayStrokes(ctxRef.current, strokesRef.current, dimsRef.current, imageCacheRef.current)
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
