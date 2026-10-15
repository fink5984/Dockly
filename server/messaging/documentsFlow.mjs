/**
 * WhatsApp Flow JSON for document collection. One Flow serves every request:
 * all case-specific content comes from the endpoint (see whatsappFlow.mjs),
 * so the Flow is published once and never needs per-request copies.
 *
 *   WELCOME ──► DOC ──► DONE          DOC / DOC_FILE re-render themselves
 *      │         │                    with the next document after each
 *      └──► DOC_FILE ──► DONE         upload (a refresh, not a route).
 *
 * Meta allows one media picker per screen and only forward routes, so
 * photos (camera or gallery) and files (PDF / images) are separate screens;
 * once a client switches to files they stay on DOC_FILE.
 *
 * Text is pre-composed by the endpoint and bound whole (`${data.x}`).
 * Publish with: node scripts/whatsapp-flow-setup.mjs create | update
 */
export const FLOW_SCREENS = { welcome: 'WELCOME', photo: 'DOC', file: 'DOC_FILE', done: 'DONE' }

const docData = {
  doc_id: { type: 'string', __example__: '00000000-0000-0000-0000-000000000000' },
  heading: { type: 'string', __example__: 'תלוש שכר' },
  details: { type: 'string', __example__: 'שלושת התלושים האחרונים.' },
  progress: { type: 'string', __example__: 'מסמך 1 מתוך 3' },
  can_skip: { type: 'boolean', __example__: false },
  sent_count: { type: 'number', __example__: 0 },
}

// WhatsApp only forwards payload values bound to data or form fields; static
// strings (e.g. { cmd: 'skip' }) never reach the endpoint. So each button
// marks itself with its own key carrying a bound value, and the endpoint
// reads the command from which key is present (see whatsappFlow.mjs).
const docActionPayload = (marker, extra = {}) => ({
  doc_id: '${data.doc_id}',
  sent_count: '${data.sent_count}',
  ...(marker ? { [marker]: '${data.doc_id}' } : {}),
  ...extra,
})

const skipLink = {
  type: 'EmbeddedLink',
  text: 'דילוג על מסמך זה',
  visible: '${data.can_skip}',
  'on-click-action': { name: 'data_exchange', payload: docActionPayload('skip') },
}

const docHeader = [
  { type: 'TextCaption', text: '${data.progress}' },
  { type: 'TextHeading', text: '${data.heading}' },
  { type: 'TextBody', text: '${data.details}', markdown: true },
]

export const documentsFlow = {
  version: '6.3',
  data_api_version: '3.0',
  routing_model: {
    WELCOME: ['DOC', 'DOC_FILE', 'DONE'],
    DOC: ['DOC_FILE', 'DONE'],
    DOC_FILE: ['DONE'],
    DONE: [],
  },
  screens: [
    {
      id: 'WELCOME',
      title: 'העלאת מסמכים',
      data: {
        heading: { type: 'string', __example__: 'משרד כהן ושות\'' },
        intro: { type: 'string', __example__: 'שלום דנה 👋' },
        docs_text: { type: 'string', __example__: '⏳ תלוש שכר' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.heading}' },
          { type: 'TextBody', text: '${data.intro}', markdown: true },
          { type: 'TextBody', text: '${data.docs_text}', markdown: true },
          { type: 'TextCaption', text: '🔒 הקבצים מועברים מוצפנים ישירות למשרד.' },
          { type: 'Footer', label: 'התחלה', 'on-click-action': { name: 'data_exchange', payload: { start: '${data.heading}' } } },
        ],
      },
    },
    {
      id: 'DOC',
      title: 'העלאת מסמכים',
      data: docData,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          ...docHeader,
          {
            type: 'PhotoPicker',
            name: 'photos',
            label: 'צילום המסמך',
            description: 'אפשר לצלם או לבחור מהגלריה, עד 10 עמודים. כל העמודים יאוחדו לקובץ אחד.',
            'photo-source': 'camera_gallery',
            'min-uploaded-photos': 0,
            'max-uploaded-photos': 10,
            'max-file-size-kb': 25600,
          },
          {
            type: 'EmbeddedLink',
            text: 'יש לי קובץ PDF',
            'on-click-action': { name: 'data_exchange', payload: docActionPayload('use_file') },
          },
          skipLink,
          {
            type: 'Footer',
            label: 'העלאה והמשך',
            'on-click-action': { name: 'data_exchange', payload: docActionPayload(null, { photos: '${form.photos}' }) },
          },
        ],
      },
    },
    {
      id: 'DOC_FILE',
      title: 'העלאת מסמכים',
      data: docData,
      layout: {
        type: 'SingleColumnLayout',
        children: [
          ...docHeader,
          {
            type: 'DocumentPicker',
            name: 'files',
            label: 'בחירת קובץ',
            description: 'PDF או תמונה, עד 10 קבצים. כמה קבצים יאוחדו לקובץ אחד.',
            'min-uploaded-documents': 0,
            'max-uploaded-documents': 10,
            'max-file-size-kb': 25600,
            'allowed-mime-types': ['application/pdf', 'image/jpeg', 'image/png'],
          },
          skipLink,
          {
            type: 'Footer',
            label: 'העלאה והמשך',
            'on-click-action': { name: 'data_exchange', payload: docActionPayload(null, { files: '${form.files}' }) },
          },
        ],
      },
    },
    {
      id: 'DONE',
      title: 'העלאת מסמכים',
      terminal: true,
      success: true,
      data: {
        heading: { type: 'string', __example__: '🎉 תודה!' },
        summary: { type: 'string', __example__: 'המסמכים התקבלו.' },
      },
      layout: {
        type: 'SingleColumnLayout',
        children: [
          { type: 'TextHeading', text: '${data.heading}' },
          { type: 'TextBody', text: '${data.summary}', markdown: true },
          { type: 'Footer', label: 'סיום', 'on-click-action': { name: 'complete', payload: {} } },
        ],
      },
    },
  ],
}
