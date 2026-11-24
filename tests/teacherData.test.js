import test from 'node:test'
import assert from 'node:assert/strict'
import { createTeacherDataService } from '../src/teacherData.js'
import { normalizeActivity, availableDates, formatDuration } from '../src/teacherRecords.js'

const record = { id: 'activity-1', uid: 'student-1', drawingStoragePath: 'studentActivities/student-1/activity-1.png' }
function services() {
  const calls = []
  return {
    calls,
    assertAdmin() {},
    watchRecords: async () => () => {},
    readPng: async path => { calls.push(['read', path]); return new Blob(['png'], { type: 'image/png' }) },
    removePng: async path => { calls.push(['png', path]) },
    removeRecord: async id => { calls.push(['record', id]) },
  }
}

test('dates use Korean time and prefer the submission click over later server acknowledgement', () => {
  const activity = normalizeActivity({ displayName: '학생', submittedAtClient: { seconds: Date.parse('2026-11-23T15:01:00Z') / 1000 }, savedAt: Date.parse('2026-11-24T16:00:00Z') })
  assert.equal(activity.dateKey, '2026-11-24')
  assert.equal(activity.label, '학생 (2026-11-24 00:01:00)')
  const unknown = normalizeActivity({ id: 'legacy' })
  assert.equal(unknown.dateKey, 'unknown')
  assert.deepEqual(availableDates([activity, unknown, { dateKey: '2026-11-23' }, activity]), ['2026-11-24', '2026-11-23', 'unknown'])
  assert.equal(formatDuration(90000), '1분 30초')
  assert.equal(formatDuration(null), '기록 없음')
})

test('deletes PNG before the Firestore record', async () => {
  const dependency = services()
  await createTeacherDataService(dependency).deleteActivity(record)
  assert.deepEqual(dependency.calls, [['png', record.drawingStoragePath], ['record', record.id]])
})

test('an already missing PNG does not prevent deleting the record', async () => {
  const dependency = services()
  dependency.removePng = async () => { throw { code: 'storage/object-not-found' } }
  await createTeacherDataService(dependency).deleteActivity(record)
  assert.deepEqual(dependency.calls, [['record', record.id]])
})

test('a storage deletion failure preserves the Firestore record', async () => {
  const dependency = services()
  dependency.removePng = async () => { throw { code: 'storage/unauthorized' } }
  await assert.rejects(createTeacherDataService(dependency).deleteActivity(record), { code: 'storage/unauthorized' })
  assert.equal(dependency.calls.length, 0)
})

test('partial deletion is reported and can be retried after the PNG has gone', async () => {
  const dependency = services()
  dependency.removeRecord = async () => { throw { code: 'permission-denied' } }
  const service = createTeacherDataService(dependency)
  await assert.rejects(service.deleteActivity(record), { partialDeletion: true })
  dependency.removePng = async () => { throw { code: 'storage/object-not-found' } }
  dependency.removeRecord = async id => dependency.calls.push(['record', id])
  await service.deleteActivity(record)
  assert.deepEqual(dependency.calls, [['png', record.drawingStoragePath], ['record', record.id]])
})

test('non-admin actions and paths outside the student activity are rejected', async () => {
  const dependency = services()
  const service = createTeacherDataService(dependency)
  await assert.rejects(service.deleteActivity({ ...record, drawingStoragePath: 'another-user/private.png' }), { code: 'activity/invalid-path' })
  assert.equal(dependency.calls.length, 0)
  dependency.assertAdmin = () => { throw { code: 'activity/admin-required' } }
  await assert.rejects(service.watchActivities(() => {}, () => {}), { code: 'activity/admin-required' })
  await assert.rejects(service.loadDrawing(record), { code: 'activity/admin-required' })
  await assert.rejects(service.deleteActivity(record), { code: 'activity/admin-required' })
  assert.equal(dependency.calls.length, 0)
})

test('losing admin access during deletion stops the record delete and reports partial deletion', async () => {
  const dependency = services()
  let checks = 0
  dependency.assertAdmin = () => { if (++checks > 1) throw { code: 'activity/admin-required' } }
  await assert.rejects(createTeacherDataService(dependency).deleteActivity(record), { code: 'activity/admin-required', partialDeletion: true })
  assert.deepEqual(dependency.calls, [['png', record.drawingStoragePath]])
})
