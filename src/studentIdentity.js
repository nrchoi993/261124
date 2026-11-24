export function googleProfile(user) {
  const google = user?.providerData?.find(provider => provider.providerId === 'google.com')
  if (!user?.uid || !google) return null
  const email = google.email || user.email
  if (!email) return null
  return { uid: user.uid, displayName: google.displayName || user.displayName || '', email }
}
