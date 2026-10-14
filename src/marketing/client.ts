/** Entry for the prerendered marketing pages (marketing.html): styles + progressive enhancement. */
import './marketing.css'
import { initMarketing } from './behaviors'

const root = document.querySelector<HTMLElement>('[data-mk-page]')
if (root) initMarketing(document, { page: root.dataset.mkPage!, lang: document.documentElement.lang })
