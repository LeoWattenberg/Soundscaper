/* SPDX-License-Identifier: AGPL-3.0-only */

// Soundscaper and Framescaper persist to separate product-scoped databases, so a
// workflow that reads persisted state has to open the one its own product wrote.
// Opening the other name does not fail loudly: indexedDB.open() without a version
// creates an empty database, and the read then reports a missing object store.
// The Framescaper name follows whichever storage profile its live bootstrap
// mounts, so it moves with every product version that ships: dormant profiles
// for later versions exist well before the app mounts them, and only the mounted
// one owns real data. Confirm against the running page rather than the newest
// profile in the tree when this needs updating again.
export const SOUNDSCAPER_DATABASE_NAME = 'kw-media-soundscaper-editor-v21';
export const SOUNDSCAPER_OPFS_DIRECTORY_NAME = 'soundscaper-editor-v21-sources';
export const FRAMESCAPER_DATABASE_NAME = 'kw-media-framescaper-editor-v19';
export const FRAMESCAPER_OPFS_DIRECTORY_NAME = 'framescaper-editor-v19-sources';

export function editorDatabaseName(product) {
	if (product === 'framescaper') return FRAMESCAPER_DATABASE_NAME;
	if (product === 'soundscaper') return SOUNDSCAPER_DATABASE_NAME;
	throw new TypeError(`Unknown editor product: ${String(product)}.`);
}
