/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { matchesFramescaperDesktopPublicationIdentity } from
	'../src/framescaper/desktop-project-library-publication-identity.ts';

const body = Object.freeze({
	storageKey: 'source-1', mimeType: 'video/mp4', byteLength: 123,
	sha256: 'a'.repeat(64),
});
const metadata = Object.freeze({
	sourceId: body.storageKey, mimeType: body.mimeType,
	size: body.byteLength, sha256: body.sha256,
});

test('desktop body publication identity binds every persisted descriptor field', () => {
	const publication = { metadata, discardIfCurrent: async () => true };
	assert.equal(matchesFramescaperDesktopPublicationIdentity(publication, body), true);
	for (const [field, wrong] of [
		['sourceId', 'other-source'], ['mimeType', 'video/webm'],
		['size', 122], ['sha256', 'b'.repeat(64)],
	] as const) {
		assert.equal(matchesFramescaperDesktopPublicationIdentity({
			...publication, metadata: { ...metadata, [field]: wrong },
		}, body), false, `${field} must be bound to the body`);
	}
	assert.equal(matchesFramescaperDesktopPublicationIdentity({
		...publication, discardIfCurrent: null,
	} as unknown as typeof publication, body), false);
});
