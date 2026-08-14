/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FRAMESCAPER_DATABASE_NAME, SOUNDSCAPER_DATABASE_NAME } from './browser/helpers/editor-databases.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Reading persisted state from the wrong database does not fail as a wrong name:
// indexedDB.open() without a version creates an empty database, so every read
// reports a missing object store instead. One stale constant therefore surfaces
// as a hundred-plus failures spread across every workflow that reads storage,
// twenty minutes into a browser run. These audits fail in seconds instead, and
// name both the database that moved and the one the workflows still expect.
//
// The mounted version is read from the app rather than pinned here, because
// dormant profiles for later versions land in the tree well before the app
// mounts them: the newest profile present is not the one that owns data.
test('the browser workflows open the database the web Framescaper bootstrap mounts', async () => {
	const app = await readFile(resolve(ROOT, 'src/common/site/App.jsx'), 'utf8');
	const mounted = /hasFramescaperDesktopBridge\(\)\s*\?\s*FramescaperAudioEditorBootstrapV\d+\s*:\s*FramescaperAudioEditorBootstrapV(\d+)/u
		.exec(app);
	assert.ok(
		mounted,
		'Could not tell which Framescaper bootstrap the web branch mounts from src/common/site/App.jsx.'
		+ ' Browser workflows always run the web branch, so this audit has to follow that choice.',
	);
	const profile = await readFile(
		resolve(ROOT, `src/framescaper/editor-project-storage-profile-v${mounted[1]}.ts`),
		'utf8',
	);
	const databaseName = /databaseName: '([^']+)'/u.exec(profile);
	assert.ok(databaseName, `The V${mounted[1]} storage profile declares no database name literal.`);
	assert.equal(
		FRAMESCAPER_DATABASE_NAME,
		databaseName[1],
		`The web Framescaper bootstrap mounts V${mounted[1]}, which persists to ${databaseName[1]}, but the`
		+ ` browser workflows open ${FRAMESCAPER_DATABASE_NAME}. Follow the mounted profile in`
		+ ' tests/browser/helpers/editor-databases.js.',
	);
});

test('the browser workflows open the database the web Soundscaper bootstrap mounts', async () => {
	const app = await readFile(resolve(ROOT, 'src/common/site/App.jsx'), 'utf8');
	const mounted = /productId !== 'framescaper'\s*\?\s*SoundscaperAudioEditorBootstrapV(\d+)/u.exec(app);
	assert.ok(mounted, 'Could not tell which Soundscaper bootstrap src/common/site/App.jsx mounts.');
	const profile = await readFile(
		resolve(ROOT, `src/soundscaper/editor-project-storage-profile-v${mounted[1]}.ts`),
		'utf8',
	);
	const databaseName = /databaseName: '([^']+)'/u.exec(profile);
	assert.ok(databaseName, `The V${mounted[1]} Soundscaper storage profile declares no database name literal.`);
	assert.equal(
		SOUNDSCAPER_DATABASE_NAME,
		databaseName[1],
		`The web Soundscaper bootstrap mounts V${mounted[1]}, which persists to ${databaseName[1]}, but the`
		+ ` browser workflows open ${SOUNDSCAPER_DATABASE_NAME}. Follow the mounted profile in`
		+ ' tests/browser/helpers/editor-databases.js.',
	);
});
