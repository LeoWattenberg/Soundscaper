/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths,
	DESKTOP_PROJECT_LIBRARY_APPLICATION_ID,
	validateFramescaperDesktopProjectLibraryHandshake,
} from '../desktop/framescaper-project-library-contract.ts';
import { initializeFramescaperDesktopProjectLibraryLifecycleDatabase } from
	'../desktop/framescaper-project-library-database.ts';
import { initializeFramescaperDesktopProjectLibraryExactGenerationDatabase } from
	'../desktop/project-library-exact-generation-database.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from
	'../desktop/framescaper-project-library-main-channels.ts';
import { FramescaperDesktopProjectLibraryMain } from
	'../desktop/framescaper-project-library-main.ts';

test('Framescaper desktop baseline handshake is the exact family-qualified tuple', () => {
	const handshake = createFramescaperDesktopProjectLibraryHandshake();
	assert.deepEqual(handshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		schemaFamily: 'framescaper',
		schemaVersion: 1,
		scapeFormatVersions: [1],
		attachedScapeFormatVersion: 1,
		storageDatabaseName: 'kw-media-framescaper-editor-v1',
		desktopLibrarySchemaVersion: 1,
		desktopDatabaseUserVersion: 1,
		desktopLibraryScope: ['kw.media', 'framescaper-project-library', 'v1'],
	});
	assert.deepEqual(validateFramescaperDesktopProjectLibraryHandshake(handshake), handshake);
	assert.throws(() => validateFramescaperDesktopProjectLibraryHandshake({
		...handshake,
		schemaFamily: 'soundscaper',
	}), /identity is unsupported/u);
});

test('Framescaper desktop baseline leaves every pre-release library root untouched', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-baseline-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const retired = [
		['v10', 12], ['v12', 14], ['v13', 15], ['v14', 16], ['v15', 17],
		['v16', 18], ['v17', 19], ['v18', 20], ['v19', 21], ['v20', 22],
	] as const;
	for (const [scope, userVersion] of retired) {
		const retiredRoot = join(root, 'kw.media', 'scape-project-library', scope);
		await mkdir(retiredRoot, { recursive: true });
		const database = new DatabaseSync(join(retiredRoot, 'library.sqlite3'));
		database.exec(`
			PRAGMA application_id = 1179861840;
			PRAGMA user_version = ${String(userVersion)};
			CREATE TABLE retired_witness (value BLOB NOT NULL);
			INSERT INTO retired_witness (value) VALUES (x'00ff${userVersion.toString(16).padStart(2, '0')}');
		`);
		database.close();
		await writeFile(join(retiredRoot, 'untouched.bin'), new Uint8Array([0, 255, userVersion]));
	}
	const paths = createFramescaperDesktopProjectLibraryPaths(root);
	assert.equal(paths.libraryRoot, join(root, 'kw.media', 'framescaper-project-library', 'v1'));
	const main = await FramescaperDesktopProjectLibraryMain.start({
		appDataPath: root,
		owner: { product: 'framescaper', processId: 933, instanceId: 'baseline-isolation' },
		handshake: createFramescaperDesktopProjectLibraryHandshake(),
		onLeaseLost: () => undefined,
		qualification: null,
	});
	await main.close();
	for (const [scope, userVersion] of retired) {
		const retiredRoot = join(root, 'kw.media', 'scape-project-library', scope);
		assert.deepEqual(await readFile(join(retiredRoot, 'untouched.bin')),
			Buffer.from([0, 255, userVersion]), scope);
		const database = new DatabaseSync(join(retiredRoot, 'library.sqlite3'));
		assert.equal(database.prepare('PRAGMA application_id').get()?.application_id, 0x46534350, scope);
		assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, userVersion, scope);
		assert.equal(database.prepare('SELECT hex(value) AS value FROM retired_witness').get()?.value,
			`00FF${userVersion.toString(16).padStart(2, '0').toUpperCase()}`, scope);
		database.close();
	}
});

test('Framescaper fresh SQLite baseline has exact v1 identity and no migration marker', () => {
	const database = new DatabaseSync(':memory:');
	initializeFramescaperDesktopProjectLibraryExactGenerationDatabase(database, {
		label: 'Framescaper 1.0',
		schemaFamily: 'framescaper',
		librarySchemaVersion: 1,
		schemaVersion: 1,
		databaseUserVersion: 1,
	});
	initializeFramescaperDesktopProjectLibraryLifecycleDatabase(database);
	assert.equal(database.prepare('PRAGMA application_id').get()?.application_id,
		DESKTOP_PROJECT_LIBRARY_APPLICATION_ID);
	assert.equal(database.prepare('PRAGMA user_version').get()?.user_version, 1);
	assert.deepEqual({ ...database.prepare(`
		SELECT schema_version, project_schema_family, project_schema_version
		FROM library_identity WHERE singleton = 1
	`).get() }, {
		schema_version: 1,
		project_schema_family: 'framescaper',
		project_schema_version: 1,
	});
	const tables = database.prepare(`
		SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name
	`).all().map(({ name }) => name);
	assert.equal(tables.some((name) => /(?:import|migration)/u.test(String(name))), false);
	database.close();
});

test('Framescaper baseline IPC namespace is unique and complete', () => {
	const channels = Object.values(FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS);
	assert.equal(new Set(channels).size, channels.length);
	assert.equal(channels.length, 10);
	assert.equal(channels.every((channel) => channel.startsWith(
		'framescaper:v1:project-library:',
	)), true);
});
