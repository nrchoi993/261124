import './styles.css'
import './student.css'
import { MIN_TURNS, MAX_TURNS } from './chatConfig.js'
import { requestReply } from './openaiClient.js'
import { createDrawingBoard } from './drawing.js'
import { watchAuthState } from './firebaseAuth.js'
import { googleProfile } from './studentIdentity.js'

const $ = id => document.getElementById(id)
const messages = []
let apiKey = ''
let completedTurns = 0
let busy = false
let phase = 'chat'
let drawing = null
let requestController = null
let exporting = false
let currentProfile = null
let authReady = false
let ownerUid = null
let chatStartedAt = null
let chatEndedAt = null
let submissionId = null
let submissionSnapshot = null
let submitting = false
let submitted = false
let drawingReady = false

function canUseActivity() {
  return authReady && Boolean(currentProfile) && (!ownerUid || ownerUid === currentProfile.uid)
}

function updateDrawingActions() {
  const hasDrawing = drawingReady && Boolean(drawing?.hasDrawing())
  $('download-drawing').disabled = !hasDrawing || exporting || submitting
  $('submit-drawing').disabled = !canUseActivity() || !hasDrawing || submitting || submitted
  $('submit-drawing').textContent = submitted ? '제출 완료' : submitting ? '제출 중…' : submissionSnapshot ? '다시 제출하기' : '제출하기'
}

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
  const available = canUseActivity()
  $('key-panel').hidden = !available || Boolean(apiKey)
  $('activity-workspace').hidden = !available || !apiKey
  $('chat-panel').hidden = phase !== 'chat'
  $('drawing-panel').hidden = phase !== 'drawing'
  $('api-key').disabled = busy || !available
  $('verify-key').disabled = busy || !available
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
  drawing?.setLocked(!available || Boolean(submissionSnapshot) || submitting || submitted)
  $('drawing-panel').setAttribute('aria-busy', String(submitting))
  updateDrawingActions()
}

$('key-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!canUseActivity() || busy || phase !== 'chat') return
  const candidate = $('api-key').value.trim()
  if (!candidate || /\s/.test(candidate)) {
    setStatus('key-status', '공백 없이 API 키를 입력해 주세요.', true)
    return
  }
  busy = true
  ownerUid ??= currentProfile.uid
  submissionId ??= crypto.randomUUID()
  requestController = new AbortController()
  setStatus('key-status', '모델에 연결하고 있어요. 잠시만 기다려 주세요.')
  updateUI()
  try {
    const greeting = await requestReply({ apiKey: candidate, messages: [], signal: requestController.signal })
    if (!canUseActivity()) return
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
    if (!canUseActivity()) return
    if (apiKey && completedTurns < MAX_TURNS) $('chat-input').focus()
    else if (apiKey) $('finish-chat').focus()
    else $('api-key').focus()
  }
})

$('change-key').addEventListener('click', () => {
  if (!canUseActivity() || busy) return
  apiKey = ''
  updateUI()
  setStatus('key-status', '새 키를 확인하면 지금까지의 대화를 이어 갈 수 있어요.')
  $('api-key').focus()
})

$('chat-form').addEventListener('submit', async event => {
  event.preventDefault()
  if (!canUseActivity() || !apiKey || busy || phase !== 'chat' || completedTurns >= MAX_TURNS) return
  const text = $('chat-input').value.trim()
  if (!text || text.length > 1200) {
    setStatus('chat-status', '1~1,200자 안에서 이야기를 적어 주세요.', true)
    return
  }
  const userMessage = { role: 'user', content: text }
  chatStartedAt ??= Date.now()
  const pending = appendMessage('user', text, true)
  busy = true
  requestController = new AbortController()
  updateUI()
  setStatus('chat-status', '이야기를 읽고 있어요. 잠시만 기다려 주세요.')
  try {
    const reply = await requestReply({ apiKey, messages: [...messages, userMessage], turn: completedTurns + 1, signal: requestController.signal })
    if (!canUseActivity()) { pending.remove(); return }
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
    if (!canUseActivity()) return
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
  if (!canUseActivity() || !apiKey || busy || phase !== 'chat' || completedTurns < MIN_TURNS) return
  chatEndedAt = Math.max(chatStartedAt, Date.now())
  phase = 'drawing'
  $('conversation-review').replaceChildren(...messages.map(message => messageElement(message.role, message.content)))
  updateUI()
  drawing = createDrawingBoard($('drawing-panel'), {
    onChange: hasDrawing => {
      drawingReady = hasDrawing
      updateDrawingActions()
      setStatus('drawing-status', '')
    },
  })
  if (!drawing) setStatus('drawing-status', '이 브라우저에서 그림판을 열 수 없어요. 최신 Chrome, Edge 또는 Safari를 이용해 주세요.', true)
  updateUI()
  $('drawing-title').focus()
})

$('download-drawing').addEventListener('click', async () => {
  if (!drawing?.hasDrawing() || exporting || submitting) return
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
    setStatus('drawing-status', 'PNG 다운로드를 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요. 이 버튼은 파일만 내려받아요.')
  } catch {
    setStatus('drawing-status', '그림 파일을 만들지 못했어요. 다시 저장해 주세요.', true)
  } finally {
    exporting = false
    updateDrawingActions()
  }
})

function submissionError(error) {
  if (error?.code === 'activity/auth-changed') return error.message
  if (['permission-denied', 'storage/unauthorized'].includes(error?.code)) return '저장 권한이 없어요. 관리자에게 Firestore와 Storage의 접근 규칙 확인을 요청해 주세요.'
  if (['storage/bucket-not-found', 'storage/no-default-bucket', 'app/missing-storage-bucket'].includes(error?.code)) return '그림 저장 공간을 찾을 수 없어요. 관리자에게 Storage 설정 확인을 요청해 주세요.'
  if (error?.code === 'storage/quota-exceeded') return '그림 저장 공간의 사용 한도를 확인해야 해요. 관리자에게 문의해 주세요.'
  return '제출을 완료하지 못했어요. 인터넷 연결을 확인하고 다시 제출해 주세요.'
}

$('submit-drawing').addEventListener('click', async () => {
  if (!canUseActivity() || submitting || submitted || !drawingReady || !drawing?.hasDrawing()) return
  // 버튼을 누른 시각에 시간을 고정합니다. PNG 변환·업로드·재시도 대기 시간은 포함하지 않습니다.
  submissionSnapshot ??= {
    id: submissionId,
    user: { ...currentProfile },
    messages: messages.map(message => ({ ...message })),
    chatStartedAt,
    chatEndedAt,
    submittedAtClient: Math.max(chatEndedAt, Date.now()),
    png: null,
  }
  submitting = true
  updateUI()
  setStatus('submission-status', '그림과 활동 기록을 저장하고 있어요. 완료 안내가 나올 때까지 기다려 주세요.')
  try {
    submissionSnapshot.png ??= await drawing.exportPng()
    const { submitStudentActivity } = await import('./studentSubmission.js')
    await submitStudentActivity(submissionSnapshot)
    submitted = true
    setStatus('submission-status', '그림과 활동 기록을 모두 제출했어요. 오늘의 마음을 들려줘서 고마워요.')
    $('session-note').textContent = '제출이 완료되었어요. 이제 안심하고 페이지를 닫거나 첫 화면으로 돌아가도 괜찮아요.'
  } catch (error) {
    if (!submissionSnapshot.png) submissionSnapshot = null
    setStatus('submission-status', `${submissionError(error)} 대화와 그림은 이 페이지에 남아 있어요.${submissionSnapshot ? ' 같은 그림과 기록으로 다시 제출할 수 있어요.' : ''}`, true)
  } finally {
    submitting = false
    updateUI()
  }
})

function authChanged(user) {
  currentProfile = googleProfile(user)
  authReady = true
  $('student-profile').hidden = !currentProfile
  $('student-name').textContent = currentProfile?.displayName || '이름 정보 없음'
  $('student-email').textContent = currentProfile?.email || ''
  $('student-login-link').hidden = canUseActivity()
  $('student-auth-status').textContent = !currentProfile
    ? '학생 활동을 이용하려면 Google 로그인이 필요해요.'
    : !canUseActivity()
      ? '활동을 시작한 Google 계정으로 다시 로그인해 주세요. 지금까지의 활동은 이 페이지에 남아 있어요.'
      : '이 계정으로 활동 기록을 제출해요.'
  if (!canUseActivity()) requestController?.abort()
  updateUI()
}

window.addEventListener('beforeunload', event => {
  if (!submitted && (messages.length > 1 || drawing?.hasDrawing())) {
    event.preventDefault()
    event.returnValue = ''
  }
})
window.addEventListener('pagehide', () => requestController?.abort())
updateUI()
try {
  watchAuthState(authChanged, () => {
    authChanged(null)
    $('student-auth-status').textContent = '로그인 상태를 확인하지 못했어요. 첫 화면에서 다시 로그인해 주세요.'
  })
} catch {
  authChanged(null)
  $('student-auth-status').textContent = '로그인 설정을 확인해야 해요. 관리자에게 문의해 주세요.'
}
