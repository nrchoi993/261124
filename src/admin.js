import './styles.css'
import './admin.css'
import { watchAuthState } from './firebaseAuth.js'
import { isAdmin } from './accessControl.js'

const content = document.getElementById('main-content')
const status = document.getElementById('teacher-access-status')
let redirecting = false

function returnToMain() {
  redirecting = true
  content.hidden = true
  status.hidden = false
  status.textContent = '접근 권한이 없어 첫 화면으로 이동해요.'
  window.location.replace('/')
}

try {
  watchAuthState(user => {
    if (redirecting) return
    if (!isAdmin(user)) {
      returnToMain()
      return
    }
    status.hidden = true
    content.hidden = false
  }, returnToMain)
} catch {
  returnToMain()
}
