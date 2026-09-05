/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const OWNER = Object.freeze({ name: 'published-file-mode-owner' });
const POSIX_ONLY = { skip: process.platform === 'win32' };
const PAYLOAD = Uint8Array.of(1, 2, 3, 4);

type ManagerOptions = ConstructorParameters<typeof AtomicSaveManager>[0];

/** The manager reads its options off a JavaScript default, so the store goes through its constructor type. */
function createManager(options: Readonly<Record<string, unknown>>): AtomicSaveManager {
	return new AtomicSaveManager(options as unknown as ManagerOptions);
}

test('a published save takes the platform default mode, not the staging mode', POSIX_ONLY, async (context) => {
	const root = await temporaryRoot(context);
	const destination = join(root, 'export.wav');

	await publish(destination, PAYLOAD);

	assert.equal(
		(await stat(destination)).mode & 0o777,
		0o666 & ~process.umask(),
		'a desktop save must publish the mode a plain write would give',
	);
});

test('publishing over an existing file keeps that file mode', POSIX_ONLY, async (context) => {
	const root = await temporaryRoot(context);
	const destination = join(root, 'shared-export.wav');
	await writeFile(destination, 'previous export');
	await chmod(destination, 0o644);

	await publish(destination, PAYLOAD);

	assert.equal(
		(await stat(destination)).mode & 0o777,
		0o644,
		're-exporting must not narrow the destination that was already published',
	);
});

test('publishing over a deliberately private file does not widen it', POSIX_ONLY, async (context) => {
	const root = await temporaryRoot(context);
	const destination = join(root, 'private-export.wav');
	await writeFile(destination, 'previous export');
	await chmod(destination, 0o600);

	await publish(destination, PAYLOAD);

	assert.equal((await stat(destination)).mode & 0o777, 0o600, 'an owner-only destination stays owner-only');
});

test('the staging file stays owner-only while the save is in flight', POSIX_ONLY, async (context) => {
	const root = await temporaryRoot(context);
	const destination = join(root, 'in-flight.wav');
	const targets = new SaveTargetStore();
	const manager = createManager({ targets });
	context.after(() => manager.dispose());
	const target = targets.registerPath(destination, { owner: OWNER, purpose: 'audio-pcm-mix' });
	const { writeId } = await manager.begin({ owner: OWNER, targetId: target.id, size: PAYLOAD.byteLength });
	await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes: PAYLOAD });

	const staging = (await readdir(root)).filter((name) => name.endsWith('.soundscaper-part'));
	assert.equal(staging.length, 1, 'exactly one staging file is in flight');
	assert.equal(
		(await lstat(join(root, staging[0]!))).mode & 0o777,
		0o600,
		'a half-written export must not be readable by other local accounts',
	);

	await manager.finish(writeId, { owner: OWNER });
});

test('a save handle without chmod still finishes', POSIX_ONLY, async (context) => {
	const root = await temporaryRoot(context);
	const targets = new SaveTargetStore();
	const manager = createManager({
		targets,
		openImpl: async () => ({ async sync() {}, async close() {} }),
		renameImpl: async () => undefined,
		unlinkImpl: async () => undefined,
	});
	context.after(() => manager.dispose());
	const target = targets.registerPath(join(root, 'handle-without-chmod.scape'), {
		owner: OWNER,
		purpose: 'project',
	});
	const { writeId } = await manager.begin({ owner: OWNER, targetId: target.id, maximumSize: 4 });

	assert.deepEqual(await manager.finish(writeId, { owner: OWNER }), { byteLength: 0 });
});

async function publish(destination: string, bytes: Uint8Array): Promise<void> {
	const targets = new SaveTargetStore();
	const manager = createManager({ targets });
	try {
		const target = targets.registerPath(destination, { owner: OWNER, purpose: 'audio-pcm-mix' });
		const { writeId } = await manager.begin({ owner: OWNER, targetId: target.id, size: bytes.byteLength });
		await manager.writeChunk({ owner: OWNER, writeId, offset: 0, bytes });
		await manager.finish(writeId, { owner: OWNER });
	} finally {
		await manager.dispose();
	}
}

async function temporaryRoot(context: TestContext): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), 'soundscaper-published-mode-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	return root;
}
