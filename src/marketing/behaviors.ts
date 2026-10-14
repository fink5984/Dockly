/**
 * Progressive enhancement for the marketing pages. Everything works without
 * it; this adds pricing toggles, closes the mobile menu after navigation,
 * keeps the plan a visitor picked for signup, and sends privacy-first page
 * views (see server/lib/funnel.mjs).
 */
const SID_KEY = 'dockly-sid'
const ATTR_KEY = 'dockly-attr'
const INTENT_KEY = 'dockly-intent'

const ss = {
  get(k: string) { try { return sessionStorage.getItem(k) } catch { return null } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v) } catch { /* private mode */ } },
}

/** Random id that lives only for this browser tab — not a cookie, not persistent. */
export function sessionId() {
  let id = ss.get(SID_KEY)
  if (!id) {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    ss.set(SID_KEY, id)
  }
  return id
}

function trackingAllowed() {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string }
  return !(nav.globalPrivacyControl || nav.doNotTrack === '1')
}

function device() {
  const w = window.innerWidth
  return w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop'
}

const sent = new Set<string>()
export function track(event: 'landing_visit' | 'pricing_viewed', lang: string) {
  if (!trackingAllowed() || sent.has(event) || ss.get(`dockly-ev-${event}`)) return
  sent.add(event)
  ss.set(`dockly-ev-${event}`, '1')
  const attr = attribution()
  const body = JSON.stringify({ event, sessionId: sessionId(), props: { lang, device: device(), page: location.pathname.slice(0, 60), ...attr } })
  const blob = new Blob([body], { type: 'application/json' })
  if (!navigator.sendBeacon?.('/api/public/events', blob)) {
    fetch('/api/public/events', { method: 'POST', body, headers: { 'Content-Type': 'application/json' }, keepalive: true }).catch(() => {})
  }
}

/** First-touch UTM tags for this tab, carried into signup. */
export function attribution(): Record<string, string> {
  const stored = ss.get(ATTR_KEY)
  if (stored) { try { return JSON.parse(stored) } catch { /* fall through */ } }
  const q = new URLSearchParams(location.search)
  const out: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) {
    const v = q.get(k)
    if (v && /^[\w.-]{1,60}$/.test(v)) out[k] = v
  }
  ss.set(ATTR_KEY, JSON.stringify(out))
  return out
}

export function rememberPlanIntent(plan: string, interval: string) {
  if (/^[a-z0-9_]{1,40}$/.test(plan) && /^(month|year)$/.test(interval)) ss.set(INTENT_KEY, JSON.stringify({ plan, interval }))
}

export function initMarketing(root: ParentNode = document, { page, lang }: { page: string; lang: string }) {
  const cleanups: (() => void)[] = []
  const on = (el: EventTarget, type: string, fn: EventListener) => { el.addEventListener(type, fn); cleanups.push(() => el.removeEventListener(type, fn)) }

  // Pricing toggles (radio groups) → data attributes on the wrapper.
  root.querySelectorAll<HTMLElement>('.mk-pricing').forEach((wrap) => {
    wrap.querySelectorAll<HTMLElement>('[data-toggle]').forEach((group) => {
      const name = group.dataset.toggle!
      const buttons = Array.from(group.querySelectorAll<HTMLButtonElement>('[role=radio]'))
      const select = (btn: HTMLButtonElement, focus = false) => {
        wrap.dataset[name] = btn.dataset.value!
        buttons.forEach((b) => { b.setAttribute('aria-checked', String(b === btn)); b.tabIndex = b === btn ? 0 : -1 })
        if (focus) btn.focus()
      }
      buttons.forEach((b, i) => {
        b.tabIndex = i === 0 ? 0 : -1
        on(b, 'click', () => select(b))
        on(b, 'keydown', (e) => {
          const k = (e as KeyboardEvent).key
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) return
          e.preventDefault()
          const rtl = getComputedStyle(group).direction === 'rtl'
          const forward = k === 'ArrowDown' || (k === 'ArrowRight') !== rtl
          select(buttons[(i + (forward ? 1 : buttons.length - 1)) % buttons.length], true)
        })
      })
    })
  })

  // Keep the plan a visitor chose for after signup.
  root.querySelectorAll<HTMLAnchorElement>('a[data-plan]').forEach((a) => on(a, 'click', () => rememberPlanIntent(a.dataset.plan!, a.dataset.planInterval || 'month')))

  // Close the mobile menu after choosing a link.
  root.querySelectorAll<HTMLDetailsElement>('details.mk-menu').forEach((d) => {
    d.querySelectorAll('a').forEach((a) => on(a, 'click', () => { d.open = false }))
    on(document, 'keydown', (e) => { if ((e as KeyboardEvent).key === 'Escape') d.open = false })
  })

  root.querySelectorAll<HTMLElement>('[data-year]').forEach((el) => { el.textContent = String(new Date().getFullYear()) })

  // Funnel: landing visit, and pricing viewed (pricing page, or the pricing section scrolled into view).
  attribution()
  if (page === 'home') track('landing_visit', lang)
  if (page === 'pricing') track('pricing_viewed', lang)
  const pricing = root.querySelector('.mk-track-pricing')
  if (pricing && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { track('pricing_viewed', lang); io.disconnect() }
    }, { threshold: 0.3 })
    io.observe(pricing)
    cleanups.push(() => io.disconnect())
  }

  return () => cleanups.forEach((c) => c())
}
