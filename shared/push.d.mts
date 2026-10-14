export type PushEvent = 'document_uploaded' | 'request_completed' | 'signature_signed' | 'signature_declined' | 'support_message' | 'billing'
export declare const PUSH_EVENTS: readonly PushEvent[]
export declare function pushEventFor(template: string | null | undefined): PushEvent | null
