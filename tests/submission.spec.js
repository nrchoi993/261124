import { test, expect } from '@playwright/test'
import { mockStudentAuth, studentUser } from './helpers/studentAuth.js'

async function mockServices(page, { hold = false, fail = false } = {}) {
  await mockStudentAuth(page)
  await page.route('https://api.openai.com/v1/responses', route => route.fulfill({ json: {
    status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '이야기해 줘서 고마워요.' }] }],
  } }))
  await page.route('**/src/studentSubmission.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      window.submissionTest = { calls: [], hold: ${hold}, fail: ${fail} };
      export async function submitStudentActivity(snapshot) {
        const { png, ...data } = snapshot;
        window.submissionTest.calls.push({ ...data, pngType: png.type, pngSize: png.size });
        if (window.submissionTest.hold) await new Promise(resolve => window.addEventListener('test-submit-release', resolve, { once: true }));
        if (window.submissionTest.fail) throw { code: 'permission-denied' };
        return { id: snapshot.id, path: 'studentActivities/' + snapshot.user.uid + '/' + snapshot.id + '.png' };
      }
    `,
  }))
}

async function connect(page) {
  await page.goto('/student.html')
  await expect(page.locator('#student-profile')).toBeVisible()
  await page.locator('#api-key').fill('sk-test-placeholder')
  await page.locator('#verify-key').click()
  await expect(page.locator('#activity-workspace')).toBeVisible()
}

async function turn(page, count) {
  await page.locator('#chat-input').fill(`${count}번째 이야기예요.`)
  await page.locator('#send-message').click()
  await expect(page.locator('#turn-counter')).toHaveText(`완료한 대화 ${count} / 7회`)
}

async function draw(page) {
  await page.locator('#drawing-canvas').scrollIntoViewIfNeeded()
  const box = await page.locator('#drawing-canvas').boundingBox()
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 10 })
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
})

test('shows Google name/email and blocks unauthenticated direct access', async ({ page }) => {
  await mockStudentAuth(page, null)
  await page.goto('/student.html')
  await expect(page.locator('#student-auth-status')).toContainText('Google 로그인이 필요')
  await expect(page.locator('#key-panel')).toBeHidden()
  await expect(page.locator('#activity-workspace')).toBeHidden()
  await expect(page.locator('#student-login-link')).toBeVisible()
  await page.evaluate(user => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: user })), studentUser)
  await expect(page.locator('#student-name')).toHaveText(studentUser.displayName)
  await expect(page.locator('#student-email')).toHaveText(studentUser.email)
  await expect(page.locator('#key-panel')).toBeVisible()
})

test('records exact activity boundaries, freezes retries, prevents duplicate submissions, then confirms both stores', async ({ page }) => {
  await mockServices(page, { hold: true, fail: true })
  const initial = new Date('2026-11-24T10:00:00+09:00').getTime()
  await page.clock.setFixedTime(initial)
  await connect(page)
  const firstSend = initial + 600000
  await page.clock.setFixedTime(firstSend)
  await turn(page, 1)
  await page.clock.setFixedTime(firstSend + 20000)
  await turn(page, 2)
  await page.clock.setFixedTime(firstSend + 40000)
  await turn(page, 3)
  await page.clock.setFixedTime(firstSend + 90000)
  await page.locator('#finish-chat').click()
  await expect(page.locator('#submit-drawing')).toBeDisabled()
  await draw(page)
  await page.clock.setFixedTime(firstSend + 210000)
  await page.locator('#submit-drawing').click()
  await expect(page.locator('#submit-drawing')).toHaveText('제출 중…')
  await expect(page.locator('.drawing-layout')).toHaveAttribute('inert', '')
  await expect.poll(() => page.evaluate(() => window.submissionTest?.calls.length)).toBe(1)
  await page.locator('#submit-drawing').dispatchEvent('click')
  const first = await page.evaluate(() => window.submissionTest.calls[0])
  expect(first.user).toEqual({ uid: studentUser.uid, displayName: studentUser.displayName, email: studentUser.email })
  expect(first.messages).toHaveLength(7)
  expect(first.messages.filter(message => message.role === 'user')).toHaveLength(3)
  expect(first.chatStartedAt).toBe(firstSend)
  expect(first.chatEndedAt - first.chatStartedAt).toBe(90000)
  expect(first.submittedAtClient - first.chatEndedAt).toBe(120000)
  expect(first.pngType).toBe('image/png')
  expect(first.pngSize).toBeGreaterThan(0)
  expect(JSON.stringify(first)).not.toContain('sk-test-placeholder')
  await page.clock.setFixedTime(firstSend + 300000)
  await page.evaluate(() => window.dispatchEvent(new Event('test-submit-release')))
  await expect(page.locator('#submission-status')).toContainText('저장 권한이 없어요')
  await expect(page.locator('#submit-drawing')).toHaveText('다시 제출하기')
  await expect(page.locator('#submit-drawing')).toBeEnabled()
  await expect(page.locator('.drawing-layout')).toHaveAttribute('inert', '')
  await page.evaluate(() => { window.submissionTest.fail = false; window.submissionTest.hold = false })
  await page.locator('#submit-drawing').click()
  await expect(page.locator('#submit-drawing')).toHaveText('제출 완료')
  await expect(page.locator('#submit-drawing')).toBeDisabled()
  await expect(page.locator('#submission-status')).toContainText('모두 제출했어요')
  expect(await page.evaluate(() => window.submissionTest.calls)).toEqual([first, first])
  await page.locator('#submit-drawing').dispatchEvent('click')
  expect(await page.evaluate(() => window.submissionTest.calls.length)).toBe(2)
  await page.screenshot({ path: 'test-results/submission-completed.png', fullPage: true })
  // 제출이 끝나면 페이지를 닫을 때 미저장 경고를 표시하지 않습니다.
  page.on('dialog', () => { throw new Error('Unexpected unsaved changes warning after submission') })
  await page.reload()
})

test('switching accounts hides the activity and prevents saving another students work', async ({ page }) => {
  await mockServices(page)
  await connect(page)
  for (let i = 1; i <= 3; i += 1) await turn(page, i)
  await page.locator('#finish-chat').click()
  await draw(page)
  await page.evaluate(user => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: user })), { ...studentUser, uid: 'other-uid' })
  await expect(page.locator('#student-auth-status')).toContainText('활동을 시작한 Google 계정')
  await expect(page.locator('#activity-workspace')).toBeHidden()
  await page.locator('#submit-drawing').dispatchEvent('click')
  expect(await page.evaluate(() => window.submissionTest?.calls.length ?? 0)).toBe(0)
  await page.evaluate(user => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: user })), studentUser)
  await expect(page.locator('#drawing-panel')).toBeVisible()
  await expect(page.locator('#submit-drawing')).toBeEnabled()
  await page.locator('#submit-drawing').click()
  await expect(page.locator('#submission-status')).toContainText('모두 제출했어요')
})
