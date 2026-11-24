import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { mockStudentAuth } from './helpers/studentAuth.js'

const endpoint = 'https://api.openai.com/v1/responses'
const fakeKey = 'sk-browser-test-placeholder'
const success = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] })

test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => { throw error })
  await mockStudentAuth(page)
})

async function mockOpenAI(page, reply = () => success('이야기해 줘서 고마워요. 어떤 마음이 들었나요?')) {
  const requests = []
  await page.route(endpoint, async route => {
    requests.push(route.request().postDataJSON())
    const response = await reply(requests.length, route)
    if (response === null) return
    await route.fulfill({ status: response.httpStatus ?? 200, json: response.body ?? response })
  })
  return requests
}

async function connect(page) {
  await page.goto('/student.html')
  await page.getByLabel('OpenAI API 키', { exact: true }).fill(fakeKey)
  await page.getByRole('button', { name: '키 확인하고 시작하기' }).click()
  await expect(page.locator('#activity-workspace')).toBeVisible()
}

async function sendTurn(page, turn, text = `${turn}번째 학교 이야기`) {
  await page.getByLabel('나의 이야기', { exact: true }).fill(text)
  await page.locator('#send-message').click()
  await expect(page.locator('#turn-counter')).toHaveText(`완료한 대화 ${turn} / 7회`)
}

async function openDrawing(page) {
  await mockOpenAI(page)
  await connect(page)
  for (let i = 1; i <= 3; i += 1) await sendTurn(page, i)
  await page.locator('#finish-chat').click()
  await expect(page.locator('#drawing-panel')).toBeVisible()
}

async function setSlider(page, id, value) {
  await page.locator(`#${id}`).evaluate((input, next) => {
    input.value = next
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }, String(value))
}

async function stroke(page, from, to) {
  const canvas = page.locator('#drawing-canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + from[0] * box.width, box.y + from[1] * box.height)
  await page.mouse.down()
  await page.mouse.move(box.x + to[0] * box.width, box.y + to[1] * box.height, { steps: 15 })
  await page.mouse.up()
}

async function pixel(page, x, y) {
  return page.locator('#drawing-canvas').evaluate((canvas, point) => [...canvas.getContext('2d').getImageData(Math.round(point[0] * canvas.width), Math.round(point[1] * canvas.height), 1, 1).data], [x, y])
}

function expectPixel(actual, expected) {
  for (let i = 0; i < 4; i += 1) expect(Math.abs(actual[i] - expected[i])).toBeLessThanOrEqual(2)
}

test('key validation gates activities; failed turns preserve text and do not count; three turns unlock drawing', async ({ page }) => {
  const requests = await mockOpenAI(page, call => {
    if (call === 1) return { httpStatus: 401, body: { error: { code: 'invalid_api_key' } } }
    if (call === 3) return { httpStatus: 500, body: { error: {} } }
    return success('오늘의 이야기를 들려주세요. <img src=x onerror="window.injected=true">')
  })
  await page.goto('/student.html')
  await expect(page.locator('#activity-workspace')).toBeHidden()
  await page.keyboard.press('Tab')
  await expect(page.locator('.skip-link')).toBeFocused()
  await expect(page.locator('.skip-link')).toBeInViewport()
  await page.keyboard.press('Tab')
  await page.screenshot({ path: 'test-results/student-key.png', fullPage: true })
  await page.locator('#api-key').fill(fakeKey)
  await page.locator('#verify-key').click()
  await expect(page.locator('#key-status')).toContainText('API 키를 확인할 수 없어요')
  await expect(page.locator('#activity-workspace')).toBeHidden()
  await page.locator('#api-key').fill(fakeKey)
  await page.locator('#verify-key').click()
  await expect(page.locator('#chat-panel')).toBeVisible()
  await expect(page.locator('.skip-link')).not.toBeInViewport()
  await expect(page.locator('#api-key')).toHaveValue('')
  await expect(page.locator('#finish-chat')).toBeDisabled()
  await page.locator('#chat-input').fill('수학이 어려웠어요.')
  await page.locator('#send-message').click()
  await expect(page.locator('#chat-status')).toContainText('OpenAI 연결이 원활하지 않아요')
  await expect(page.locator('#chat-input')).toHaveValue('수학이 어려웠어요.')
  await expect(page.locator('#turn-counter')).toHaveText('완료한 대화 0 / 7회')
  await expect(page.locator('#chat-messages .message-user')).toHaveCount(0)
  for (let i = 1; i <= 3; i += 1) {
    await sendTurn(page, i)
    if (i < 3) await expect(page.locator('#finish-chat')).toBeDisabled()
  }
  await expect(page.locator('#drawing-panel')).toBeHidden()
  await expect(page.locator('#finish-chat')).toBeEnabled()
  await expect(page.locator('#chat-messages img')).toHaveCount(0)
  expect(await page.evaluate(() => window.injected)).toBeUndefined()
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0])
  for (const body of requests) {
    expect(body.store).toBe(false)
    expect(body.model).toBe('gpt-5.4-mini')
    expect(JSON.stringify(body)).not.toContain(fakeKey)
  }
  await page.screenshot({ path: 'test-results/student-chat.png', fullPage: true })
  await page.locator('#finish-chat').click()
  await expect(page.locator('#chat-panel')).toBeHidden()
  await expect(page.locator('#drawing-panel')).toBeVisible()
  await expect(page.locator('#submit-drawing')).toBeDisabled()
})

test('pending replies block duplicates and finishing; seven completed turns require explicit finish', async ({ page }) => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const requests = await mockOpenAI(page, async call => {
    if (call === 2) await gate
    return success('함께 돌아봐서 좋았어요.')
  })
  await connect(page)
  await page.locator('#chat-input').fill('오늘 학교에서 있었던 일이에요.')
  await page.locator('#send-message').click()
  await expect.poll(() => requests.length).toBe(2)
  await expect(page.locator('#send-message')).toBeDisabled()
  await expect(page.locator('#finish-chat')).toBeDisabled()
  await page.locator('#chat-form').evaluate(form => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
  release()
  await expect(page.locator('#turn-counter')).toHaveText('완료한 대화 1 / 7회')
  for (let i = 2; i <= 7; i += 1) await sendTurn(page, i)
  expect(requests).toHaveLength(8)
  expect(requests.at(-1).input.filter(message => message.role === 'user')).toHaveLength(7)
  expect(requests.at(-1).instructions).toContain('새 질문을 하지 말고')
  await expect(page.locator('#chat-input')).toBeDisabled()
  await expect(page.locator('#send-message')).toBeDisabled()
  await expect(page.locator('#finish-chat')).toBeEnabled()
  await expect(page.locator('#drawing-panel')).toBeHidden()
  await page.locator('#chat-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true })))
  expect(requests).toHaveLength(8)
  await page.locator('#finish-chat').click()
  await expect(page.locator('#drawing-panel')).toBeVisible()
})

test('quota, incomplete and network errors do not advance a turn; changing keys retains history', async ({ page }) => {
  const requests = await mockOpenAI(page, async (call, route) => {
    if (call === 2) return { httpStatus: 429, body: { error: { code: 'insufficient_quota' } } }
    if (call === 3) return { status: 'incomplete', output: [] }
    if (call === 4) { await route.abort('failed'); return null }
    return success('차근차근 이야기해요.')
  })
  await connect(page)
  await page.locator('#chat-input').fill('친구와 함께 문제를 풀었어요.')
  for (const message of ['사용 한도가 부족', '끝까지 도착하지', '연결하지 못했']) {
    await page.locator('#send-message').click()
    await expect(page.locator('#chat-status')).toContainText(message)
    await expect(page.locator('#turn-counter')).toHaveText('완료한 대화 0 / 7회')
    await expect(page.locator('#chat-input')).not.toHaveValue('')
  }
  await page.locator('#send-message').click()
  await expect(page.locator('#turn-counter')).toHaveText('완료한 대화 1 / 7회')
  await page.locator('#change-key').click()
  await expect(page.locator('#activity-workspace')).toBeHidden()
  await page.locator('#api-key').fill('sk-replacement-test-placeholder')
  await page.locator('#verify-key').click()
  await expect(page.locator('#turn-counter')).toHaveText('완료한 대화 1 / 7회')
  await expect(page.locator('#chat-messages .message-user')).toHaveCount(1)
  await sendTurn(page, 2)
  expect(requests.at(-1).input.filter(message => message.role === 'user')).toHaveLength(2)
})

test('brush opacity, brightness, size, eraser, undo/redo, clear, resize and PNG export work', async ({ page }) => {
  await openDrawing(page)
  expectPixel(await pixel(page, 0.5, 0.3), [255, 255, 255, 255])
  await page.getByRole('radio', { name: '빨강', exact: true }).check()
  await setSlider(page, 'brush-size', 40)
  await setSlider(page, 'brush-opacity', 50)
  await expect(page.locator('#opacity-value')).toHaveText('50%')
  await stroke(page, [0.2, 0.3], [0.8, 0.3])
  for (const x of [0.3, 0.5, 0.7]) expectPixel(await pixel(page, x, 0.3), [226, 169, 166, 255])
  expectPixel(await pixel(page, 0.5, 0.3 + 15 / 800), [226, 169, 166, 255])
  expectPixel(await pixel(page, 0.5, 0.3 + 25 / 800), [255, 255, 255, 255])
  await setSlider(page, 'brush-opacity', 100)
  await setSlider(page, 'brush-brightness', 50)
  await stroke(page, [0.2, 0.5], [0.8, 0.5])
  expectPixel(await pixel(page, 0.5, 0.5), [99, 42, 39, 255])
  await page.locator('#undo-drawing').click()
  expectPixel(await pixel(page, 0.5, 0.5), [255, 255, 255, 255])
  await page.locator('#redo-drawing').click()
  expectPixel(await pixel(page, 0.5, 0.5), [99, 42, 39, 255])
  await page.locator('#eraser-tool').click()
  await expect(page.locator('#brush-opacity')).toBeDisabled()
  await stroke(page, [0.5, 0.2], [0.5, 0.6])
  expectPixel(await pixel(page, 0.5, 0.3), [255, 255, 255, 255])
  await page.locator('#clear-drawing').click()
  await page.locator('#cancel-clear').click()
  expectPixel(await pixel(page, 0.3, 0.3), [226, 169, 166, 255])
  await page.locator('#clear-drawing').click()
  await page.locator('#confirm-clear').click()
  expectPixel(await pixel(page, 0.3, 0.3), [255, 255, 255, 255])
  await expect(page.locator('#download-drawing')).toBeDisabled()
  await page.locator('#undo-drawing').click()
  const beforeResize = await page.locator('#drawing-canvas').evaluate(canvas => canvas.toDataURL())
  await page.screenshot({ path: 'test-results/student-drawing-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 375, height: 812 })
  expect(await page.locator('#drawing-canvas').evaluate(canvas => canvas.toDataURL())).toBe(beforeResize)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.locator('.skip-link')).not.toBeInViewport()
  await page.screenshot({ path: 'test-results/student-drawing-mobile.png', fullPage: true })
  await page.setViewportSize({ width: 320, height: 700 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await page.locator('#drawing-canvas').evaluate(canvas => canvas.toDataURL())).toBe(beforeResize)
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#download-drawing').click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/^my-day-\d{4}-\d{2}-\d{2}\.png$/)
  const png = await readFile(await download.path())
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
  expect(png.readUInt32BE(16)).toBe(1200)
  expect(png.readUInt32BE(20)).toBe(800)
  await expect(page.locator('#drawing-status')).toContainText('파일만 내려받아요')
  await expect(page.locator('#submit-drawing')).toBeEnabled()
})

test.describe('touch drawing', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })
  test('a finger tap creates a mark and reloading locks the activity again', async ({ page }) => {
    await openDrawing(page)
    const canvas = page.locator('#drawing-canvas')
    await canvas.scrollIntoViewIfNeeded()
    const box = await canvas.boundingBox()
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    expectPixel(await pixel(page, 0.5, 0.5), [48, 54, 64, 255])
    await expect(page.locator('#download-drawing')).toBeEnabled()
    page.on('dialog', dialog => dialog.accept())
    await page.reload()
    await expect(page.locator('#activity-workspace')).toBeHidden()
    await expect(page.locator('#api-key')).toHaveValue('')
  })
})
