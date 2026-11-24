import './styles.css'
import './admin.css'
import { watchAuthState } from './firebaseAuth.js'
import { isAdmin } from './accessControl.js'

const content = document.getElementById('main-content')
const status = document.getElementById('teacher-access-status')
let redirecting = false
let dashboard = null
let authorizationVersion = 0

function returnToMain() {
  redirecting = true
  authorizationVersion += 1
  dashboard?.destroy()
  content.hidden = true
  status.hidden = false
  status.textContent = '접근 권한이 없어 첫 화면으로 이동해요.'
  window.location.replace('/')
}

try {
  watchAuthState(async user => {
    if (redirecting) return
    if (!isAdmin(user)) {
      returnToMain()
      return
    }
    status.hidden = true
    content.hidden = false
    const version = ++authorizationVersion
    document.getElementById('teacher-account').textContent = [user.displayName || '관리자', user.email].filter(Boolean).join('\n')
    if (dashboard) return
    try {
      const { mountTeacherDashboard } = await import('./teacherDashboard.js')
      if (redirecting || version !== authorizationVersion) return
      dashboard = mountTeacherDashboard()
    } catch {
      if (redirecting || version !== authorizationVersion) return
      document.getElementById('activity-list-status').textContent = '화면을 준비하지 못했어요. 페이지를 새로고침해 주세요.'
    }
  }, returnToMain)
} catch {
  returnToMain()
}
