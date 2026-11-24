import test from 'node:test'
import assert from 'node:assert/strict'
import { submitStudentActivity } from '../src/studentSubmission.js'

const user = { uid: 'student-1', displayName: '학생', email: 'student@example.com' }
const firebaseUser = { ...user, providerData: [{ providerId: 'google.com', email: user.email }] }
function snapshot() {
  return {
    id: 'activity-1', user,
    messages: [{ role: 'assistant', content: '안녕!' }, ...Array.from({ length: 3 }, (_, index) => [
      { role: 'user', content: `${index + 1}번째 이야기` }, { role: 'assistant', content: '그랬구나.' },
    ]).flat()],
    chatStartedAt: 1000, chatEndedAt: 61000, submittedAtClient: 181000,
    png: new Blob(['png-data'], { type: 'image/png' }),
  }
}
function services() {
  const calls = []
  return {
    calls,
    getUser: () => firebaseUser,
    uploadPng: async (path, blob) => { calls.push({ kind: 'png', path, blob }) },
    saveRecord: async (id, data) => { calls.push({ kind: 'record', id, data }) },
    timestamp: ms => ({ milliseconds: ms }),
    serverTimestamp: () => 'server-timestamp',
  }
}

test('uploads PNG before writing all required fields, times and storage reference; excludes extra data', async () => {
  const dependency = services()
  const data = snapshot()
  data.apiKey = 'never-store-this'
  await submitStudentActivity(data, dependency)
  assert.deepEqual(dependency.calls.map(call => call.kind), ['png', 'record'])
  const record = dependency.calls[1].data
  assert.equal(record.displayName, user.displayName)
  assert.equal(record.email, user.email)
  assert.deepEqual(record.messages, data.messages)
  assert.equal(record.chatDurationMs, 60000)
  assert.equal(record.drawingDurationMs, 120000)
  assert.equal(record.savedAt, 'server-timestamp')
  assert.equal(record.drawingStoragePath, 'studentActivities/student-1/activity-1.png')
  assert.equal(record.drawingContentType, 'image/png')
  assert.ok(!JSON.stringify(record).includes('never-store-this'))
})

test('upload errors do not create a Firestore record', async () => {
  const dependency = services()
  dependency.uploadPng = async () => { throw new Error('upload failed') }
  await assert.rejects(submitStudentActivity(snapshot(), dependency), /upload failed/)
  assert.equal(dependency.calls.length, 0)
})

test('a retry after Firestore failure keeps the same file, ID, timestamps and durations', async () => {
  const dependency = services()
  const save = dependency.saveRecord
  let fail = true
  dependency.saveRecord = async (...args) => { await save(...args); if (fail) throw new Error('write failed') }
  const data = snapshot()
  await assert.rejects(submitStudentActivity(data, dependency), /write failed/)
  fail = false
  await submitStudentActivity(data, dependency)
  assert.equal(dependency.calls[0].path, dependency.calls[2].path)
  assert.equal(dependency.calls[1].id, dependency.calls[3].id)
  assert.deepEqual(dependency.calls[1].data, dependency.calls[3].data)
})

test('anonymous, switched-account and changed-email submissions are rejected before uploading', async () => {
  for (const changedUser of [null, { ...firebaseUser, uid: 'other' }, { ...firebaseUser, providerData: [{ providerId: 'google.com', email: 'other@example.com' }] }]) {
    const dependency = services()
    dependency.getUser = () => changedUser
    await assert.rejects(submitStudentActivity(snapshot(), dependency), { code: 'activity/auth-changed' })
    assert.equal(dependency.calls.length, 0)
  }
})

test('account changes during upload prevent the Firestore write', async () => {
  const dependency = services()
  let reads = 0
  dependency.getUser = () => ++reads === 1 ? firebaseUser : null
  await assert.rejects(submitStudentActivity(snapshot(), dependency), { code: 'activity/auth-changed' })
  assert.deepEqual(dependency.calls.map(call => call.kind), ['png'])
})

test('invalid PNG, paths, incomplete conversations and negative times are rejected', async () => {
  const cases = [
    { png: new Blob(['x'], { type: 'text/plain' }) }, { id: '../other' },
    { messages: snapshot().messages.slice(0, 3) }, { chatEndedAt: 999 },
  ]
  for (const invalid of cases) {
    const dependency = services()
    await assert.rejects(submitStudentActivity({ ...snapshot(), ...invalid }, dependency), { code: 'activity/invalid-data' })
    assert.equal(dependency.calls.length, 0)
  }
})
