/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	DESKTOP_PROJECT_LIBRARY_V11_DATABASE_VERSION,
	SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	createSoundscaperDesktopProjectLibraryV11Handshake,
	createSoundscaperDesktopProjectLibraryV11Paths,
} from '../desktop/soundscaper-project-library-v11-contract.ts'
import {
	assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity,
	initializeSoundscaperDesktopProjectLibraryV11Database,
} from '../desktop/soundscaper-project-library-v11-database.ts'
import {
	SoundscaperNativePluginStateStore,
} from '../desktop/soundscaper-native-plugin-state-store.ts'

test('desktop library V11 pins project V29, SQLite user_version 13 and isolated scope v11', () => {
	assert.equal(SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION, 11)
	assert.equal(DESKTOP_PROJECT_LIBRARY_V11_DATABASE_VERSION, 13)
	assert.deepEqual(createSoundscaperDesktopProjectLibraryV11Handshake(), {
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		projectSchemaVersion: 29,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-soundscaper-editor-v29',
		desktopLibrarySchemaVersion: 11,
		desktopDatabaseUserVersion: 13,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v11'],
	})
	assert.match(createSoundscaperDesktopProjectLibraryV11Paths(
		join(tmpdir(), 'soundscaper-v11-test'),
	).libraryRoot, /soundscaper-project-library[/\\]v11$/u)
})

test('desktop V11 initializes exact database identity and strict content-addressed state custody', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryV11Database(database)
	assertSoundscaperDesktopProjectLibraryV11DatabaseIdentity(database)
	assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 13)
	const store = new SoundscaperNativePluginStateStore(database)
	const bytes = Uint8Array.from([0, 1, 2, 255])
	const first = store.put(bytes, 10)
	const duplicate = store.put(bytes, 20)
	assert.deepEqual(duplicate, first, 'equal state bodies deduplicate by digest')
	assert.equal(first.bodyId, `native-plugin-state:${first.sha256}`)
	assert.deepEqual(store.read(first.bodyId)?.bytes, bytes)
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM native_plugin_state_bodies').get()?.count, 1)
	database.prepare('UPDATE native_plugin_state_bodies SET bytes = ? WHERE body_id = ?')
		.run(Uint8Array.from([9, 9, 9, 9]), first.bodyId)
	assert.throws(() => store.read(first.bodyId), /content digest/iu)
	database.close()
})

test('desktop V11 state custody rejects SharedArrayBuffer and oversize state before persistence', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryV11Database(database)
	const store = new SoundscaperNativePluginStateStore(database)
	assert.throws(() => store.put(new Uint8Array(new SharedArrayBuffer(4))), /ordinary Uint8Array/iu)
	assert.throws(() => store.put(new Uint8Array(16 * 1024 * 1024 + 1)), /16 MiB/iu)
	database.close()
})
