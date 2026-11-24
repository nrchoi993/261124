import { test, expect } from '@playwright/test'
import { mockAdminUids } from './helpers/adminUids.js'

const googleUser = {
  uid: 'test-student',
  displayName: '마음 학생',
  providerData: [{ providerId: 'google.com' }],
}

// Firebase SDK 경계만 대체합니다. 실제 계정이나 OAuth 서버에 접근하지 않습니다.
async function mockAuth(page, scenario = {}) {
  await page.route('**/src/firebaseAuth.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const scenario = ${JSON.stringify(scenario)};
      const defaultUser = ${JSON.stringify(googleUser)};
      let user = JSON.parse(sessionStorage.getItem('test-auth-user') || 'null') || scenario.user || null;
      let notify;
      window.authTest = { loginCalls: 0, logoutCalls: 0, scenario };
      function publish(next) {
        user = next;
        if (user) sessionStorage.setItem('test-auth-user', JSON.stringify(user));
        else sessionStorage.removeItem('test-auth-user');
        notify?.(user);
      }
      window.addEventListener('test-auth-change', event => publish(event.detail));
      export function watchAuthState(onChange, onError) {
        if (scenario.configError) throw { code: scenario.configError };
        notify = onChange;
        const ready = () => scenario.observerError ? onError({ code: scenario.observerError }) : onChange(user);
        if (scenario.holdInitial) window.addEventListener('test-auth-ready', ready, { once: true });
        else queueMicrotask(ready);
        return () => { notify = null; };
      }
      export async function signInWithGoogle() {
        window.authTest.loginCalls++;
        if (scenario.holdLogin) await new Promise(resolve => window.addEventListener('test-login-release', resolve, { once: true }));
        if (scenario.loginError) throw { code: scenario.loginError };
        publish(defaultUser);
        return { user };
      }
      export async function signOutOfGoogle() {
        window.authTest.logoutCalls++;
        if (scenario.holdLogout) await new Promise(resolve => window.addEventListener('test-logout-release', resolve, { once: true }));
        if (scenario.logoutError) throw { code: scenario.logoutError };
        publish(null);
      }
    `,
  }))
}

async function expectLinks(page, visible) {
  for (const href of ['/student.html', '/teacherMonitor.html']) {
    const link = page.locator(`a[href="${href}"]`)
    if (visible && href === '/student.html') await expect(link).toBeVisible()
    else await expect(link).toBeHidden()
  }
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await mockAdminUids(page)
})

test('Firebase initializes from environment or reports missing config without exposing activity links', async ({ page }) => {
  await page.goto('/')
  await expectLinks(page, false)
  const initialized = await page.evaluate(async () => {
    const { getFirebaseApp, getFirebaseAuth } = await import('/src/firebaseConfig.js')
    try {
      const app = getFirebaseApp()
      return { ready: Boolean(app.options.projectId && app.options.authDomain && app.options.appId && app.options.apiKey), reused: app === getFirebaseApp() && getFirebaseAuth().app === app }
    } catch (error) {
      return { code: error.code }
    }
  })
  if (initialized.code) {
    expect(initialized.code).toBe('app/missing-config')
    await expect(page.locator('#login-status')).toContainText('로그인 설정을 확인')
  } else {
    expect(initialized).toEqual({ ready: true, reused: true })
    await expect(page.locator('#google-login')).toBeEnabled()
  }
})

test('login state must finish restoring before actions appear; Google login and logout toggle both links', async ({ page }) => {
  await mockAuth(page, { holdInitial: true, holdLogin: true })
  await page.goto('/')
  await expectLinks(page, false)
  await expect(page.locator('#google-login')).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('test-auth-ready')))
  await expect(page.locator('#google-login')).toBeEnabled()
  await page.screenshot({ path: 'test-results/home-signed-out.png', fullPage: true })
  await page.locator('#google-login').click()
  await expect(page.locator('#google-login')).toBeDisabled()
  await expectLinks(page, false)
  await page.locator('#google-login').dispatchEvent('click')
  expect(await page.evaluate(() => window.authTest.loginCalls)).toBe(1)
  await page.evaluate(() => window.dispatchEvent(new Event('test-login-release')))
  await expectLinks(page, true)
  await expect(page.locator('#signed-in-user')).toContainText('마음 학생')
  await expect(page.locator('#google-login')).toBeHidden()
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/home-signed-in-mobile.png', fullPage: true })
  await page.locator('#google-logout').click()
  await expectLinks(page, false)
  await expect(page.locator('#google-login')).toBeVisible()
  await expect(page.locator('#google-logout')).toBeHidden()
  await expect(page.locator('#login-status')).toContainText('로그아웃했어요')
})

test('restored Google sessions unlock links; names are plain text; external logout and other providers keep them hidden', async ({ page }) => {
  const name = '<img src=x onerror="window.injected=true">'
  await mockAuth(page, { user: { ...googleUser, displayName: name } })
  await page.goto('/')
  await expectLinks(page, true)
  await expect(page.locator('#signed-in-user')).toContainText(name)
  await expect(page.locator('#signed-in-user img')).toHaveCount(0)
  await page.reload()
  await expectLinks(page, true)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-auth-change', { detail: null })))
  await expectLinks(page, false)
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-auth-change', {
    detail: { uid: 'password-user', providerData: [{ providerId: 'password' }] },
  })))
  await expectLinks(page, false)
  await expect(page.locator('#google-login')).toBeVisible()
})

test('popup and network errors leave activities hidden and allow retry', async ({ page }) => {
  await mockAuth(page)
  await page.goto('/')
  const cases = [
    ['auth/popup-closed-by-user', '로그인 창이 닫혔어요'],
    ['auth/popup-blocked', '팝업이 차단됐어요'],
    ['auth/unauthorized-domain', '사이트 주소 등록'],
    ['auth/network-request-failed', '인터넷 연결'],
  ]
  for (const [code, message] of cases) {
    await page.evaluate(code => { window.authTest.scenario.loginError = code }, code)
    await page.locator('#google-login').click()
    await expect(page.locator('#login-status')).toContainText(message)
    await expectLinks(page, false)
    await expect(page.locator('#google-login')).toBeEnabled()
  }
  await page.evaluate(() => { delete window.authTest.scenario.loginError })
  await page.locator('#google-login').click()
  await expectLinks(page, true)
})

test('failed logout restores links; successful retry hides them', async ({ page }) => {
  await mockAuth(page, { user: googleUser, holdLogout: true, logoutError: 'auth/network-request-failed' })
  await page.goto('/')
  await expectLinks(page, true)
  await page.locator('#google-logout').click()
  await expectLinks(page, false)
  await expect(page.locator('#google-logout')).toBeDisabled()
  await page.evaluate(() => window.dispatchEvent(new Event('test-logout-release')))
  await expect(page.locator('#login-status')).toContainText('로그아웃하지 못했어요')
  await expectLinks(page, true)
  await page.evaluate(() => {
    delete window.authTest.scenario.logoutError
    window.authTest.scenario.holdLogout = false
  })
  await page.locator('#google-logout').click()
  await expectLinks(page, false)
})

test('configuration and observer errors fail closed with helpful feedback', async ({ page }) => {
  await mockAuth(page, { configError: 'app/missing-config' })
  await page.goto('/')
  await expect(page.locator('#login-status')).toContainText('로그인 설정을 확인')
  await expect(page.locator('#google-login')).toBeDisabled()
  await expectLinks(page, false)
  await mockAuth(page, { observerError: 'auth/network-request-failed' })
  await page.reload()
  await expect(page.locator('#login-status')).toContainText('인터넷 연결')
  await expectLinks(page, false)
})
