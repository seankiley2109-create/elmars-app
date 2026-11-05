/** The largest file a note takes. Bigger files are refused with a message, never half-written. */
export const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024;

export const tooBigMessage = (name: string): string => `"${name}" is over 50 MB, too big to attach. Nothing was added.`;
