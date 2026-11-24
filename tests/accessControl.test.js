import test from 'node:test'
import assert from 'node:assert/strict'
import { parseAdminUids, isAdmin } from '../src/accessControl.js'

const googleUser = uid => ({ uid, providerData: [{ providerId: 'google.com' }] })

test('accepts multiple comma/whitespace-separated UIDs and ignores duplicates and blanks', () => {
  const admins = parseAdminUids('  first-UID, second-UID,\n\tfirst-UID  third-UID , ')
  assert.deepEqual([...admins], ['first-UID', 'second-UID', 'third-UID'])
  for (const uid of admins) assert.equal(isAdmin(googleUser(uid), admins), true)
})

test('matches entire case-sensitive UIDs and requires a Google user', () => {
  const admins = parseAdminUids('Admin-UID,Another-UID')
  for (const uid of ['Admin', 'admin-uid', 'Admin-UID-extra', '', undefined]) {
    assert.equal(isAdmin(googleUser(uid), admins), false)
  }
  assert.equal(isAdmin(null, admins), false)
  assert.equal(isAdmin({ uid: 'Admin-UID', providerData: [{ providerId: 'password' }] }, admins), false)
})

test('missing or empty configuration grants no administrative access', () => {
  for (const value of [undefined, null, '', ' , ,\n ']) {
    assert.equal(isAdmin(googleUser('Admin-UID'), parseAdminUids(value)), false)
  }
})
