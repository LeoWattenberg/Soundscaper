/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { constants as fsConstants } from 'node:fs';
import {
	chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink,
	unlink, writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { migrateDesktopStorageEntries } from '../desktop/desktop-storage-migration.ts';

async function fixture(context: TestContext) {
	const root = await mkdtemp(join(tmpdir(), 'scape-storage-migration-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return { root, source: join(root, 'source'), destination: join(root, 'xdg', 'data') };
}

const crossDeviceRename: typeof rename = async () => {
	throw Object.assign(new Error('Different filesystems'), { code: 'EXDEV' });
};

test('missing storage and the same normalized path leave the filesystem untouched', async (context) => {
	const { root, source, destination } = await fixture(context);
	await migrateDesktopStorageEntries([{ source, destination }]);
	assert.deepEqual(await readdir(root), []);
	await mkdir(source);
	await writeFile(join(source, 'settings.json'), 'settings');
	await migrateDesktopStorageEntries([{ source, destination: join(source, '..', 'source') }]);
	assert.equal(await readFile(join(source, 'settings.json'), 'utf8'), 'settings');
	await assert.rejects(lstat(destination), /ENOENT/u);
});

test('a new destination moves the directory with rename and creates private parents', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source, { mode: 0o700 });
	await writeFile(join(source, 'model.bin'), 'model bytes', { mode: 0o600 });
	const calls: string[][] = [];
	await migrateDesktopStorageEntries([{ source, destination }], {
		rename: async (from, to) => { calls.push([String(from), String(to)]); await rename(from, to); },
	});
	assert.deepEqual(calls, [[source, destination]]);
	await assert.rejects(lstat(source), /ENOENT/u);
	assert.equal(await readFile(join(destination, 'model.bin'), 'utf8'), 'model bytes');
	assert.equal((await lstat(join(destination, '..'))).mode & 0o777, 0o700);
	assert.equal((await lstat(join(destination, 'model.bin'))).mode & 0o777, 0o600);
});

test('cross-filesystem migration copies exclusively and preserves restrictive file modes', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(join(source, 'nested'), { recursive: true, mode: 0o700 });
	await writeFile(join(source, 'nested', 'model.bin'), 'model bytes', { mode: 0o400 });
	await chmod(join(source, 'nested', 'model.bin'), 0o400);
	const copyModes: (number | undefined)[] = [];
	await migrateDesktopStorageEntries([{ source, destination }], {
		rename: crossDeviceRename,
		copyFile: async (from, to, mode) => { copyModes.push(mode); await copyFile(from, to, mode); },
	});
	assert.deepEqual(copyModes, [fsConstants.COPYFILE_EXCL]);
	await assert.rejects(lstat(source), /ENOENT/u);
	assert.equal(await readFile(join(destination, 'nested', 'model.bin'), 'utf8'), 'model bytes');
	assert.equal((await lstat(join(destination, 'nested', 'model.bin'))).mode & 0o777, 0o400);
	assert.equal((await lstat(join(destination, 'nested'))).mode & 0o777, 0o700);
});

test('existing directories merge without removing unrelated destination files', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(join(source, 'nested'), { recursive: true });
	await mkdir(join(destination, 'nested'), { recursive: true });
	await writeFile(join(source, 'nested', 'same'), 'identical');
	await writeFile(join(destination, 'nested', 'same'), 'identical');
	await writeFile(join(source, 'new'), 'new project');
	await writeFile(join(destination, 'keep'), 'existing project');
	await migrateDesktopStorageEntries([{ source, destination }]);
	await migrateDesktopStorageEntries([{ source, destination }]);
	await assert.rejects(lstat(source), /ENOENT/u);
	assert.equal(await readFile(join(destination, 'nested', 'same'), 'utf8'), 'identical');
	assert.equal(await readFile(join(destination, 'new'), 'utf8'), 'new project');
	assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'existing project');
});

test('a cleanup interruption resumes from authenticated duplicate files', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source);
	await writeFile(join(source, 'project'), 'project bytes');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }], {
		rename: crossDeviceRename,
		unlink: async () => { throw new Error('source temporarily busy'); },
	}), /source temporarily busy/u);
	assert.equal(await readFile(join(source, 'project'), 'utf8'), 'project bytes');
	assert.equal(await readFile(join(destination, 'project'), 'utf8'), 'project bytes');
	await migrateDesktopStorageEntries([{ source, destination }]);
	await assert.rejects(lstat(source), /ENOENT/u);
	assert.equal(await readFile(join(destination, 'project'), 'utf8'), 'project bytes');
});

test('same-size differing files reject before moving any source entries', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source);
	await mkdir(destination, { recursive: true });
	await writeFile(join(source, 'a-new'), 'new');
	await writeFile(join(source, 'z-conflict'), 'source');
	await writeFile(join(destination, 'z-conflict'), 'target');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(error.message.includes(join(source, 'z-conflict')));
		assert.ok(error.message.includes(join(destination, 'z-conflict')));
		assert.match(error.message, /resolve|conflict|different/iu);
		return true;
	});
	assert.equal(await readFile(join(source, 'a-new'), 'utf8'), 'new');
	assert.equal(await readFile(join(source, 'z-conflict'), 'utf8'), 'source');
	assert.equal(await readFile(join(destination, 'z-conflict'), 'utf8'), 'target');
	await assert.rejects(lstat(join(destination, 'a-new')), /ENOENT/u);
});

test('file and directory collisions preserve both sides', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source);
	await mkdir(destination, { recursive: true });
	await writeFile(join(source, 'file'), 'source');
	await mkdir(join(destination, 'file'));
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /conflict|directory/iu);
	assert.equal(await readFile(join(source, 'file'), 'utf8'), 'source');
	assert.equal((await lstat(join(destination, 'file'))).isDirectory(), true);
	await unlink(join(source, 'file'));
	await mkdir(join(source, 'directory'));
	await writeFile(join(destination, 'directory'), 'destination');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /conflict|directory/iu);
	assert.equal((await lstat(join(source, 'directory'))).isDirectory(), true);
	assert.equal(await readFile(join(destination, 'directory'), 'utf8'), 'destination');
});

test('symlinks inside a source tree reject before a directory rename', async (context) => {
	const { root, source, destination } = await fixture(context);
	await mkdir(source);
	const outside = join(root, 'outside');
	await writeFile(outside, 'unrelated bytes');
	await symlink(outside, join(source, 'link'));
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /symlink|symbolic/iu);
	assert.equal((await lstat(join(source, 'link'))).isSymbolicLink(), true);
	assert.equal(await readFile(outside, 'utf8'), 'unrelated bytes');
	await assert.rejects(lstat(destination), /ENOENT/u);
});

test('source and destination symlinks never traverse their targets', async (context) => {
	const { root, source, destination } = await fixture(context);
	const outside = join(root, 'outside');
	await mkdir(outside);
	await writeFile(join(outside, 'project'), 'outside');
	await symlink(outside, source, 'dir');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /symlink|symbolic/iu);
	await unlink(source);
	await mkdir(source);
	await writeFile(join(source, 'project'), 'source');
	await mkdir(join(destination, '..'), { recursive: true });
	await symlink(outside, destination, 'dir');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /symlink|symbolic/iu);
	assert.equal(await readFile(join(source, 'project'), 'utf8'), 'source');
	assert.equal(await readFile(join(outside, 'project'), 'utf8'), 'outside');
	assert.equal((await lstat(destination)).isSymbolicLink(), true);
});

test('symlink ancestors of either migration path reject', async (context) => {
	const { root, source, destination } = await fixture(context);
	await mkdir(source);
	await writeFile(join(source, 'project'), 'source');
	const alias = join(root, 'alias');
	await symlink(root, alias, 'dir');
	await assert.rejects(migrateDesktopStorageEntries([
		{ source: join(alias, 'source'), destination },
	]), /symlink|symbolic/iu);
	await assert.rejects(migrateDesktopStorageEntries([
		{ source, destination: join(alias, 'new') },
	]), /symlink|symbolic/iu);
	assert.equal(await readFile(join(source, 'project'), 'utf8'), 'source');
});

test('nested migration paths reject before creating directories', async (context) => {
	const { source } = await fixture(context);
	await mkdir(source);
	await writeFile(join(source, 'project'), 'source');
	for (const entry of [
		{ source, destination: join(source, 'nested') },
		{ source: join(source, 'nested'), destination: source },
	]) await assert.rejects(migrateDesktopStorageEntries([entry]), /nested|overlap/iu);
	assert.deepEqual(await readdir(source), ['project']);
});

test('copy verification failures preserve source and all destination files', async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source);
	await mkdir(destination, { recursive: true });
	await writeFile(join(source, 'project'), 'source');
	await writeFile(join(destination, 'keep'), 'keep');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }], {
		copyFile: async (from, to, mode) => {
			await copyFile(from, to, mode);
			await writeFile(to, 'broken');
		},
	}), /verification|different|conflict/iu);
	assert.equal(await readFile(join(source, 'project'), 'utf8'), 'source');
	assert.equal(await readFile(join(destination, 'project'), 'utf8'), 'broken');
	assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'keep');
});

test('a destination created during copy is never overwritten', async (context) => {
	const { source, destination } = await fixture(context);
	await writeFile(source, 'source');
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }], {
		copyFile: async (from, to, mode) => {
			await writeFile(to, 'concurrent destination', { flag: 'wx' });
			await copyFile(from, to, mode);
		},
	}), /conflict|different|EEXIST/iu);
	assert.equal(await readFile(source, 'utf8'), 'source');
	assert.equal(await readFile(destination, 'utf8'), 'concurrent destination');
});

test('irregular source entries reject without renaming the tree', {
	skip: process.platform === 'win32',
}, async (context) => {
	const { source, destination } = await fixture(context);
	await mkdir(source);
	const server = createServer();
	await new Promise<void>((resolve, reject) => {
		server.once('error', reject);
		server.listen(join(source, 'socket'), resolve);
	});
	context.after(() => new Promise<void>((resolve, reject) => {
		server.close((error) => { if (error) reject(error); else resolve(); });
	}));
	await assert.rejects(migrateDesktopStorageEntries([{ source, destination }]), /regular|unsupported|irregular/iu);
	assert.equal((await lstat(source)).isDirectory(), true);
	await assert.rejects(lstat(destination), /ENOENT/u);
});
