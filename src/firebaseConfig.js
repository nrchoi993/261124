import { getApp, getApps, initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'

const env = import.meta.env ?? {}

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID,
  measurementId: env.VITE_FIREBASE_MEASUREMENT_ID,
}

// 다른 페이지에서도 이 함수를 import하면 같은 Firebase 앱을 재사용합니다.
export function getFirebaseApp() {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId']
  if (required.some(key => !firebaseConfig[key]?.trim())) {
    const error = new Error('Firebase web app configuration is missing.')
    error.code = 'app/missing-config'
    throw error
  }
  return getApps().some(app => app.name === '[DEFAULT]') ? getApp() : initializeApp(firebaseConfig)
}

export function getFirebaseAuth() {
  return getAuth(getFirebaseApp())
}

export async function getFirestoreDb() {
  const { getFirestore } = await import('firebase/firestore')
  return getFirestore(getFirebaseApp())
}

export async function getFirebaseStorage() {
  if (!firebaseConfig.storageBucket?.trim()) {
    const error = new Error('Firebase Storage bucket is missing.')
    error.code = 'app/missing-storage-bucket'
    throw error
  }
  const { getStorage } = await import('firebase/storage')
  return getStorage(getFirebaseApp())
}
