/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Copy for the Opus export VBR-mode row.
 *
 * Audacity names the three rate strategies libopus offers, and the row grows
 * whenever an encoder gains a mode. It lives behind its own seam for the same
 * reason the MP3 bit-rate row does: the main catalog sits at a maintainability
 * ceiling that a per-mode string should not push up.
 */
const OPUS_EXPORT_COPY_ENTRIES = Object.freeze([
	['vbrMode', 'VBR Mode', 'VBR-Modus'],
	['vbrModeOff', 'Off', 'Aus'],
	['vbrModeOn', 'On', 'An'],
	['vbrModeConstrained', 'Constrained', 'Beschränkt'],
]);

export const OPUS_EXPORT_COPY_BY_LOCALE = Object.freeze({
	en: Object.freeze(Object.fromEntries(OPUS_EXPORT_COPY_ENTRIES.map(([key, en]) => [key, en]))),
	de: Object.freeze(Object.fromEntries(OPUS_EXPORT_COPY_ENTRIES.map(([key, , de]) => [key, de]))),
});
