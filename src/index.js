import './styles.css'
import './login.css'
import { watchAuthState, signInWithGoogle, signOutOfGoogle } from './firebaseAuth.js'

const loginButton = document.getElementById('google-login')
const logoutButton = document.getElementById('google-logout')
const status = document.getElementById('login-status')
const userLabel = document.getElementById('signed-in-user')
const panel = document.getElementById('login-panel')
const activityLinks = document.querySelectorAll('[data-auth-only]')
let currentUser = null
let ready = false
let pending = null
let unsubscribe = null
let configurationError = false

function isGoogleUser(user) {
  return Boolean(user?.providerData?.some(provider => provider.providerId === 'google.com'))
}

function showStatus(message, isError = false) {
  status.textContent = message
  status.classList.toggle('is-error', isError)
}

function render() {
  const signedIn = ready && isGoogleUser(currentUser)
  const showLinks = signedIn && pending !== 'logout'
  for (const link of activityLinks) link.hidden = !showLinks
  loginButton.hidden = signedIn
  logoutButton.hidden = !currentUser
  loginButton.disabled = !ready || Boolean(pending) || configurationError
  logoutButton.disabled = Boolean(pending)
  loginButton.textContent = pending === 'login' ? 'Google 로그인 중…' : 'Google로 로그인'
  logoutButton.textContent = pending === 'logout' ? '로그아웃 중…' : '로그아웃'
  panel.setAttribute('aria-busy', String(!ready || Boolean(pending)))
  userLabel.hidden = !signedIn
  userLabel.textContent = signedIn ? `${currentUser.displayName || '사용자'}님, 반가워요.` : ''
  document.getElementById('login-description').textContent = signedIn
    ? '이제 학생 활동 또는 교사 공간을 선택해 주세요.'
    : '로그인하면 학생 활동과 교사 공간으로 이동할 수 있어요.'
}

function loginErrorMessage(error) {
  switch (error?.code) {
    case 'auth/popup-closed-by-user': return '로그인 창이 닫혔어요. 원할 때 다시 로그인해 주세요.'
    case 'auth/popup-blocked': return '로그인 팝업이 차단됐어요. 이 사이트의 팝업을 허용한 후 다시 눌러 주세요.'
    case 'auth/cancelled-popup-request': return '로그인 요청이 취소됐어요. 다시 눌러 주세요.'
    case 'auth/unauthorized-domain': return '이 사이트 주소에서 로그인이 허용되지 않았어요. 관리자에게 사이트 주소 등록을 요청해 주세요.'
    case 'auth/network-request-failed': return '연결이 원활하지 않아요. 인터넷 연결을 확인하고 다시 시도해 주세요.'
    case 'auth/operation-not-allowed': return 'Google 로그인이 아직 활성화되지 않았어요. 관리자에게 문의해 주세요.'
    case 'auth/web-storage-unsupported': return '이 브라우저에서 로그인 정보를 유지할 수 없어요. 사이트 데이터 저장 설정을 확인해 주세요.'
    case 'app/missing-config':
    case 'auth/invalid-api-key':
    case 'auth/configuration-not-found': return '로그인 설정을 확인해야 해요. 관리자에게 문의해 주세요.'
    default: return '로그인을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.'
  }
}

function observeAuth() {
  try {
    unsubscribe = watchAuthState(user => {
      currentUser = user
      ready = true
      configurationError = false
      render()
      showStatus(isGoogleUser(user)
        ? 'Google 로그인이 확인되었어요.'
        : 'Google로 로그인하면 두 공간의 이동 버튼이 나타나요.')
    }, error => {
      currentUser = null
      ready = true
      unsubscribe = null
      showStatus(loginErrorMessage(error), true)
      render()
    })
    return true
  } catch (error) {
    currentUser = null
    ready = true
    configurationError = ['app/missing-config', 'auth/invalid-api-key'].includes(error?.code)
    showStatus(loginErrorMessage(error), true)
    render()
    return false
  }
}

loginButton.addEventListener('click', async () => {
  if (!ready || pending || configurationError) return
  if (!unsubscribe && !observeAuth()) return
  pending = 'login'
  render()
  showStatus('Google 로그인 창에서 계정을 선택해 주세요.')
  try {
    await signInWithGoogle()
  } catch (error) {
    showStatus(loginErrorMessage(error), true)
  } finally {
    pending = null
    render()
  }
})

logoutButton.addEventListener('click', async () => {
  if (pending || !currentUser) return
  pending = 'logout'
  render()
  showStatus('로그아웃하고 있어요.')
  try {
    await signOutOfGoogle()
    showStatus('로그아웃했어요. 다시 로그인하면 활동을 이어 갈 수 있어요.')
  } catch {
    showStatus('로그아웃하지 못했어요. 연결을 확인한 후 다시 시도해 주세요.', true)
  } finally {
    pending = null
    render()
  }
})

render()
observeAuth()
