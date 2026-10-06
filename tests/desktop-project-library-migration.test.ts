/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { migrateDesktopProjectLibraries } from '../desktop/desktop-project-library-migration.ts';

async function fixture(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'scape-library-migration-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const legacyAppDataPath = join(root, 'config');
	const projectLibraryAppDataPath = join(root, 'data');
	return { root, legacyAppDataPath, projectLibraryAppDataPath };
}

function oldLibrary(base: string, appName = 'Soundscaper'): string {
	return join(base, 'kw.media', `${appName.toLowerCase()}-project-library`, 'v1');
}

function currentLibrary(base: string, appName = 'Soundscaper'): string {
	return join(base, appName, 'project-library', 'v1');
}

async function seed(directory: string, name: string, bytes: string): Promise<void> {
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, name), bytes);
}

test('missing current libraries leave archived pre-release stores untouched', async (context) => {
	const paths = await fixture(context);
	const archive = join(paths.legacyAppDataPath, 'kw.media', 'scape-project-library', 'v9');
	await seed(archive, 'library.sqlite3', 'archived schema bytes');
	await migrateDesktopProjectLibraries({ ...paths, appName: 'Soundscaper' });
	assert.equal(await readFile(join(archive, 'library.sqlite3'), 'utf8'), 'archived schema bytes');
	assert.deepEqual(await readdir(paths.root), ['config']);
});

test('both former config and XDG data libraries merge verified identical files', async (context) => {
	const paths = await fixture(context);
	const configLibrary = oldLibrary(paths.legacyAppDataPath);
	const dataLibrary = oldLibrary(paths.projectLibraryAppDataPath);
	const destination = currentLibrary(paths.projectLibraryAppDataPath);
	await seed(configLibrary, 'library.sqlite3', 'same current database');
	await seed(dataLibrary, 'library.sqlite3', 'same current database');
	await seed(join(configLibrary, 'projects'), 'config-project', 'config project bytes');
	await seed(join(dataLibrary, 'projects'), 'data-project', 'data project bytes');
	await migrateDesktopProjectLibraries({ ...paths, appName: 'Soundscaper' });
	assert.equal(await readFile(join(destination, 'library.sqlite3'), 'utf8'), 'same current database');
	assert.equal(await readFile(join(destination, 'projects', 'config-project'), 'utf8'), 'config project bytes');
	assert.equal(await readFile(join(destination, 'projects', 'data-project'), 'utf8'), 'data project bytes');
	await assert.rejects(lstat(configLibrary), /ENOENT/u);
	await assert.rejects(lstat(dataLibrary), /ENOENT/u);
});

test('equal normalized platform appData bases migrate only once', async (context) => {
	const paths = await fixture(context);
	const source = oldLibrary(paths.legacyAppDataPath);
	const destination = currentLibrary(paths.legacyAppDataPath);
	await seed(source, 'library.sqlite3', 'current database');
	await migrateDesktopProjectLibraries({
		legacyAppDataPath: `${paths.legacyAppDataPath}/.`,
		projectLibraryAppDataPath: paths.legacyAppDataPath,
		appName: 'Soundscaper',
	});
	assert.equal(await readFile(join(destination, 'library.sqlite3'), 'utf8'), 'current database');
	await assert.rejects(lstat(source), /ENOENT/u);
});

test('restart resumes identical duplicates and repeated starts retain destination-only files', async (context) => {
	const paths = await fixture(context);
	const source = oldLibrary(paths.projectLibraryAppDataPath);
	const destination = currentLibrary(paths.projectLibraryAppDataPath);
	await seed(source, 'library.sqlite3', 'current database');
	await seed(destination, 'library.sqlite3', 'current database');
	await seed(join(source, 'managed-media'), 'pending', 'pending media');
	await seed(destination, 'keep', 'destination-only bytes');
	const options = { ...paths, appName: 'Soundscaper' };
	await migrateDesktopProjectLibraries(options);
	await migrateDesktopProjectLibraries(options);
	await assert.rejects(lstat(source), /ENOENT/u);
	assert.equal(await readFile(join(destination, 'managed-media', 'pending'), 'utf8'), 'pending media');
	assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'destination-only bytes');
});

test('an existing destination conflict preserves both old locations and the new library', async (context) => {
	const paths = await fixture(context);
	const configLibrary = oldLibrary(paths.legacyAppDataPath);
	const dataLibrary = oldLibrary(paths.projectLibraryAppDataPath);
	const destination = currentLibrary(paths.projectLibraryAppDataPath);
	await seed(configLibrary, 'library.sqlite3', 'source');
	await seed(dataLibrary, 'library.sqlite3', 'source');
	await seed(destination, 'library.sqlite3', 'target');
	await seed(configLibrary, 'a-project', 'source project');
	await assert.rejects(
		migrateDesktopProjectLibraries({ ...paths, appName: 'Soundscaper' }),
		/conflict.*files differ/iu,
	);
	assert.equal(await readFile(join(configLibrary, 'library.sqlite3'), 'utf8'), 'source');
	assert.equal(await readFile(join(dataLibrary, 'library.sqlite3'), 'utf8'), 'source');
	assert.equal(await readFile(join(destination, 'library.sqlite3'), 'utf8'), 'target');
	assert.equal(await readFile(join(configLibrary, 'a-project'), 'utf8'), 'source project');
	await assert.rejects(lstat(join(destination, 'a-project')), /ENOENT/u);
});

test('differing libraries in both old locations stop without overwriting either database', async (context) => {
	const paths = await fixture(context);
	const configLibrary = oldLibrary(paths.legacyAppDataPath);
	const dataLibrary = oldLibrary(paths.projectLibraryAppDataPath);
	const destination = currentLibrary(paths.projectLibraryAppDataPath);
	await seed(configLibrary, 'library.sqlite3', 'config database');
	await seed(dataLibrary, 'library.sqlite3', 'xdg database');
	const options = { ...paths, appName: 'Soundscaper' };
	await assert.rejects(migrateDesktopProjectLibraries(options), /conflict.*files differ/iu);
	await assert.rejects(migrateDesktopProjectLibraries(options), /conflict.*files differ/iu);
	assert.equal(await readFile(join(destination, 'library.sqlite3'), 'utf8'), 'config database');
	assert.equal(await readFile(join(dataLibrary, 'library.sqlite3'), 'utf8'), 'xdg database');
});

test('product migrations relocate only their own current family-v1 folders', async (context) => {
	const paths = await fixture(context);
	const soundscaper = oldLibrary(paths.legacyAppDataPath);
	const framescaper = oldLibrary(paths.legacyAppDataPath, 'Framescaper');
	const framescaperArchive = join(paths.legacyAppDataPath, 'kw.media', 'framescaper-project-library', 'v10');
	await seed(soundscaper, 'library.sqlite3', 'soundscaper bytes');
	await seed(framescaper, 'library.sqlite3', 'framescaper bytes');
	await seed(framescaperArchive, 'library.sqlite3', 'archived framescaper bytes');
	await migrateDesktopProjectLibraries({ ...paths, appName: 'Soundscaper' });
	assert.equal(await readFile(join(framescaper, 'library.sqlite3'), 'utf8'), 'framescaper bytes');
	await assert.rejects(lstat(currentLibrary(paths.projectLibraryAppDataPath, 'Framescaper')), /ENOENT/u);
	await migrateDesktopProjectLibraries({ ...paths, appName: 'Framescaper' });
	assert.equal(await readFile(join(currentLibrary(paths.projectLibraryAppDataPath), 'library.sqlite3'), 'utf8'), 'soundscaper bytes');
	assert.equal(await readFile(join(currentLibrary(paths.projectLibraryAppDataPath, 'Framescaper'), 'library.sqlite3'), 'utf8'), 'framescaper bytes');
	assert.equal(await readFile(join(framescaperArchive, 'library.sqlite3'), 'utf8'), 'archived framescaper bytes');
	await assert.rejects(lstat(framescaper), /ENOENT/u);
});

test('invalid base paths and application names reject before filesystem work', async (context) => {
	const paths = await fixture(context);
	const options = { ...paths, appName: 'Soundscaper' };
	for (const invalid of [
		{ legacyAppDataPath: 'relative' },
		{ projectLibraryAppDataPath: '' },
		{ legacyAppDataPath: `${paths.legacyAppDataPath}\0` },
		{ appName: '..' },
		{ appName: '../Soundscaper' },
		{ appName: 'Soundscaper\\outside' },
	]) {
		await assert.rejects(migrateDesktopProjectLibraries({ ...options, ...invalid }), TypeError);
	}
	assert.deepEqual(await readdir(paths.root), []);
});
