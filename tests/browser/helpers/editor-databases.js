/* SPDX-License-Identifier: AGPL-3.0-only */

// Soundscaper and Framescaper persist to separate product-scoped databases, so a
// workflow that reads persisted state has to open the one its own product wrote.
// Opening the other name does not fail loudly: indexedDB.open() without a version
// creates an empty database, and the read then reports a missing object store.
// The 1.0 products own fresh stable stores; pre-release stores are deliberately
// left untouched and are never opened by these workflows.
export const SOUNDSCAPER_DATABASE_NAME = 'kw-media-soundscaper-editor-v1';
export const SOUNDSCAPER_OPFS_DIRECTORY_NAME = 'soundscaper-editor-v1-sources';
export const FRAMESCAPER_DATABASE_NAME = 'kw-media-framescaper-editor-v1';
export const FRAMESCAPER_OPFS_DIRECTORY_NAME = 'framescaper-editor-v1-sources';

export function editorDatabaseName(product) {
	if (product === 'framescaper') return FRAMESCAPER_DATABASE_NAME;
	if (product === 'soundscaper') return SOUNDSCAPER_DATABASE_NAME;
	throw new TypeError(`Unknown editor product: ${String(product)}.`);
}
