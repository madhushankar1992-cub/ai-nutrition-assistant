// Request limits shared by the server schema and the browser.
//
// Kept in a module with no imports so a client component can read the limit
// without pulling zod into the browser bundle. lib/schema.ts enforces it on
// the server; components/ChatInput.tsx enforces it before sending, so a long
// paste gets a clear message instead of a generic request error.

export const MAX_MESSAGE_CHARS = 4000;
