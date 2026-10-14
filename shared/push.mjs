/**
 * Events a user can choose to receive as push notifications. Shared by the
 * server (filtering + payload text) and the settings UI.
 */
export const PUSH_EVENTS = Object.freeze(['document_uploaded', 'request_completed', 'signature_signed', 'signature_declined', 'support_message', 'billing'])

/** Push event for an in-app notification template (billing notices are stored as 'localized'). */
export function pushEventFor(template) {
  if (template === 'localized') return 'billing'
  return PUSH_EVENTS.includes(template) ? template : null
}
