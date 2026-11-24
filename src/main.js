import './styles.css'
import './student.css'
import { MIN_TURNS, MAX_TURNS } from './chatConfig.js'
import { requestReply } from './openaiClient.js'
import { createDrawingBoard } from './drawing.js'

const $ = id => document.getElementById(id)
const messages = []
let apiKey = ''
let completedTurns = 0
let busy = false
let phase = 'chat'
let drawing = null
let requestController = null
let exporting = false

function setStatus(id, text, error = false) {
  $(id).textContent = text
  $(id).classList.toggle('is-error', error)
}

function messageElement(role, text, pending = false) {
  const article = document.createElement('article')
  article.className = `chat-message message-${role}${pending ? ' is-pending' : ''}`
  const label = document.createElement('p')
  label.className = 'message-author'
  label.textContent = role === 'user' ? '나의 이야기' : '마음 챗봇'
  const content = document.createElement('p')
  content.className = 'message-content'
  content.textContent = text
  article.append(label, content)
  return article
}

function appendMessage(role, text, pending = false) {
  const node = messageElement(role, text, pending)
  $('chat-messages').append(node)
  node.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  return node
}

function updateUI() {
  $('key-panel').hidden = Boolean(apiKey)
  $('activity-workspace').hidden = !apiKey
  $('chat-panel').hidden = phase !== 'chat'
  $('drawing-panel').hidden = phase !== 'drawing'
  $('api-key').disabled = busy
  $('verify-key').disabled = busy
  $('verify-key').textContent = busy ? '연결 확인 중…' : '키 확인하고 시작하기'
  $('key-form').setAttribute('aria-busy', String(busy && !apiKey))
  $('chat-form').setAttribute('aria-busy', String(busy && Boolean(apiKey)))
  $('chat-input').disabled = busy || completedTurns >= MAX_TURNS
  $('send-message').disabled = busy || completedTurns >= MAX_TURNS
  $('send-message').textContent = busy ? '답변을 기다리는 중…' : '이야기 보내기'
  $('finish-chat').disabled = busy || completedTurns < MIN_TURNS
  $('change-key').disabled = busy
  $('turn-counter').textContent = `완료한 대화 ${completedTurns} / ${MAX_TURNS}회`
  $('finish-hint').textContent = completedTurns >= MAX_TURNS
    ? '7회의 이야기를 모두 나눴어요. 종료 버튼을 누르면 그림판이 열려요.'
    : completedTurns >= MIN_TURNS
      ? '조금 더 이야기하거나, 여기서 마치고 그림으로 표현해도 좋아요.'
      : `대화를 ${MIN_TURNS - completedTurns}회 더 나누면 그림으로 넘어갈 수 있어요.`
  const activeStep = !apiKey ? 'step-key' : phase === 'chat' ? 'step-chat' : 'step-draw'
  for (const id of ['step-key', 'step-chat', 'step-draw']) {
    if (id === activeStep) $(id).setAttribute('aria-current', 'step')
    else $(id).removeAttribute('aria-current')
  }
}

$('key-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (busy) return
  const candidate = $('api-key').value.trim()
  if (!candidate || /\s/.test(candidate)) {
    setStatus('key-status', '공백 없이 API 키를 입력해 주세요.', true)
    return
  }
  busy = true
  requestController = new AbortController()
  setStatus('key-status', '모델에 연결하고 있어요. 잠시만 기다려 주세요.')
  updateUI()
  try {
    const greeting = await requestReply({ apiKey: candidate, messages: [], signal: requestController.signal })
    apiKey = candidate
    $('api-key').value = ''
    if (!messages.length) {
      messages.push({ role: 'assistant', content: greeting })
      appendMessage('assistant', greeting)
    }
    setStatus('key-status', '')
  } catch (error) {
    $('api-key').value = ''
    setStatus('key-status', error.message, true)
  } finally {
    busy = false
    requestController = null
    updateUI()
    if (apiKey && completedTurns < MAX_TURNS) $('chat-input').focus()
    else if (apiKey) $('finish-chat').focus()
    else $('api-key').focus()
  }
})

$('change-key').addEventListener('click', () => {
  if (busy) return
  apiKey = ''
  updateUI()
  setStatus('key-status', '새 키를 확인하면 지금까지의 대화를 이어 갈 수 있어요.')
  $('api-key').focus()
})

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!apiKey || busy || phase !== 'chat' || completedTurns >= MAX_TURNS) return
  const text = $('chat-input').value.trim()
  if (!text || text.length > 1200) {
    setStatus('chat-status', '1~1,200자 안에서 이야기를 적어 주세요.', true)
    return
  }
  const userMessage = { role: 'user', content: text }
  const pending = appendMessage('user', text, true)
  busy = true
  requestController = new AbortController()
  updateUI()
  setStatus('chat-status', '이야기를 읽고 있어요. 잠시만 기다려 주세요.')
  try {
    const reply = await requestReply({ apiKey, messages: [...messages, userMessage], turn: completedTurns + 1, signal: requestController.signal })
    messages.push(userMessage, { role: 'assistant', content: reply })
    pending.classList.remove('is-pending')
    appendMessage('assistant', reply)
    completedTurns += 1
    $('chat-input').value = ''
    setStatus('chat-status', completedTurns === MAX_TURNS ? '이야기를 모두 나눴어요. 아래 종료 버튼으로 그림을 그리러 가요.' : '')
  } catch (error) {
    pending.remove()
    setStatus('chat-status', `${error.message} 작성한 이야기는 남겨 두었어요.`, true)
  } finally {
    busy = false
    requestController = null
    updateUI()
    if (completedTurns < MAX_TURNS) $('chat-input').focus()
    else $('finish-chat').focus()
  }
})

$('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault()
    $('chat-form').requestSubmit()
  }
})

$('finish-chat').addEventListener('click', () => {
  if (!apiKey || busy || phase !== 'chat' || completedTurns < MIN_TURNS) return
  phase = 'drawing'
  $('conversation-review').replaceChildren(...messages.map(message => messageElement(message.role, message.content)))
  updateUI()
  drawing = createDrawingBoard($('drawing-panel'), {
    onChange: hasDrawing => {
      $('download-drawing').disabled = !hasDrawing || exporting
      setStatus('drawing-status', '')
    },
  })
  if (!drawing) setStatus('drawing-status', '이 브라우저에서 그림판을 열 수 없어요. 최신 Chrome, Edge 또는 Safari를 이용해 주세요.', true)
  $('drawing-title').focus()
})

$('download-drawing').addEventListener('click', async () => {
  if (!drawing?.hasDrawing() || exporting) return
  exporting = true
  $('download-drawing').disabled = true
  try {
    const blob = await drawing.exportPng()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    const date = new Date()
    const day = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-')
    link.href = url
    link.download = `my-day-${day}.png`
    document.body.append(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 60000)
    setStatus('drawing-status', 'PNG 저장을 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요. 서버로 제출되지는 않았어요.')
  } catch {
    setStatus('drawing-status', '그림 파일을 만들지 못했어요. 다시 저장해 주세요.', true)
  } finally {
    exporting = false
    $('download-drawing').disabled = !drawing.hasDrawing()
  }
})

window.addEventListener('beforeunload', event => {
  if (messages.length > 1 || drawing?.hasDrawing()) {
    event.preventDefault()
    event.returnValue = ''
  }
})
window.addEventListener('pagehide', () => requestController?.abort())
updateUI()
