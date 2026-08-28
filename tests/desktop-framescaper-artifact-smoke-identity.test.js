/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The packaged Framescaper artifact smoke is stringified into the renderer, so
 * it cannot import the desktop project-library contract whose handshake it
 * checks — it is handed the expected baseline as data instead. That copy can
 * drift, and when it did the packaged smoke refused a correct application while
 * every unit test stayed green,
 * because the smoke's fixtures agreed with the smoke's own stale numbers.
 *
 * This check ties the copy back to the contract the preload actually answers
 * with, so any change to the frozen library identity fails here instead of in the nightly.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY,
} from '../desktop/framescaper-baseline-artifact-smoke.js';
import {
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
	FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	createFramescaperDesktopProjectLibraryHandshake,
} from '../desktop/framescaper-project-library-contract.ts';

test('the packaged artifact smoke expects the shipped desktop library baseline', () => {
	assert.deepEqual({ ...FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY }, {
		schemaFamily: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_FAMILY,
		schemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
		storageDatabaseName: 'kw-media-framescaper-editor-v1',
		desktopLibrarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
		desktopDatabaseUserVersion: DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
		desktopLibraryScope: ['kw.media', 'framescaper-project-library', 'v1'],
	});
});

test('the packaged artifact smoke expects the handshake the desktop contract mints', () => {
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	const identity = FRAMESCAPER_BASELINE_ARTIFACT_LIBRARY_IDENTITY;
	assert.equal(handshake.schemaFamily, identity.schemaFamily);
	assert.equal(handshake.schemaVersion, identity.schemaVersion);
	assert.equal(handshake.storageDatabaseName, identity.storageDatabaseName);
	assert.equal(handshake.desktopLibrarySchemaVersion, identity.desktopLibrarySchemaVersion);
	assert.equal(handshake.desktopDatabaseUserVersion, identity.desktopDatabaseUserVersion);
	assert.deepEqual([...handshake.desktopLibraryScope], [...identity.desktopLibraryScope]);
});
