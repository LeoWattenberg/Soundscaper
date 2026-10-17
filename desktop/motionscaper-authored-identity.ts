/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { hashMotionSustainedFile } from '../scripts/performance/motionscaper-sustained-observation.ts';

/** Retain both content and actual regular-file authority across the qualification. */
export async function motionAuthoredFileIdentity(path: string) {
	assert.equal(await realpath(path), path, 'Qualification input must have a canonical resolved path.');
	const before = await lstat(path), pin = await hashMotionSustainedFile(path), after = await lstat(path);
	const metadata = (value: typeof before) => ({ dev: value.dev, ino: value.ino, ctimeMs: value.ctimeMs, mtimeMs: value.mtimeMs, mode: value.mode, uid: value.uid, gid: value.gid });
	assert.deepEqual(metadata(after), metadata(before), 'Qualification input identity changed while hashing.');
	return { ...pin, ...metadata(after) };
}
export async function verifyMotionAuthoredFileIdentity(expected: Awaited<ReturnType<typeof motionAuthoredFileIdentity>>): Promise<void> {
	assert.deepEqual(await motionAuthoredFileIdentity(expected.path), expected, 'Qualification input identity changed.');
}

export async function motionAuthoredSourceIdentity(root: string): Promise<string> {
	const execute = promisify(execFile);
	const revision = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root, timeout: 10000 })).stdout.trim();
	assert.match(revision, /^[a-f0-9]{40}$/u);
	assert.equal((await execute('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root, timeout: 10000 })).stdout, '', 'Qualification requires clean committed source.');
	return revision;
}
/** Full package byte/inode custody supplements the maintained ASAR/stage verification. */
export async function motionAuthoredPackageIdentity(directory: string) {
	assert.equal(await realpath(directory), directory); const files: string[] = [];
	const visit = async (relative: string): Promise<void> => {
		assert.ok((await lstat(join(directory, relative))).isDirectory());
		for (const entry of await readdir(join(directory, relative), { withFileTypes: true })) {
			const name = relative ? `${relative}/${entry.name}` : entry.name;
			if (entry.isDirectory()) await visit(name); else { assert.ok(entry.isFile(), 'Package must not contain symlinks or special files.'); files.push(name); }
			assert.ok(files.length <= 4096);
		}
	};
	await visit(''); const records = [];
	for (const path of files.sort()) {
		const file = join(directory, path), before = await lstat(file), pin = await hashMotionSustainedFile(file), after = await lstat(file);
		assert.deepEqual([after.dev, after.ino, after.ctimeMs, after.mode], [before.dev, before.ino, before.ctimeMs, before.mode]);
		records.push({ ...pin, path, dev: after.dev, ino: after.ino, mode: after.mode, uid: after.uid, gid: after.gid });
	}
	const sandbox = records.find(file => file.path === 'chrome-sandbox'); assert.ok(sandbox); assert.equal(sandbox.uid, 0); assert.equal(sandbox.mode & 0o7777, 0o4755);
	return records;
}
