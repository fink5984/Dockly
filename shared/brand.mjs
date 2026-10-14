/**
 * Sadir brand constants shared by the server (emails, PDFs, billing labels)
 * and the UI/marketing build. CSS design tokens live in src/styles/tokens.css
 * and must stay in sync with `colors` below.
 */
export const BRAND = Object.freeze({
  name: 'Sadir',
  colors: Object.freeze({
    /** UI primary: buttons, links, focus. White text passes WCAG AA on it. */
    primary: '#5B4DFF',
    secondary: '#7B6CFF',
    /** Wordmark navy, sampled from the logo. */
    ink: '#11103C',
    /** Soft lavender surface accent. */
    soft: '#F6F4FF',
    /** Logo gradient endpoints (electric indigo → violet) and fold shadow. */
    indigo: '#3027FD',
    violet: '#5B2EFC',
    lavender: '#B49CFD',
    deep: '#141364',
  }),
  assets: Object.freeze({
    logo: '/brand/sadir-logo.svg',
    logoOnDark: '/brand/sadir-logo-light.svg',
    mark: '/brand/sadir-mark.svg',
    favicon: '/brand/favicon.svg',
    /** Square raster icon (structured data, app manifests). */
    icon: '/brand/icon-512.png',
    ogImage: '/brand/og-image.png',
  }),
})
