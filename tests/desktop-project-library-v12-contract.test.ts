/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import {
	DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
	createFramescaperDesktopProjectLibraryV12Handshake,
	createFramescaperDesktopProjectLibraryV12Paths,
	validateFramescaperDesktopProjectLibraryV12Handshake,
} from '../desktop/project-library-v12-contract.ts';
import {
	validateFramescaperDesktopCurrentProjectV20,
} from '../desktop/project-library-v12-current-project.ts';
import { createFramescaperProjectV18 } from '../src/framescaper/editor-project-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';

test('Framescaper V12 owns an exact V20/SQLite 14/v12 identity', () => {
	assert.equal(FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION, 12);
	assert.equal(FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION, 20);
	assert.equal(DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION, 14);
	const handshake = createFramescaperDesktopProjectLibraryV12Handshake();
	assert.deepEqual(handshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 20,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v20',
		desktopLibrarySchemaVersion: 12,
		desktopDatabaseUserVersion: 14,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v12'],
	});
	assert.deepEqual(validateFramescaperDesktopProjectLibraryV12Handshake(handshake), handshake);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV12Handshake({
		...handshake,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
	}), /V12.*unsupported/iu);
	assert.throws(() => validateFramescaperDesktopProjectLibraryV12Handshake({
		...handshake,
		projectSchemaVersion: 18,
	}), /V12 handshake identity is unsupported/iu);
});

test('Framescaper V12 derives a separate exact-generation library scope', () => {
	const paths = createFramescaperDesktopProjectLibraryV12Paths('/var/lib/soundscaper');
	assert.deepEqual(paths, {
		libraryRoot: join('/var/lib/soundscaper', 'kw.media', 'scape-project-library', 'v12'),
		databasePath: join('/var/lib/soundscaper', 'kw.media', 'scape-project-library', 'v12', 'library.sqlite3'),
		projectsRoot: join('/var/lib/soundscaper', 'kw.media', 'scape-project-library', 'v12', 'projects'),
		managedMediaRoot: join('/var/lib/soundscaper', 'kw.media', 'scape-project-library', 'v12', 'media'),
	});
	assert.throws(() => createFramescaperDesktopProjectLibraryV12Paths('relative'), /absolute appData path/iu);
});

test('Framescaper V12 admits only the authenticated exact V20 project profile', () => {
	const v20 = createFramescaperProjectV20(FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE, {
		id: 'desktop-v12-v20-project',
		title: 'Desktop V12 V20 project',
		revision: 0,
		now: '2026-08-22T12:00:00.000Z',
	});
	assert.equal(validateFramescaperDesktopCurrentProjectV20(v20), v20);
	assert.throws(() => validateFramescaperDesktopCurrentProjectV20(v20, {}), /exact Framescaper V20 runtime profile/iu);
	const v18 = createFramescaperProjectV18(FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE, {
		id: 'desktop-v12-v18-project', title: 'V18', revision: 0,
		now: '2026-08-22T12:00:00.000Z',
	});
	const v19 = createFramescaperProjectV19(FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE, {
		id: 'desktop-v12-v19-project', title: 'V19', revision: 0,
		now: '2026-08-22T12:00:00.000Z',
	});
	assert.throws(() => validateFramescaperDesktopCurrentProjectV20(v18), /schema version: 18/iu);
	assert.throws(() => validateFramescaperDesktopCurrentProjectV20(v19), /schema version: 19/iu);
});
