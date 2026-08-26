/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The packaged Framescaper artifact smoke is stringified into the renderer, so
 * it cannot import the desktop project-library contract whose handshake it
 * checks — it is handed the expected generation as data instead. That copy can
 * drift, and when it did the packaged smoke refused a correct application with
 * "received a drifted V18 handshake" while every unit test stayed green,
 * because the smoke's fixtures agreed with the smoke's own stale numbers.
 *
 * This check ties the copy back to the contract the preload actually answers
 * with, so the next library generation fails here instead of in the nightly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY,
} from '../desktop/framescaper-v27-artifact-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION,
	createFramescaperDesktopProjectLibraryV20Handshake,
} from '../desktop/project-library-v20-contract.ts';

test('the packaged artifact smoke expects the shipped desktop library generation', () => {
	assert.deepEqual({ ...FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY }, {
		projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION,
		storageDatabaseName: 'kw-media-framescaper-editor-v31',
		desktopLibrarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION,
		desktopDatabaseUserVersion: DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v20'],
	});
});

test('the packaged artifact smoke expects the handshake the desktop contract mints', () => {
	const handshake = createFramescaperDesktopProjectLibraryV20Handshake();
	const identity = FRAMESCAPER_ARTIFACT_SMOKE_LIBRARY_IDENTITY;
	assert.equal(handshake.projectSchemaVersion, identity.projectSchemaVersion);
	assert.equal(handshake.storageDatabaseName, identity.storageDatabaseName);
	assert.equal(handshake.desktopLibrarySchemaVersion, identity.desktopLibrarySchemaVersion);
	assert.equal(handshake.desktopDatabaseUserVersion, identity.desktopDatabaseUserVersion);
	assert.deepEqual([...handshake.desktopLibraryScope], [...identity.desktopLibraryScope]);
});
