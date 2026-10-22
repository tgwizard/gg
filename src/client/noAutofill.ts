/**
 * Spread onto text inputs that aren't credentials (names, chat, room codes) so
 * browsers and password managers don't offer to fill or save them.
 * 1Password: data-1p-ignore; LastPass: data-lpignore; Dashlane: data-form-type.
 */
export const noAutofill = {
  autoComplete: "off",
  "data-1p-ignore": true,
  "data-lpignore": "true",
  "data-form-type": "other",
} as const;
