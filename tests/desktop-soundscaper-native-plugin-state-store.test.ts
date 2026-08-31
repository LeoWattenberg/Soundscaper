/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	createSoundscaperDesktopProjectLibraryHandshake,
	createSoundscaperDesktopProjectLibraryPaths,
} from '../desktop/soundscaper-project-library-contract.ts'
import {
	initializeSoundscaperDesktopProjectLibraryDatabase,
} from '../desktop/soundscaper-project-library-database.ts'
import { SoundscaperDesktopProjectLibraryMain } from
	'../desktop/soundscaper-project-library-main.ts'
import {
	SoundscaperNativePluginStateStore,
	type SoundscaperNativePluginStateBodyDescriptor,
} from '../desktop/soundscaper-native-plugin-state-store.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'

test('native plug-in state reclamation preserves every retained project revision', (context) => {
	const database = new DatabaseSync(':memory:')
	context.after(() => { database.close() })
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	const store = new SoundscaperNativePluginStateStore(database)
	const historical = store.put(Uint8Array.from([1]))
	const current = store.put(Uint8Array.from([2]))
	const orphan = store.put(Uint8Array.from([3]))
	insertRevision(database, project('plugin-project', 0, historical))
	insertRevision(database, project('plugin-project', 1, current))

	assert.equal(store.reclaimUnreferencedProjectStateBodies(), 1)
	assert.equal(store.has(historical.bodyId), true,
		'a retained historical revision may still be needed for recovery')
	assert.equal(store.has(current.bodyId), true)
	assert.equal(store.has(orphan.bodyId), false)

	database.prepare(`
		DELETE FROM project_revisions WHERE project_id = ? AND project_revision = ?
	`).run('plugin-project', 0)
	assert.equal(store.reclaimUnreferencedProjectStateBodies(), 1)
	assert.equal(store.has(historical.bodyId), false,
		'a state body becomes collectible only after its last durable revision retires')
	assert.equal(store.has(current.bodyId), true)

	const failSafe = store.put(Uint8Array.from([5]))
	database.prepare(`
		UPDATE project_revisions SET document_json = '{' WHERE project_revision = 1
	`).run()
	assert.throws(() => store.reclaimUnreferencedProjectStateBodies(), /document is invalid/iu)
	assert.equal(store.has(failSafe.bodyId), true,
		'a malformed retained authority must fail closed before deleting any body')
})

test('Soundscaper desktop startup reclaims state left outside durable projects', async (context) => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'soundscaper-native-state-gc-'))
	context.after(() => rm(appDataPath, { recursive: true, force: true }))
	const paths = createSoundscaperDesktopProjectLibraryPaths(appDataPath)
	await mkdir(paths.libraryRoot, { recursive: true })
	const database = new DatabaseSync(paths.databasePath)
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	const body = new SoundscaperNativePluginStateStore(database).put(Uint8Array.from([4]))
	database.close()

	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath,
		owner: { product: 'soundscaper', processId: 1, instanceId: 'native-state-gc' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		testControl: null,
	})
	context.after(() => main.close())

	assert.equal(main.readNativePluginState(body.bodyId), null)
})

function project(
	id: string,
	revision: number,
	stateBody: Readonly<SoundscaperNativePluginStateBodyDescriptor>,
) {
	return createSoundscaperProject({
		id,
		revision,
		nativePluginStates: [{
			instanceId: 'native-instance-1',
			format: 'vst3',
			stablePluginId: 'org.example.plugin',
			binarySha256: 'a'.repeat(64),
			stateBody,
			enabled: true,
			bypassed: false,
			continuity: 'live',
			latencySamples: 0,
		}],
	})
}

function insertRevision(
	database: DatabaseSync,
	projectValue: ReturnType<typeof project>,
): void {
	const document = JSON.stringify(projectValue)
	database.prepare(`
		INSERT INTO project_revisions (
			project_id, project_revision, project_sha256, entry_id, relative_file,
			byte_length, document_json, published_at_ms
		) VALUES (?, ?, ?, ?, ?, ?, ?, 0)
	`).run(
		projectValue.id,
		projectValue.revision,
		String(projectValue.revision).padStart(64, '0'),
		`entry-${String(projectValue.revision)}`,
		`${String(projectValue.revision)}.json`,
		Buffer.byteLength(document),
		document,
	)
}
