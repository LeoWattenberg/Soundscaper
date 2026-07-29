/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { AtomicSaveManager, SaveTargetStore } from '../desktop/save-targets.js';

const OWNER_A = Object.freeze({ name: 'renderer-owner-a' });
const OWNER_B = Object.freeze({ name: 'renderer-owner-b' });

test('a renderer cannot consume another renderer save target', async (context) => {
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({ async close() {} }),
		unlinkImpl: async () => undefined,
	});
	context.after(() => manager.dispose());
	const target = targets.registerPath('/tmp/owner-a-target.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});

	await assert.rejects(
		manager.begin({ owner: OWNER_B, targetId: target.id, maximumSize: 1 }),
		/owner|renderer|capability/iu,
	);
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	await manager.abort(session.writeId, { owner: OWNER_A });
});

test('omitting the renderer owner rejects without consuming its save target', async (context) => {
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({ async close() {} }),
		unlinkImpl: async () => undefined,
	});
	context.after(() => manager.dispose());
	assert.throws(
		() => targets.registerPath('/tmp/primitive-owner.scape', { owner: 'renderer-owner', purpose: 'project' }),
		/owner.*object|reference/iu,
	);
	const target = targets.registerPath('/tmp/required-owner.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});

	await assert.rejects(
		manager.begin({ targetId: target.id, maximumSize: 1 }),
		/owner|renderer/iu,
	);
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	await manager.abort(session.writeId, { owner: OWNER_A });
});

for (const operation of ['write', 'finish', 'abort']) {
	test(`a renderer cannot ${operation} another renderer save session`, async (context) => {
		const events = [];
		const targets = new SaveTargetStore();
		const manager = new AtomicSaveManager({
			targets,
			openImpl: async () => ({
				async write(_buffer, _offset, length) {
					events.push('write');
					return { bytesWritten: length };
				},
				async sync() { events.push('sync'); },
				async close() { events.push('close'); },
			}),
			renameImpl: async () => { events.push('rename'); },
			unlinkImpl: async () => { events.push('unlink'); },
		});
		context.after(() => manager.dispose());
		const target = targets.registerPath(`/tmp/owner-session-${operation}.scape`, {
			owner: OWNER_A,
			purpose: 'project',
		});
		const session = await manager.begin({
			owner: OWNER_A,
			targetId: target.id,
			maximumSize: 1,
		});

		const unauthorized = operation === 'write'
			? manager.writeChunk({
				owner: OWNER_B,
				writeId: session.writeId,
				offset: 0,
				bytes: Uint8Array.of(1),
			})
			: operation === 'finish'
				? manager.finish(session.writeId, { owner: OWNER_B })
				: manager.abort(session.writeId, { owner: OWNER_B });
		await assert.rejects(unauthorized, /owner|renderer|capability/iu);

		if (operation === 'write') {
			assert.deepEqual(events, []);
			await manager.writeChunk({
				owner: OWNER_A,
				writeId: session.writeId,
				offset: 0,
				bytes: Uint8Array.of(1),
			});
			await manager.finish(session.writeId, { owner: OWNER_A });
		} else if (operation === 'finish') {
			assert.deepEqual(events, []);
			await manager.finish(session.writeId, { owner: OWNER_A });
		} else {
			assert.deepEqual(events, []);
			await manager.abort(session.writeId, { owner: OWNER_A });
		}
	});
}

test('owner revocation fences admission and drains an admitted staging open', async (context) => {
	const opening = deferred();
	const openStarted = deferred();
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => {
			events.push('open');
			openStarted.resolve();
			await opening.promise;
			return { async close() { events.push('close'); } };
		},
		unlinkImpl: async () => { events.push('unlink'); },
	});
	context.after(async () => {
		opening.resolve();
		await manager.dispose();
	});
	const activeTarget = targets.registerPath('/tmp/owner-open-active.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const unusedTarget = targets.registerPath('/tmp/owner-open-unused.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const beginning = manager.begin({
		owner: OWNER_A,
		targetId: activeTarget.id,
		maximumSize: 1,
	});
	await openStarted.promise;

	let revoked = false;
	const revoking = manager.revokeOwner(OWNER_A);
	void revoking.then(() => { revoked = true; });
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: unusedTarget.id, maximumSize: 1 }),
		/revoked|owner/iu,
	);
	await Promise.resolve();
	assert.equal(revoked, false, 'revocation waits for an admitted open');
	opening.resolve();
	await Promise.all([beginning, revoking]);

	assert.deepEqual(events, ['open', 'close', 'unlink']);
});

test('owner revocation drains an admitted write before removing its staging file', async (context) => {
	const writing = deferred();
	const writeStarted = deferred();
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async write(_buffer, _offset, length) {
				events.push('write');
				writeStarted.resolve();
				await writing.promise;
				return { bytesWritten: length };
			},
			async close() { events.push('close'); },
		}),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	context.after(async () => {
		writing.resolve();
		await manager.dispose();
	});
	const target = targets.registerPath('/tmp/owner-write.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	const admittedWrite = manager.writeChunk({
		owner: OWNER_A,
		writeId: session.writeId,
		offset: 0,
		bytes: Uint8Array.of(1),
	});
	await writeStarted.promise;

	let revoked = false;
	const revoking = manager.revokeOwner(OWNER_A);
	void revoking.then(() => { revoked = true; });
	await assert.rejects(
		manager.writeChunk({ owner: OWNER_A, writeId: session.writeId, offset: 1, bytes: new Uint8Array() }),
		/revoked|owner/iu,
	);
	await Promise.resolve();
	assert.equal(revoked, false, 'revocation waits for an admitted write');
	assert.deepEqual(events, ['write']);
	writing.resolve();
	await Promise.all([admittedWrite, revoking]);

	assert.deepEqual(events, ['write', 'close', 'unlink']);
});

test('owner revocation drains an admitted finish through atomic rename', async (context) => {
	const syncing = deferred();
	const syncStarted = deferred();
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async sync() {
				events.push('sync');
				syncStarted.resolve();
				await syncing.promise;
			},
			async close() { events.push('close'); },
		}),
		renameImpl: async () => { events.push('rename'); },
		unlinkImpl: async () => { events.push('unlink'); },
	});
	context.after(async () => {
		syncing.resolve();
		await manager.dispose();
	});
	const target = targets.registerPath('/tmp/owner-finish.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	const admittedFinish = manager.finish(session.writeId, { owner: OWNER_A });
	await syncStarted.promise;

	let revoked = false;
	const revoking = manager.revokeOwner(OWNER_A);
	void revoking.then(() => { revoked = true; });
	await assert.rejects(manager.abort(session.writeId, { owner: OWNER_A }), /revoked|owner/iu);
	await Promise.resolve();
	assert.equal(revoked, false, 'revocation waits for the admitted commit boundary');
	syncing.resolve();
	assert.deepEqual(await admittedFinish, { byteLength: 0 });
	await revoking;

	assert.deepEqual(events, ['sync', 'close', 'rename']);
});

test('a replacement owner cannot overtake the revoked owner commit boundary', async (context) => {
	const syncing = deferred();
	const syncStarted = deferred();
	const events = [];
	let openIndex = 0;
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => {
			const index = openIndex++;
			events.push(`open-${index}`);
			return index === 0
				? {
					async sync() {
						events.push('sync-0');
						syncStarted.resolve();
						await syncing.promise;
					},
					async close() { events.push('close-0'); },
				}
				: { async close() { events.push('close-1'); } };
		},
		renameImpl: async () => { events.push('rename-0'); },
		unlinkImpl: async () => { events.push('unlink-1'); },
	});
	context.after(async () => {
		syncing.resolve();
		await manager.dispose();
	});
	const oldTarget = targets.registerPath('/tmp/owner-ordering.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const oldSession = await manager.begin({ owner: OWNER_A, targetId: oldTarget.id, maximumSize: 1 });
	const oldFinish = manager.finish(oldSession.writeId, { owner: OWNER_A });
	await syncStarted.promise;
	const revoking = manager.revokeOwner(OWNER_A);

	const replacementTarget = targets.registerPath('/tmp/owner-ordering.scape', {
		owner: OWNER_B,
		purpose: 'project',
	});
	const replacementBegin = manager.begin({
		owner: OWNER_B,
		targetId: replacementTarget.id,
		maximumSize: 1,
	});
	await Promise.resolve();
	assert.deepEqual(events, ['open-0', 'sync-0'], 'replacement staging waits behind the old commit');

	syncing.resolve();
	await Promise.all([oldFinish, revoking]);
	const replacementSession = await replacementBegin;
	await manager.abort(replacementSession.writeId, { owner: OWNER_B });
	assert.deepEqual(events, [
		'open-0',
		'sync-0',
		'close-0',
		'rename-0',
		'open-1',
		'close-1',
		'unlink-1',
	]);
});

test('concurrent owner revocation calls share one drain and cleanup barrier', async (context) => {
	const writing = deferred();
	const writeStarted = deferred();
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async write(_buffer, _offset, length) {
				events.push('write');
				writeStarted.resolve();
				await writing.promise;
				return { bytesWritten: length };
			},
			async close() { events.push('close'); },
		}),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	context.after(async () => {
		writing.resolve();
		await manager.dispose();
	});
	const target = targets.registerPath('/tmp/owner-idempotent.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	const admittedWrite = manager.writeChunk({
		owner: OWNER_A,
		writeId: session.writeId,
		offset: 0,
		bytes: Uint8Array.of(1),
	});
	await writeStarted.promise;

	const first = manager.revokeOwner(OWNER_A);
	const second = manager.revokeOwner(OWNER_A);
	assert.equal(second, first);
	writing.resolve();
	await Promise.all([admittedWrite, first, second]);

	assert.deepEqual(events, ['write', 'close', 'unlink']);
});

test('revocation invalidates one owner unused targets without fencing a fresh owner', async (context) => {
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({ async close() {} }),
		unlinkImpl: async () => undefined,
	});
	context.after(() => manager.dispose());
	const revokedTarget = targets.registerPath('/tmp/revoked-unused.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const freshTarget = targets.registerPath('/tmp/fresh-unused.scape', {
		owner: OWNER_B,
		purpose: 'project',
	});

	await manager.revokeOwner(OWNER_A);
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: revokedTarget.id, maximumSize: 1 }),
		/revoked|owner/iu,
	);
	const session = await manager.begin({ owner: OWNER_B, targetId: freshTarget.id, maximumSize: 1 });
	await manager.abort(session.writeId, { owner: OWNER_B });
});

test('owner revocation rejects when staging cleanup is not acknowledged', async (context) => {
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async close() { throw new Error('injected owner close failure'); },
		}),
		unlinkImpl: async () => { throw new Error('injected owner unlink failure'); },
	});
	context.after(() => manager.dispose().catch(() => undefined));
	const target = targets.registerPath('/tmp/owner-cleanup-failure.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });

	await assert.rejects(manager.revokeOwner(OWNER_A), (error) => {
		assert.ok(error instanceof AggregateError);
		assert.match(error.message, /owner|save staging cleanup failed/iu);
		assert.deepEqual(
			new Set(error.errors.map((failure) => failure.message)),
			new Set(['Could not close the temporary save file', 'Could not remove the temporary save file']),
		);
		return true;
	});
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: 'late', maximumSize: 1 }),
		/revoked|owner/iu,
	);
});

test('owner revocation drains an admitted abort through staging cleanup', async (context) => {
	const closing = deferred();
	const closeStarted = deferred();
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({
			async close() {
				events.push('close');
				closeStarted.resolve();
				await closing.promise;
			},
		}),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	context.after(async () => {
		closing.resolve();
		await manager.dispose();
	});
	const target = targets.registerPath('/tmp/owner-abort-active.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });
	const admittedAbort = manager.abort(session.writeId, { owner: OWNER_A });
	await closeStarted.promise;

	let revoked = false;
	const revoking = manager.revokeOwner(OWNER_A);
	void revoking.then(() => { revoked = true; });
	await Promise.resolve();
	assert.equal(revoked, false, 'revocation waits for admitted abort cleanup');
	assert.deepEqual(events, ['close']);
	closing.resolve();
	assert.equal(await admittedAbort, true);
	await revoking;

	assert.deepEqual(events, ['close', 'unlink']);
});

test('owner revocation racing terminal disposal joins the shutdown barrier', async () => {
	const events = [];
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({
		targets,
		openImpl: async () => ({ async close() { events.push('close'); } }),
		unlinkImpl: async () => { events.push('unlink'); },
	});
	const target = targets.registerPath('/tmp/owner-dispose-race.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 });

	const disposing = manager.dispose();
	const revoking = manager.revokeOwner(OWNER_A);
	assert.equal(revoking, disposing);
	await Promise.all([disposing, revoking]);
	assert.deepEqual(events, ['close', 'unlink']);
});

test('a save dialog result cannot register a target after its renderer owner is revoked', async (context) => {
	const dialogResult = deferred();
	const targets = new SaveTargetStore();
	const manager = new AtomicSaveManager({ targets });
	context.after(() => manager.dispose());
	const choosing = (async () => {
		const filePath = await dialogResult.promise;
		return targets.registerPath(filePath, { owner: OWNER_A, purpose: 'project' });
	})();

	await manager.revokeOwner(OWNER_A);
	dialogResult.resolve('/tmp/late-dialog-result.scape');
	await assert.rejects(choosing, /revoked|owner/iu);

	const target = targets.registerPath('/tmp/new-renderer-target.scape', {
		owner: OWNER_B,
		purpose: 'project',
	});
	const session = await manager.begin({ owner: OWNER_B, targetId: target.id, maximumSize: 1 });
	await manager.abort(session.writeId, { owner: OWNER_B });
});

function deferred() {
	let resolve;
	const promise = new Promise((complete) => { resolve = complete; });
	return { promise, resolve };
}
