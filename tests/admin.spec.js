import { test, expect } from '@playwright/test'
import { mockAdminUids } from './helpers/adminUids.js'
import { mockStudentAuth, studentUser } from './helpers/studentAuth.js'

const firstAdmin = { ...studentUser, uid: 'first-admin' }
const secondAdmin = { ...studentUser, uid: 'second-admin' }
const uidList = 'first-admin, second-admin'
const teacherLink = page => page.locator('a[href="/teacherMonitor.html"]')

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
})

test('only configured Google admins see the teacher button, including live account changes', async ({ page }) => {
  await mockAdminUids(page, uidList)
  await mockStudentAuth(page, studentUser)
  await page.goto('/')
  await expect(page.locator('a[href="/student.html"]')).toBeVisible()
  await expect(teacherLink(page)).toBeHidden()
  for (const admin of [firstAdmin, secondAdmin]) {
    await page.evaluate(user => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: user })), admin)
    await expect(teacherLink(page)).toBeVisible()
  }
  await page.evaluate(user => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: user })), studentUser)
  await expect(teacherLink(page)).toBeHidden()
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: null })))
  await expect(teacherLink(page)).toBeHidden()
  await expect(page.locator('a[href="/student.html"]')).toBeHidden()
})

for (const admin of [firstAdmin, secondAdmin]) {
  test(`allows configured administrator ${admin.uid} to open teacher monitoring`, async ({ page }) => {
    await mockAdminUids(page, uidList)
    await mockStudentAuth(page, admin, { holdInitial: true })
    await page.goto('/teacherMonitor.html')
    await expect(page.locator('#main-content')).toBeHidden()
    await expect(page.locator('#teacher-access-status')).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('test-auth-ready')))
    await expect(page.locator('#main-content')).toBeVisible()
    await expect(page.locator('#teacher-access-status')).toBeHidden()
    await expect(page).toHaveURL(/\/teacherMonitor\.html$/)
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('test-student-auth', { detail: null })))
    await expect(page).toHaveURL(/\/$/)
    await page.waitForLoadState('load')
  })
}

for (const [name, user] of [
  ['anonymous visitor', null],
  ['non-admin Google user', studentUser],
  ['partial UID match', { ...studentUser, uid: 'first-admin-extra' }],
  ['non-Google account with matching UID', { uid: firstAdmin.uid, providerData: [{ providerId: 'password' }] }],
]) {
  test(`returns ${name} directly to the main page`, async ({ page }) => {
    await mockAdminUids(page, uidList)
    await mockStudentAuth(page, user)
    await page.goto('/teacherMonitor.html')
    await expect(page).toHaveURL(/\/$/)
    await expect(teacherLink(page)).toBeHidden()
  })
}

test('empty administrator configuration denies every user', async ({ page }) => {
  await mockAdminUids(page, '')
  await mockStudentAuth(page, firstAdmin)
  await page.goto('/')
  await expect(page.locator('a[href="/student.html"]')).toBeVisible()
  await expect(teacherLink(page)).toBeHidden()
  await page.goto('/teacherMonitor.html')
  await expect(page).toHaveURL(/\/$/)
})

for (const options of [{ observerError: true }, { configError: true }]) {
  test(`authentication failure returns to main: ${Object.keys(options)[0]}`, async ({ page }) => {
    await mockAdminUids(page, uidList)
    await mockStudentAuth(page, firstAdmin, options)
    await page.goto('/teacherMonitor.html')
    await expect(page).toHaveURL(/\/$/)
    await expect(teacherLink(page)).toBeHidden()
  })
}
