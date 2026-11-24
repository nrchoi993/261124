export const studentUser = {
  uid: 'student-test-uid',
  displayName: '테스트 학생',
  email: 'student@example.com',
  providerData: [{ providerId: 'google.com', displayName: '테스트 학생', email: 'student@example.com' }],
}

export async function mockStudentAuth(page, user = studentUser) {
  await page.route('**/src/firebaseAuth.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      export function watchAuthState(onChange) {
        queueMicrotask(() => onChange(${JSON.stringify(user)}));
        window.addEventListener('test-student-auth', event => onChange(event.detail));
        return () => {};
      }
    `,
  }))
}
