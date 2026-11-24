import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth'
import { getFirebaseAuth } from './firebaseConfig.js'

const googleProvider = new GoogleAuthProvider()
googleProvider.setCustomParameters({ prompt: 'select_account' })

export function watchAuthState(onChange, onError) {
  return onAuthStateChanged(getFirebaseAuth(), onChange, onError)
}

export function signInWithGoogle() {
  return signInWithPopup(getFirebaseAuth(), googleProvider)
}

export function signOutOfGoogle() {
  return signOut(getFirebaseAuth())
}
