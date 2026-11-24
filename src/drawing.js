const PAPER = '#ffffff'

function adjustedColor(hex, brightness) {
  const channels = hex.slice(1).match(/.{2}/g).map(value => parseInt(value, 16))
  const ratio = brightness / 100
  return `rgb(${channels.map(value => Math.round(ratio <= 1 ? value * ratio : value + (255 - value) * (ratio - 1))).join(', ')})`
}

export function createDrawingBoard(root, { onChange = () => {} } = {}) {
  const $ = id => root.querySelector(`#${id}`)
  const canvas = $('drawing-canvas')
  const context = canvas.getContext('2d')
  if (!context) return null
  // 고정 해상도의 그림과 화면 표시 크기를 분리해 창 크기가 바뀌어도 그림을 유지합니다.
  const base = document.createElement('canvas')
  const layer = document.createElement('canvas')
  for (const surface of [base, layer]) {
    surface.width = canvas.width
    surface.height = canvas.height
  }
  const baseContext = base.getContext('2d')
  const layerContext = layer.getContext('2d')
  if (!baseContext || !layerContext) return null
  const history = []
  const future = []
  let current = null
  let pointerId = null
  let tool = 'pen'
  let locked = false

  function whiteBackground(target) {
    target.clearRect(0, 0, canvas.width, canvas.height)
    target.fillStyle = PAPER
    target.fillRect(0, 0, canvas.width, canvas.height)
  }

  // 한 획 전체를 별도 레이어에 그린 뒤 합성하여 낮은 불투명도에서도 이음새가 진해지지 않습니다.
  function paintStroke(target, stroke) {
    if (stroke.kind === 'clear') {
      whiteBackground(target)
      return
    }
    layerContext.clearRect(0, 0, canvas.width, canvas.height)
    layerContext.strokeStyle = stroke.color
    layerContext.fillStyle = stroke.color
    layerContext.lineWidth = stroke.size
    layerContext.lineCap = 'round'
    layerContext.lineJoin = 'round'
    layerContext.beginPath()
    const [first, ...rest] = stroke.points
    if (!rest.length) {
      layerContext.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2)
      layerContext.fill()
    } else {
      layerContext.moveTo(first.x, first.y)
      for (const point of rest) layerContext.lineTo(point.x, point.y)
      layerContext.stroke()
    }
    target.save()
    target.globalAlpha = stroke.opacity
    target.drawImage(layer, 0, 0)
    target.restore()
  }

  function showCanvas() {
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(base, 0, 0)
    if (current) paintStroke(context, current)
  }

  function rebuild() {
    whiteBackground(baseContext)
    for (const stroke of history) paintStroke(baseContext, stroke)
    showCanvas()
  }

  function hasDrawing() {
    for (let i = history.length - 1; i >= 0; i -= 1) {
      if (history[i].kind === 'clear') return false
      if (history[i].kind === 'pen') return true
    }
    return false
  }

  function updateControls() {
    $('undo-drawing').disabled = Boolean(current) || !history.length
    $('redo-drawing').disabled = Boolean(current) || !future.length
    $('clear-drawing').disabled = Boolean(current) || !hasDrawing()
    onChange(hasDrawing() && !current)
  }

  function position(event) {
    const box = canvas.getBoundingClientRect()
    return {
      x: Math.max(0, Math.min(canvas.width, (event.clientX - box.left) * canvas.width / box.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - box.top) * canvas.height / box.height)),
    }
  }

  function finishStroke() {
    if (!current) return
    paintStroke(baseContext, current)
    history.push(current)
    future.length = 0
    current = null
    const oldPointer = pointerId
    pointerId = null
    if (canvas.hasPointerCapture(oldPointer)) canvas.releasePointerCapture(oldPointer)
    showCanvas()
    updateControls()
  }

  canvas.addEventListener('pointerdown', event => {
    if (locked || pointerId !== null || !event.isPrimary || event.button !== 0) return
    event.preventDefault()
    pointerId = event.pointerId
    canvas.setPointerCapture(pointerId)
    current = {
      kind: tool,
      color: tool === 'eraser' ? PAPER : adjustedColor(root.querySelector('input[name="pen-color"]:checked').value, Number($('brush-brightness').value)),
      opacity: tool === 'eraser' ? 1 : Number($('brush-opacity').value) / 100,
      size: Number($('brush-size').value),
      points: [position(event)],
    }
    $('clear-confirmation').hidden = true
    showCanvas()
    updateControls()
  })

  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== pointerId || !current) return
    event.preventDefault()
    const samples = event.getCoalescedEvents?.() ?? []
    for (const sample of samples.length ? samples : [event]) current.points.push(position(sample))
    showCanvas()
  })
  canvas.addEventListener('pointerup', event => {
    if (event.pointerId !== pointerId || !current) return
    const last = current.points.at(-1)
    const end = position(event)
    if (last.x !== end.x || last.y !== end.y) current.points.push(end)
    finishStroke()
  })
  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId !== pointerId) return
    current = null
    pointerId = null
    showCanvas()
    updateControls()
  })
  canvas.addEventListener('lostpointercapture', () => finishStroke())

  for (const selectedTool of ['pen', 'eraser']) {
    $(`${selectedTool}-tool`).addEventListener('click', () => {
      finishStroke()
      tool = selectedTool
      $('pen-tool').setAttribute('aria-pressed', String(tool === 'pen'))
      $('eraser-tool').setAttribute('aria-pressed', String(tool === 'eraser'))
      for (const id of ['color-palette', 'brush-brightness', 'brush-opacity']) $(id).disabled = tool === 'eraser'
      $('tool-hint').textContent = tool === 'eraser' ? '지우개는 선택한 크기로 하얗게 지워요.' : '고른 색상에 명도와 불투명도를 적용해요.'
      canvas.classList.toggle('is-erasing', tool === 'eraser')
    })
  }
  for (const [input, output, unit] of [['brush-brightness', 'brightness-value', '%'], ['brush-opacity', 'opacity-value', '%'], ['brush-size', 'size-value', 'px']]) {
    $(input).addEventListener('input', () => { $(output).value = `${$(input).value}${unit}` })
  }
  $('undo-drawing').addEventListener('click', () => {
    if (current || !history.length) return
    future.push(history.pop())
    rebuild()
    updateControls()
  })
  $('redo-drawing').addEventListener('click', () => {
    if (current || !future.length) return
    history.push(future.pop())
    rebuild()
    updateControls()
  })
  $('clear-drawing').addEventListener('click', () => {
    $('clear-confirmation').hidden = false
    $('cancel-clear').focus()
  })
  $('cancel-clear').addEventListener('click', () => {
    $('clear-confirmation').hidden = true
    $('clear-drawing').focus()
  })
  $('confirm-clear').addEventListener('click', () => {
    if (current) return
    history.push({ kind: 'clear' })
    future.length = 0
    $('clear-confirmation').hidden = true
    rebuild()
    updateControls()
    $('undo-drawing').focus()
  })
  whiteBackground(baseContext)
  showCanvas()
  updateControls()

  return {
    hasDrawing,
    setLocked(next) {
      if (locked === next) return
      locked = next
      finishStroke()
      root.querySelector('.drawing-layout').inert = locked
      canvas.setAttribute('aria-disabled', String(locked))
    },
    exportPng() {
      finishStroke()
      return new Promise((resolve, reject) => {
        base.toBlob(blob => blob ? resolve(blob) : reject(new Error('PNG export failed')), 'image/png')
      })
    },
  }
}
