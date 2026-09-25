/* SPDX-License-Identifier: AGPL-3.0-only */

/** Status and validation copy for desktop Adobe Audition session import. */
const SESX_COPY_ENTRIES = Object.freeze([
	['sesxOpened', 'Adobe Audition session imported.', 'Adobe-Audition-Sitzung importiert.'],
]);

export const SESX_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(SESX_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(SESX_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
