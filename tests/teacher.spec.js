import { test, expect } from '@playwright/test'
import { mockAdminUids } from './helpers/adminUids.js'
import { mockStudentAuth, studentUser } from './helpers/studentAuth.js'

const records = [
  { id: 'morning', uid: 'student-a', displayName: '서연', email: 'a@example.com', submittedAtClient: Date.parse('2026-11-24T00:10:00Z'), chatDurationMs: 90000, drawingDurationMs: 120000, messages: [{ role: 'assistant', content: '오늘 어땠나요?' }, { role: 'user', content: '수학이 즐거웠어요.' }, { role: 'assistant', content: '어떤 순간이 좋았나요?' }] },
  { id: 'afternoon', uid: 'student-a', displayName: '서연', email: 'a@example.com', submittedAtClient: Date.parse('2026-11-24T03:20:00Z'), messages: [{ role: 'assistant', content: '두 번째 기록이에요.' }, { role: 'user', content: '<img src=x onerror="window.injected=true">' }] },
  { id: 'yesterday', uid: 'student-b', displayName: '민준', email: 'b@example.com', submittedAtClient: Date.parse('2026-11-23T14:30:00Z'), messages: [{ role: 'user', content: '친구와 공부했어요.' }] },
]

async function mockDashboard(page, options = {}) {
  await mockAdminUids(page, 'teacher-admin')
  await mockStudentAuth(page, { ...studentUser, uid: 'teacher-admin' })
  await page.route('**/src/teacherData.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const state = window.dashboardTest = { records: ${JSON.stringify(options.empty ? [] : records)}, options: ${JSON.stringify(options)}, reads: [], deletes: [], watchCalls: 0 };
      let notify;
      state.emit = records => { state.records = records; notify?.(records); };
      export const teacherData = {
        async watchActivities(next, error) {
          state.watchCalls++; notify = next;
          queueMicrotask(() => state.options.loadError ? error({ code: 'permission-denied' }) : next(state.records));
          return () => {};
        },
        async loadDrawing(record) {
          state.reads.push(record.id);
          if (state.options.holdImage === record.id) await new Promise(resolve => window.addEventListener('release-image', resolve, { once: true }));
          if (state.options.imageError) throw { code: 'storage/object-not-found' };
          const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 800;
          const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1200,800);
          ctx.strokeStyle = '#4b8c70'; ctx.lineWidth = 24; ctx.lineCap = 'round';
          ctx.beginPath(); ctx.moveTo(200,500); ctx.bezierCurveTo(350,100,700,700,1000,250); ctx.stroke();
          return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
        },
        async deleteActivity(record) {
          state.deletes.push(record.id);
          if (state.options.holdDelete) await new Promise(resolve => window.addEventListener('release-delete', resolve, { once: true }));
          if (state.options.deleteError) throw { code: 'permission-denied', partialDeletion: true };
          state.emit(state.records.filter(item => item.id !== record.id));
        },
      };
    `,
  }))
  await page.goto('/teacherMonitor.html')
  await expect(page.locator('#main-content')).toBeVisible()
  if (!options.empty && !options.loadError) await expect(page.locator('.activity-select')).toHaveCount(3)
}

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
})

test('shows all dates and each submission separately; multiple checkboxes filter records', async ({ page }) => {
  await mockDashboard(page)
  await expect(page.getByRole('checkbox', { name: '2026-11-24', exact: true })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: '2026-11-23', exact: true })).toBeChecked()
  await expect(page.locator('.activity-select').nth(0)).toHaveText('서연 (2026-11-24 12:20:00)')
  await expect(page.locator('.activity-select').nth(1)).toHaveText('서연 (2026-11-24 09:10:00)')
  await page.getByRole('checkbox', { name: '2026-11-24', exact: true }).uncheck()
  await expect(page.locator('.activity-select')).toHaveCount(1)
  await expect(page.locator('.activity-select')).toHaveText('민준 (2026-11-23 23:30:00)')
  await page.locator('#clear-all-dates').click()
  await expect(page.locator('.activity-select')).toHaveCount(0)
  await expect(page.locator('#activity-list-status')).toContainText('날짜를 선택')
  await page.locator('#select-all-dates').click()
  await expect(page.locator('.activity-select')).toHaveCount(3)
})

test('displays full conversations, durations and PNG; fast switching never shows a stale image', async ({ page }) => {
  await mockDashboard(page, { holdImage: 'morning' })
  await page.getByRole('button', { name: '서연 (2026-11-24 09:10:00)', exact: true }).click()
  await expect(page.getByRole('button', { name: '서연 (2026-11-24 09:10:00)', exact: true })).toBeFocused()
  await expect(page.locator('.monitor-message')).toHaveCount(3)
  await expect(page.locator('#selected-chat-duration')).toHaveText('1분 30초')
  await expect(page.locator('#selected-drawing-duration')).toHaveText('2분 0초')
  await expect(page.locator('#teacher-image-status')).toContainText('불러오고')
  await page.getByRole('button', { name: '서연 (2026-11-24 12:20:00)', exact: true }).click()
  await expect(page.locator('#teacher-drawing-image')).toBeVisible()
  await expect(page.locator('#teacher-drawing-image')).toHaveAttribute('alt', /12:20:00/)
  await expect(page.locator('#teacher-messages img')).toHaveCount(0)
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
  await page.evaluate(() => window.dispatchEvent(new Event('release-image')))
  await expect(page.locator('#teacher-drawing-image')).toHaveAttribute('alt', /12:20:00/)
  await page.getByRole('button', { name: '민준 (2026-11-23 23:30:00)', exact: true }).click()
  await expect(page.locator('#selected-activity-email')).toHaveText('b@example.com')
  await expect(page.locator('#teacher-drawing-image')).toHaveAttribute('alt', /민준/)
  await page.screenshot({ path: 'test-results/teacher-dashboard-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/teacher-dashboard-mobile.png', fullPage: true })
})

test('live updates preserve manual filters; removing the selected record clears its conversation and image', async ({ page }) => {
  await mockDashboard(page)
  await page.getByRole('checkbox', { name: '2026-11-24', exact: true }).uncheck()
  await page.getByRole('button', { name: '민준 (2026-11-23 23:30:00)', exact: true }).click()
  await page.evaluate(() => {
    const state = window.dashboardTest
    state.emit([...state.records, { ...state.records[0], id: 'new-day', submittedAtClient: Date.parse('2026-11-25T01:00:00Z') }])
  })
  await expect(page.getByRole('checkbox', { name: '2026-11-25', exact: true })).not.toBeChecked()
  await expect(page.locator('.activity-select')).toHaveCount(1)
  await page.evaluate(() => window.dashboardTest.emit(window.dashboardTest.records.filter(record => record.id !== 'yesterday')))
  await expect(page.locator('#selected-activity-label')).toContainText('선택해 주세요')
  await expect(page.locator('#teacher-drawing-image')).toBeHidden()
  await expect(page.getByRole('checkbox', { name: '2026-11-23', exact: true })).toHaveCount(0)
})

test('deletion requires confirmation, blocks duplicate clicks and supports partial-failure retry', async ({ page }) => {
  await mockDashboard(page, { holdDelete: true, deleteError: true })
  const remove = page.getByRole('button', { name: '민준 (2026-11-23 23:30:00) 기록 삭제', exact: true })
  await remove.click()
  await page.locator('#cancel-delete-activity').click()
  expect(await page.evaluate(() => window.dashboardTest.deletes)).toEqual([])
  await remove.click()
  await page.locator('#confirm-delete-activity').click()
  await expect(page.locator('#confirm-delete-activity')).toBeDisabled()
  await page.locator('#confirm-delete-activity').dispatchEvent('click')
  expect(await page.evaluate(() => window.dashboardTest.deletes)).toEqual(['yesterday'])
  await page.evaluate(() => window.dispatchEvent(new Event('release-delete')))
  await expect(page.locator('#delete-dialog-status')).toContainText('그림은 삭제했지만')
  await expect(page.locator('.activity-select')).toHaveCount(3)
  await page.evaluate(() => { window.dashboardTest.options.holdDelete = false; window.dashboardTest.options.deleteError = false })
  await page.locator('#confirm-delete-activity').click()
  await expect(page.locator('#delete-activity-dialog')).not.toBeVisible()
  await expect(page.locator('.activity-select')).toHaveCount(2)
  await expect(page.locator('#teacher-action-status')).toContainText('삭제했어요')
  await expect(page.getByRole('checkbox', { name: '2026-11-23', exact: true })).toHaveCount(0)
})

test('empty, permission-error and missing-image states provide recovery actions', async ({ page }) => {
  await mockDashboard(page, { empty: true, loadError: true })
  await expect(page.locator('#activity-list-status')).toContainText('조회 권한이 없어요')
  await page.evaluate(records => { window.dashboardTest.options.loadError = false; window.dashboardTest.records = records }, records)
  await page.locator('#refresh-activities').click()
  await expect(page.locator('.activity-select')).toHaveCount(3)
  await page.evaluate(() => { window.dashboardTest.options.imageError = true })
  await page.getByRole('button', { name: '민준 (2026-11-23 23:30:00)', exact: true }).click()
  await expect(page.locator('#teacher-image-status')).toContainText('그림을 찾을 수 없어요')
  await page.evaluate(() => { window.dashboardTest.options.imageError = false })
  await page.locator('#retry-teacher-image').click()
  await expect(page.locator('#teacher-drawing-image')).toBeVisible()
  await page.evaluate(() => window.dashboardTest.emit([]))
  await expect(page.locator('#activity-list-status')).toContainText('아직 제출된 활동이 없어요')
  await expect(page.locator('#select-all-dates')).toBeDisabled()
})
