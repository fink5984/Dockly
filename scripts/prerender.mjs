/**
 * Writes the static marketing pages into dist/.site after `vite build` and
 * `vite build --ssr src/marketing/entry-server.tsx`.
 *
 * Each page = the built marketing.html template (hashed CSS/JS links) + the
 * rendered body + head metadata. Deployment values (%%SITE_URL%%, legal name,
 * contact email) stay as placeholders and are filled in by server/site.mjs.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { pathToFileURL } from 'url'

const ROOT = resolve(import.meta.dirname, '..')
const DIST = join(ROOT, 'dist')
const OUT = join(DIST, '.site')
const templatePath = join(DIST, 'marketing.html')

const template = readFileSync(templatePath, 'utf8')
const { renderAll } = await import(pathToFileURL(join(ROOT, 'dist-ssr', 'entry-server.js')).href)

rmSync(OUT, { recursive: true, force: true })
let count = 0
for (const p of renderAll()) {
  const html = template
    .replace('%%LANG%%', p.lang)
    .replace('%%DIR%%', p.lang === 'he' ? 'rtl' : 'ltr')
    .replace('<!--mk-head-->', p.head)
    .replace('<!--mk-body-->', p.body)
  const file = join(OUT, p.file)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, html)
  count++
}
// The raw template must not be served on its own.
rmSync(templatePath)
rmSync(join(ROOT, 'dist-ssr'), { recursive: true, force: true })
console.log(`[prerender] wrote ${count} marketing pages to dist/.site`)
