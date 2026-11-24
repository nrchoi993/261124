import { collection, deleteDoc, doc, onSnapshot } from 'firebase/firestore'
import { deleteObject, getBlob, ref } from 'firebase/storage'
import { getFirebaseAuth, getFirestoreDb, getFirebaseStorage } from './firebaseConfig.js'
import { isAdmin } from './accessControl.js'

const firebaseServices = {
  assertAdmin() {
    if (!isAdmin(getFirebaseAuth().currentUser)) {
      const error = new Error('Administrator access is required')
      error.code = 'activity/admin-required'
      throw error
    }
  },
  async watchRecords(next, error) {
    return onSnapshot(collection(await getFirestoreDb(), 'studentActivities'), snapshot => {
      next(snapshot.docs.map(item => ({ ...item.data(), id: item.id })))
    }, error)
  },
  async readPng(path) { return getBlob(ref(await getFirebaseStorage(), path), 5 * 1024 * 1024) },
  async removePng(path) { return deleteObject(ref(await getFirebaseStorage(), path)) },
  async removeRecord(id) { return deleteDoc(doc(await getFirestoreDb(), 'studentActivities', id)) },
}

function activityPath(record) {
  const valid = /^[a-zA-Z0-9_-]{1,128}$/
  const expected = `studentActivities/${record.uid}/${record.id}.png`
  if (!valid.test(record.uid || '') || !valid.test(record.id || '') ||
      (record.drawingStoragePath && record.drawingStoragePath !== expected)) {
    const error = new Error('Invalid activity storage path')
    error.code = 'activity/invalid-path'
    throw error
  }
  return expected
}

export function createTeacherDataService(services = firebaseServices) {
  return {
    async watchActivities(next, error) {
      services.assertAdmin()
      return services.watchRecords(next, error)
    },
    async loadDrawing(record) {
      services.assertAdmin()
      const blob = await services.readPng(activityPath(record))
      if (blob.type !== 'image/png') throw new Error('Expected a PNG image')
      return blob
    },
    async deleteActivity(record) {
      services.assertAdmin()
      try {
        await services.removePng(activityPath(record))
      } catch (error) {
        if (error.code !== 'storage/object-not-found') throw error
      }
      // 두 저장소는 원자적으로 삭제되지 않습니다. 그림 삭제 후 실패해도 같은 기록으로 재시도합니다.
      try {
        services.assertAdmin()
        await services.removeRecord(record.id)
      } catch (error) {
        error.partialDeletion = true
        throw error
      }
    },
  }
}

export const teacherData = createTeacherDataService()
