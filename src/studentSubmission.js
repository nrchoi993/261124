import { doc, setDoc, Timestamp, serverTimestamp } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { getFirebaseAuth, getFirebaseStorage, getFirestoreDb } from './firebaseConfig.js'
import { MIN_TURNS, MAX_TURNS } from './chatConfig.js'
import { googleProfile } from './studentIdentity.js'

const firebaseServices = {
  getUser: () => getFirebaseAuth().currentUser,
  uploadPng: async (path, blob) => uploadBytes(ref(await getFirebaseStorage(), path), blob, { contentType: 'image/png' }),
  saveRecord: async (id, data) => setDoc(doc(await getFirestoreDb(), 'studentActivities', id), data),
  timestamp: ms => Timestamp.fromMillis(ms),
  serverTimestamp,
}

function assertOwner(user, profile) {
  const current = googleProfile(user)
  if (!current || current.uid !== profile.uid || current.email !== profile.email) {
    const error = new Error('활동을 시작한 Google 계정으로 다시 로그인해 주세요.')
    error.code = 'activity/auth-changed'
    throw error
  }
}

// 업로드 후 문서를 기록합니다. 실패 시 같은 ID와 PNG를 재전송해 중복 기록을 막습니다.
export async function submitStudentActivity(snapshot, services = firebaseServices) {
  const { id, user, png, messages, chatStartedAt, chatEndedAt, submittedAtClient } = snapshot
  assertOwner(services.getUser(), user)
  const turns = messages.filter(message => message.role === 'user').length
  const validMessages = messages.length === 1 + turns * 2 && messages.every((message, index) =>
    message.role === (index % 2 === 0 ? 'assistant' : 'user') && typeof message.content === 'string' && message.content.trim())
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || turns < MIN_TURNS || turns > MAX_TURNS || !validMessages ||
      ![chatStartedAt, chatEndedAt, submittedAtClient].every(Number.isSafeInteger) ||
      chatStartedAt > chatEndedAt || chatEndedAt > submittedAtClient ||
      png?.type !== 'image/png' || !png.size || png.size > 5 * 1024 * 1024) {
    const error = new Error('제출할 대화, 시간 또는 그림 정보를 확인할 수 없어요.')
    error.code = 'activity/invalid-data'
    throw error
  }
  const path = `studentActivities/${user.uid}/${id}.png`
  await services.uploadPng(path, png)
  // 업로드 도중 다른 계정으로 전환된 경우 이전 학생의 기록을 쓰지 않습니다.
  assertOwner(services.getUser(), user)
  await services.saveRecord(id, {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    messages: messages.map(({ role, content }) => ({ role, content })),
    turnCount: turns,
    chatStartedAt: services.timestamp(chatStartedAt),
    chatEndedAt: services.timestamp(chatEndedAt),
    submittedAtClient: services.timestamp(submittedAtClient),
    chatDurationMs: chatEndedAt - chatStartedAt,
    drawingDurationMs: submittedAtClient - chatEndedAt,
    drawingStoragePath: path,
    drawingContentType: 'image/png',
    drawingWidth: 1200,
    drawingHeight: 800,
    savedAt: services.serverTimestamp(),
  })
  return { id, path }
}
