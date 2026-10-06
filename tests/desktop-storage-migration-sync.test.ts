/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import {
	constants as fsConstants, copyFileSync, lstatSync, mkdirSync, mkdtempSync,
	readFileSync, readSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { migrateDesktopStorageEntriesSync } from '../desktop/desktop-storage-migration-sync.ts';

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'scape-storage-sync-'));
	context.after(() => rmSync(root, { recursive: true, force: true }));
	return { root, source: join(root, 'source'), destination: join(root, 'xdg', 'browser') };
}

const crossDeviceRename: typeof renameSync = () => {
	throw Object.assign(new Error('Different filesystems'), { code: 'EXDEV' });
};

test('synchronous migration skips missing sources and the same normalized path', (context) => {
	const { root, source, destination } = fixture(context);
	migrateDesktopStorageEntriesSync([{ source, destination }]);
	assert.deepEqual(readdirSync(root), []);
	mkdirSync(source);
	writeFileSync(join(source, 'project'), 'project');
	migrateDesktopStorageEntriesSync([{ source, destination: join(source, '..', 'source') }]);
	assert.equal(readFileSync(join(source, 'project'), 'utf8'), 'project');
});

test('synchronous directory migration uses rename and creates private parents', (context) => {
	const { source, destination } = fixture(context);
	mkdirSync(source, { mode: 0o700 });
	writeFileSync(join(source, 'project'), 'project', { mode: 0o600 });
	const calls: string[][] = [];
	migrateDesktopStorageEntriesSync([{ source, destination }], {
		renameSync: (from, to) => { calls.push([String(from), String(to)]); renameSync(from, to); },
	});
	assert.deepEqual(calls, [[source, destination]]);
	assert.throws(() => lstatSync(source), /ENOENT/u);
	assert.equal(readFileSync(join(destination, 'project'), 'utf8'), 'project');
	assert.equal(lstatSync(join(destination, '..')).mode & 0o777, 0o700);
	assert.equal(lstatSync(join(destination, 'project')).mode & 0o777, 0o600);
});

test('synchronous cross-filesystem copies are exclusive and hash in bounded chunks', (context) => {
	const { source, destination } = fixture(context);
	mkdirSync(source);
	const bytes = Buffer.alloc(3 * 1_048_576 + 17, 7);
	bytes[bytes.length - 1] = 9;
	writeFileSync(join(source, 'opfs-file'), bytes, { mode: 0o400 });
	const lengths: number[] = [];
	migrateDesktopStorageEntriesSync([{ source, destination }], {
		renameSync: crossDeviceRename,
		copyFileSync: (from, to, mode) => {
			assert.equal(mode, fsConstants.COPYFILE_EXCL);
			copyFileSync(from, to, mode);
		},
		readSync: (descriptor, buffer, offset, length, position) => {
			lengths.push(length);
			return readSync(descriptor, buffer, offset, length, position);
		},
	});
	assert.deepEqual(lengths, [1_048_576, 1_048_576, 1_048_576, 17,
		1_048_576, 1_048_576, 1_048_576, 17]);
	assert.throws(() => lstatSync(source), /ENOENT/u);
	assert.deepEqual(readFileSync(join(destination, 'opfs-file')), bytes);
	assert.equal(lstatSync(join(destination, 'opfs-file')).mode & 0o777, 0o400);
});

test('synchronous merge and retry preserve unrelated destination data', (context) => {
	const { source, destination } = fixture(context);
	mkdirSync(source);
	mkdirSync(destination, { recursive: true });
	writeFileSync(join(source, 'identical'), 'identical');
	writeFileSync(join(destination, 'identical'), 'identical');
	writeFileSync(join(source, 'new'), 'new');
	writeFileSync(join(destination, 'keep'), 'keep');
	assert.throws(() => migrateDesktopStorageEntriesSync([{ source, destination }], {
		unlinkSync: () => { throw new Error('temporarily busy'); },
	}), /temporarily busy/u);
	assert.equal(readFileSync(join(source, 'identical'), 'utf8'), 'identical');
	migrateDesktopStorageEntriesSync([{ source, destination }]);
	migrateDesktopStorageEntriesSync([{ source, destination }]);
	assert.equal(readFileSync(join(destination, 'identical'), 'utf8'), 'identical');
	assert.equal(readFileSync(join(destination, 'new'), 'utf8'), 'new');
	assert.equal(readFileSync(join(destination, 'keep'), 'utf8'), 'keep');
	assert.throws(() => lstatSync(source), /ENOENT/u);
});

test('synchronous preflight checks every entry before moving any source', (context) => {
	const { root, source, destination } = fixture(context);
	mkdirSync(source);
	writeFileSync(join(source, 'new'), 'new');
	const conflictingSource = join(root, 'conflicting-source');
	const conflictingTarget = join(root, 'conflicting-target');
	writeFileSync(conflictingSource, 'source');
	writeFileSync(conflictingTarget, 'target');
	assert.throws(() => migrateDesktopStorageEntriesSync([
		{ source, destination }, { source: conflictingSource, destination: conflictingTarget },
	]), (error: unknown) => {
		assert.ok(error instanceof Error);
		assert.ok(error.message.includes(conflictingSource));
		assert.ok(error.message.includes(conflictingTarget));
		return true;
	});
	assert.equal(readFileSync(join(source, 'new'), 'utf8'), 'new');
	assert.equal(readFileSync(conflictingTarget, 'utf8'), 'target');
	assert.throws(() => lstatSync(destination), /ENOENT/u);
});

test('synchronous migration rejects file/directory conflicts and nested paths', (context) => {
	const { source, destination } = fixture(context);
	writeFileSync(source, 'source');
	mkdirSync(destination, { recursive: true });
	assert.throws(() => migrateDesktopStorageEntriesSync([{ source, destination }]), /conflict/iu);
	assert.equal(readFileSync(source, 'utf8'), 'source');
	assert.equal(lstatSync(destination).isDirectory(), true);
	for (const entry of [
		{ source: destination, destination: join(destination, 'nested') },
		{ source: join(destination, 'nested'), destination },
	]) assert.throws(() => migrateDesktopStorageEntriesSync([entry]), /overlap|nested/iu);
});

test('synchronous migration rejects symlink entries and ancestors without traversal', (context) => {
	const { root, source, destination } = fixture(context);
	mkdirSync(source);
	const outside = join(root, 'outside');
	writeFileSync(outside, 'outside');
	symlinkSync(outside, join(source, 'link'));
	assert.throws(() => migrateDesktopStorageEntriesSync([{ source, destination }]), /symbolic|symlink/iu);
	assert.equal(lstatSync(join(source, 'link')).isSymbolicLink(), true);
	assert.equal(readFileSync(outside, 'utf8'), 'outside');
	const alias = join(root, 'alias');
	symlinkSync(root, alias, 'dir');
	assert.throws(() => migrateDesktopStorageEntriesSync([
		{ source: join(alias, 'source'), destination },
	]), /symbolic|symlink/iu);
	assert.throws(() => lstatSync(destination), /ENOENT/u);
});

test('synchronous corrupt-copy failure preserves source and destination bytes', (context) => {
	const { source, destination } = fixture(context);
	writeFileSync(source, 'source');
	assert.throws(() => migrateDesktopStorageEntriesSync([{ source, destination }], {
		copyFileSync: (from, to, mode) => { copyFileSync(from, to, mode); writeFileSync(to, 'broken'); },
	}), /verification|conflict/iu);
	assert.equal(readFileSync(source, 'utf8'), 'source');
	assert.equal(readFileSync(destination, 'utf8'), 'broken');
});
