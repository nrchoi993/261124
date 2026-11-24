// UID는 대소문자를 구분하며, 쉼표 또는 공백으로 여러 개를 등록할 수 있습니다.
export function parseAdminUids(value) {
  return new Set(String(value ?? '').split(/[,\s]+/).filter(Boolean))
}

const configuredAdminUids = parseAdminUids(import.meta.env?.VITE_ADMIN_UIDS)

export function isGoogleUser(user) {
  return Boolean(user?.uid && user.providerData?.some(provider => provider.providerId === 'google.com'))
}

export function isAdmin(user, adminUids = configuredAdminUids) {
  return isGoogleUser(user) && adminUids.has(user.uid)
}
