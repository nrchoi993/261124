import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { parseAdminUids } from '../src/accessControl.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = loadEnv(process.env.NODE_ENV === 'development' ? 'development' : 'production', root, 'VITE_')
const uids = [...parseAdminUids(process.env.VITE_ADMIN_UIDS ?? env.VITE_ADMIN_UIDS)]
const marker = /(^[ \t]*\/\/ admin-uids:start)[\s\S]*?(^[ \t]*\/\/ admin-uids:end)/m

for (const name of ['firestore.rules', 'storage.rules']) {
  const file = new URL(`../${name}`, import.meta.url)
  const source = await readFile(file, 'utf8')
  if (!marker.test(source)) throw new Error(`Administrator UID markers are missing in ${name}`)
  const updated = source.replace(marker, (_, start, end) => {
    const indent = start.match(/^[ \t]*/)[0]
    return `${start}\n${uids.map(uid => `${indent}${JSON.stringify(uid)}`).join(',\n')}${uids.length ? '\n' : ''}${end}`
  })
  if (updated !== source) await writeFile(file, updated, 'utf8')
}
console.log(`Firebase rules generated for ${uids.length} administrator(s). Publish these rules in Firebase to apply them.`)
