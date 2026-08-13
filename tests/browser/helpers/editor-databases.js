/* SPDX-License-Identifier: AGPL-3.0-only */

// Soundscaper and Framescaper persist to separate product-scoped databases, so a
// workflow that reads persisted state has to open the one its own product wrote.
// Opening the other name does not fail loudly: indexedDB.open() without a version
// creates an empty database, and the read then reports a missing object store.
export const SOUNDSCAPER_DATABASE_NAME = 'kw-media-audio-editor';
export const FRAMESCAPER_DATABASE_NAME = 'kw-media-framescaper-editor-v18';

export function editorDatabaseName(product) {
	if (product === 'framescaper') return FRAMESCAPER_DATABASE_NAME;
	if (product === 'soundscaper') return SOUNDSCAPER_DATABASE_NAME;
	throw new TypeError(`Unknown editor product: ${String(product)}.`);
}
