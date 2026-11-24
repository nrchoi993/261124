import { readFile } from 'node:fs/promises'

// 실제 UID 판별 코드를 유지하고 환경 변수 값만 테스트별로 바꿉니다.
export async function mockAdminUids(page, value = '') {
  const source = await readFile(new URL('../../src/accessControl.js', import.meta.url), 'utf8')
  const marker = /^const configuredAdminUids = .*$/m
  if (!marker.test(source)) throw new Error('Administrator configuration binding was not found')
  await page.route('**/src/accessControl.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: source.replace(marker, `const configuredAdminUids = parseAdminUids(${JSON.stringify(value)});`),
  }))
}
