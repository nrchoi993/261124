export const studentUser = {
  uid: 'student-test-uid',
  displayName: '테스트 학생',
  email: 'student@example.com',
  providerData: [{ providerId: 'google.com', displayName: '테스트 학생', email: 'student@example.com' }],
}

export async function mockStudentAuth(page, user = studentUser, options = {}) {
  await page.route('**/src/firebaseAuth.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `
      const options = ${JSON.stringify(options)};
      export function watchAuthState(onChange, onError) {
        if (options.configError) throw { code: 'app/missing-config' };
        const ready = () => options.observerError ? onError({ code: 'auth/network-request-failed' }) : onChange(${JSON.stringify(user)});
        if (options.holdInitial) window.addEventListener('test-auth-ready', ready, { once: true });
        else queueMicrotask(ready);
        window.addEventListener('test-student-auth', event => onChange(event.detail));
        return () => {};
      }
      export async function signInWithGoogle() {
        window.dispatchEvent(new CustomEvent('test-student-auth', { detail: ${JSON.stringify(user ?? studentUser)} }));
      }
      export async function signOutOfGoogle() {
        window.dispatchEvent(new CustomEvent('test-student-auth', { detail: null }));
      }
    `,
  }))
}
