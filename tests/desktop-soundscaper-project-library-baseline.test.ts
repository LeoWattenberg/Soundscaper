/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
	DESKTOP_PROJECT_LIBRARY_APPLICATION_ID,
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
	SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	createSoundscaperDesktopProjectLibraryHandshake,
	createSoundscaperDesktopProjectLibraryPaths,
	validateSoundscaperDesktopProjectLibraryHandshake,
} from '../desktop/soundscaper-project-library-contract.ts'
import {
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity,
	initializeSoundscaperDesktopProjectLibraryDatabase,
} from '../desktop/soundscaper-project-library-database.ts'
import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
} from '../desktop/soundscaper-project-library-main-channels.ts'
import {
	validateSoundscaperDesktopProjectLibraryCatalogSnapshot,
} from '../desktop/soundscaper-project-library-lifecycle-contract.ts'
import {
	acquireSoundscaperDesktopProjectLibraryLeaseWithWait,
} from '../desktop/soundscaper-project-library-lease-wait.ts'
import {
	createSoundscaperDesktopProjectLibraryMainPreloadBridge,
} from '../desktop/soundscaper-project-library-main-preload.ts'
import { createHash as createSandboxHash } from '../desktop/soundscaper-project-library-sandbox-crypto.ts'
import { validateSoundscaperDesktopCurrentProject } from '../desktop/soundscaper-project-library-current-project.ts'
import { SoundscaperDesktopProjectLibraryMain } from '../desktop/soundscaper-project-library-main.ts'
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts'

test('Soundscaper desktop baseline freezes the exact family-qualified v1 identity', () => {
	assert.equal(
		createSandboxHash('sha256').update('abc').digest('hex'),
		'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
	)
	assert.equal(SOUNDSCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION, 1)
	assert.equal(DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION, 1)
	assert.equal(DESKTOP_PROJECT_LIBRARY_APPLICATION_ID, 0x53534350)
	assert.deepEqual(createSoundscaperDesktopProjectLibraryHandshake(), {
		kind: 'soundscaper-project-library-handshake',
		version: 1,
		owner: 'soundscaper',
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: 'kw-media-soundscaper-editor-v1',
		desktopLibrarySchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['kw.media', 'soundscaper-project-library', 'v1'],
	})
	assert.match(createSoundscaperDesktopProjectLibraryPaths(
		join(tmpdir(), 'soundscaper-baseline-contract'),
	).libraryRoot, /soundscaper-project-library[/\\]v1$/u)
})

test('Soundscaper desktop baseline handshake rejects accessors and pre-release identities', () => {
	const accessor = { ...createSoundscaperDesktopProjectLibraryHandshake() } as Record<string, unknown>
	Object.defineProperty(accessor, 'schemaFamily', { enumerable: true, get: () => 'soundscaper' })
	assert.throws(() => validateSoundscaperDesktopProjectLibraryHandshake(accessor), /data property/iu)
	assert.throws(() => validateSoundscaperDesktopProjectLibraryHandshake({
		...createSoundscaperDesktopProjectLibraryHandshake(),
		schemaVersion: 30,
	}), /unsupported/iu)
})

test('Soundscaper desktop baseline admits only current family v1 documents', () => {
	const current = createSoundscaperProject({ id: 'desktop-baseline', title: 'Desktop baseline' })
	assert.equal(validateSoundscaperDesktopCurrentProject(current), current)
	assert.throws(() => validateSoundscaperDesktopCurrentProject({
		...current,
		schemaFamily: 'framescaper',
	}), /Soundscaper project schema identity/iu)
})

test('Soundscaper desktop baseline catalog rows carry the exact schema tuple', () => {
	assert.deepEqual(validateSoundscaperDesktopProjectLibraryCatalogSnapshot({
		metadataRevision: 0,
		projects: [{
			schemaFamily: 'soundscaper',
			schemaVersion: 1,
			id: 'project-one',
			title: 'Project one',
			revision: 0,
			updatedAt: '2026-08-28T00:00:00.000Z',
		}],
	}).projects[0], {
		schemaFamily: 'soundscaper',
		schemaVersion: 1,
		id: 'project-one',
		title: 'Project one',
		revision: 0,
		updatedAt: '2026-08-28T00:00:00.000Z',
	})
	assert.throws(() => validateSoundscaperDesktopProjectLibraryCatalogSnapshot({
		metadataRevision: 0,
		projects: [{
			schemaFamily: 'framescaper',
			schemaVersion: 1,
			id: 'project-one',
			title: 'Project one',
			revision: 0,
			updatedAt: '2026-08-28T00:00:00.000Z',
		}],
	}), /unsupported identity/iu)
})

test('Soundscaper desktop baseline initializes only exact SSCP user_version 1 databases', () => {
	const database = new DatabaseSync(':memory:')
	initializeSoundscaperDesktopProjectLibraryDatabase(database)
	assertSoundscaperDesktopProjectLibraryDatabaseIdentity(database)
	assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0x53534350)
	assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 1)
	database.close()

	const retired = new DatabaseSync(':memory:')
	retired.exec('PRAGMA application_id = 1397965648; PRAGMA user_version = 13')
	assert.throws(
		() => initializeSoundscaperDesktopProjectLibraryDatabase(retired),
		/unsupported Soundscaper desktop baseline database version/iu,
	)
	assert.equal(retired.prepare('PRAGMA user_version').get()?.user_version, 13)
	retired.close()
})

test('Soundscaper baseline never opens or changes either pre-release desktop library', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-baseline-isolation-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	const retired = [['v10', 12], ['v11', 13]] as const
	for (const [scope, userVersion] of retired) {
		const libraryRoot = join(root, 'kw.media', 'soundscaper-project-library', scope)
		await mkdir(libraryRoot, { recursive: true })
		const database = new DatabaseSync(join(libraryRoot, 'library.sqlite3'))
		database.exec(`
			PRAGMA application_id = 1397965648;
			PRAGMA user_version = ${String(userVersion)};
			CREATE TABLE retired_witness (value BLOB NOT NULL);
			INSERT INTO retired_witness (value) VALUES (x'00ff${userVersion.toString(16).padStart(2, '0')}');
		`)
		database.close()
		await writeFile(join(libraryRoot, 'untouched.bin'), new Uint8Array([0, 255, userVersion]))
	}

	const main = await SoundscaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'soundscaper', processId: 932, instanceId: 'baseline-isolation' },
		handshake: createSoundscaperDesktopProjectLibraryHandshake(),
		qualification: null,
	})
	await main.close()

	for (const [scope, userVersion] of retired) {
		const libraryRoot = join(root, 'kw.media', 'soundscaper-project-library', scope)
		assert.deepEqual(await readFile(join(libraryRoot, 'untouched.bin')),
			Buffer.from([0, 255, userVersion]), scope)
		const database = new DatabaseSync(join(libraryRoot, 'library.sqlite3'))
		assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0x53534350, scope)
		assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, userVersion, scope)
		assert.equal(database.prepare('SELECT hex(value) AS value FROM retired_witness').get()?.value,
			`00FF${userVersion.toString(16).padStart(2, '0').toUpperCase()}`, scope)
		database.close()
	}
})

test('Soundscaper baseline IPC is closed under its v1 project-library namespace', async () => {
	for (const channel of Object.values(SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS)) {
		assert.match(channel, /^soundscaper:v1:project-library:/u)
	}
	const bridge = createSoundscaperDesktopProjectLibraryMainPreloadBridge({
		invoke: async (channel: string, value?: unknown) => {
			assert.equal(channel, SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS.handshake)
			return value
		},
	})
	await assert.rejects(() => bridge.listProjects(), /handshake/iu)
	assert.deepEqual(await bridge.connect(), createSoundscaperDesktopProjectLibraryHandshake())
})

test('Soundscaper baseline lease retry recognizes only current contention', async () => {
	let attempts = 0
	assert.equal(await acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
		attempts += 1
		if (attempts === 1) throw new Error('Soundscaper desktop baseline writer lease is busy')
		return 'lease'
	}, { waitMs: 50, pollIntervalMs: 10 }), 'lease')
	assert.equal(attempts, 2)
	await assert.rejects(
		() => acquireSoundscaperDesktopProjectLibraryLeaseWithWait(() => {
			throw new Error('Soundscaper desktop V11 writer lease is busy')
		}, { waitMs: 50, pollIntervalMs: 10 }),
		/V11/iu,
	)
})
