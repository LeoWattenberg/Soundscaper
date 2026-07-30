/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	MAX_DESKTOP_SAVE_BYTES,
	MAX_SAVE_ADMITTED_BYTES,
	MAX_SAVE_SESSIONS,
	MAX_SAVE_TARGETS,
} from '../desktop/constants.js';
import { AtomicSaveManager, SAVE_LIMITS, SaveTargetStore } from '../desktop/save-targets.js';

const OWNER_A = Object.freeze({ name: 'capacity-owner-a' });
const OWNER_B = Object.freeze({ name: 'capacity-owner-b' });

test('production save-capacity limits are fixed and constructor seams can only lower them', () => {
	assert.deepEqual({
		targets: MAX_SAVE_TARGETS,
		sessions: MAX_SAVE_SESSIONS,
		maximumSaveBytes: MAX_DESKTOP_SAVE_BYTES,
		admittedBytes: MAX_SAVE_ADMITTED_BYTES,
	}, {
		targets: 16,
		sessions: 4,
		maximumSaveBytes: 65 * 1024 ** 3,
		admittedBytes: 65 * 1024 ** 3,
	});
	assert.deepEqual(SAVE_LIMITS, {
		chunkBytes: 1024 * 1024,
		audioPcmChunkBytes: 4 * 1024 * 1024,
		totalBytes: MAX_DESKTOP_SAVE_BYTES,
		targets: MAX_SAVE_TARGETS,
		sessions: MAX_SAVE_SESSIONS,
		admittedBytes: MAX_SAVE_ADMITTED_BYTES,
	});
	assert.throws(
		() => new SaveTargetStore({ maximumTargets: MAX_SAVE_TARGETS + 1 }),
		/target.*(?:hard|limit|greater)/iu,
	);
	for (const options of [
		{ maximumSessions: MAX_SAVE_SESSIONS + 1 },
		{ maximumSaveBytes: MAX_DESKTOP_SAVE_BYTES + 1 },
		{ maximumAdmittedBytes: MAX_SAVE_ADMITTED_BYTES + 1 },
	]) {
		assert.throws(
			() => new AtomicSaveManager({ targets: new SaveTargetStore(), ...options }),
			/(?:session|save|admitted).*(?:hard|limit|greater)/iu,
		);
	}
	const targets = new SaveTargetStore();
	try {
		for (let index = 0; index < MAX_SAVE_TARGETS; index += 1) {
			targets.registerPath(`/tmp/default-target-${index}.scape`, { owner: OWNER_A, purpose: 'project' });
		}
		assert.throws(
			() => targets.registerPath('/tmp/default-target-excess.scape', { owner: OWNER_B, purpose: 'project' }),
			/target.*(?:capacity|count|limit)/iu,
		);
	} finally {
		targets.dispose();
	}
});

test('save-target capacity is product-wide and registration sweeps expired targets', () => {
	let now = 100;
	const targets = new SaveTargetStore({ maximumTargets: 2, ttlMs: 10, now: () => now });
	try {
		const first = targets.registerPath('/tmp/target-a.scape', { owner: OWNER_A, purpose: 'project' });
		const second = targets.registerPath('/tmp/target-b.scape', { owner: OWNER_B, purpose: 'project' });
		assert.throws(
			() => targets.registerPath('/tmp/target-excess.scape', { owner: OWNER_A, purpose: 'project' }),
			/target.*(?:capacity|count|limit)/iu,
		);
		assert.equal(targets.consume(first.id, { owner: OWNER_A })?.name, 'target-a.scape');
		const replacement = targets.registerPath('/tmp/target-replacement.scape', {
			owner: OWNER_A,
			purpose: 'project',
		});
		assert.equal(replacement.name, 'target-replacement.scape');

		now = 111;
		const afterExpiry = targets.registerPath('/tmp/target-after-expiry.scape', {
			owner: OWNER_A,
			purpose: 'project',
		});
		assert.equal(afterExpiry.name, 'target-after-expiry.scape');
		assert.equal(targets.consume(second.id, { owner: OWNER_B }), null);
	} finally {
		targets.dispose();
	}
});

test('pending save sessions reserve their slot synchronously before statfs', async () => {
	const continueStat = deferred();
	let statCalls = 0;
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const firstTarget = targets.registerPath('/tmp/pending-a.scape', { owner: OWNER_A, purpose: 'project' });
	const secondTarget = targets.registerPath('/tmp/pending-b.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 1,
		maximumSaveBytes: 10,
		maximumAdmittedBytes: 10,
		statfsImpl: async () => {
			statCalls += 1;
			await continueStat.promise;
			return availableBytes(10);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	const first = manager.begin({ owner: OWNER_A, targetId: firstTarget.id, maximumSize: 1 });
	await Promise.resolve();
	const second = manager.begin({ owner: OWNER_A, targetId: secondTarget.id, maximumSize: 1 });
	await Promise.resolve();
	continueStat.resolve();
	const [firstResult, secondResult] = await Promise.allSettled([first, second]);
	try {
		assert.equal(firstResult.status, 'fulfilled');
		assert.equal(secondResult.status, 'rejected');
		if (secondResult.status === 'rejected') {
			assert.match(secondResult.reason.message, /session.*(?:capacity|count|limit)/iu);
		}
		assert.equal(statCalls, 1);
		assert.equal(openCalls, 1);
		if (firstResult.status !== 'fulfilled') return;
		await manager.abort(firstResult.value.writeId, { owner: OWNER_A });
		const replacement = await manager.begin({ owner: OWNER_A, targetId: secondTarget.id, maximumSize: 1 });
		await manager.abort(replacement.writeId, { owner: OWNER_A });
	} finally {
		continueStat.resolve();
		await manager.dispose().catch(() => undefined);
	}
});

test('the default session boundary is product-wide across renderer owners', async () => {
	const targets = new SaveTargetStore();
	const owners = [OWNER_A, OWNER_B, OWNER_A, OWNER_B];
	const descriptors = owners.map((owner, index) => targets.registerPath(
		`/tmp/default-session-${index}.scape`,
		{ owner, purpose: 'project' },
	));
	const excess = targets.registerPath('/tmp/default-session-excess.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		statfsImpl: async () => availableBytes(MAX_SAVE_ADMITTED_BYTES),
		openImpl: async () => fakeHandle(),
		unlinkImpl: async () => undefined,
	});
	const sessions = await Promise.all(descriptors.map((target, index) => manager.begin({
		owner: owners[index],
		targetId: target.id,
		maximumSize: 1,
	})));
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: excess.id, maximumSize: 1 }),
		/session.*(?:capacity|count|limit)/iu,
	);
	await Promise.all(sessions.map((session, index) => manager.abort(session.writeId, { owner: owners[index] })));
	await manager.dispose();
});

test('fresh-owner begins reserve capacity before waiting for a prior owner revocation', async () => {
	const closeStarted = deferred();
	const continueClose = deferred();
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const oldTarget = targets.registerPath('/tmp/revoking-owner.scape', { owner: OWNER_A, purpose: 'project' });
	const firstFreshTarget = targets.registerPath('/tmp/fresh-owner-a.scape', { owner: OWNER_B, purpose: 'project' });
	const secondFreshTarget = targets.registerPath('/tmp/fresh-owner-b.scape', { owner: OWNER_B, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 2,
		maximumSaveBytes: 1,
		maximumAdmittedBytes: 2,
		statfsImpl: async () => availableBytes(2),
		openImpl: async () => {
			openCalls += 1;
			return openCalls === 1
				? fakeHandle({ closeImpl: async () => {
					closeStarted.resolve();
					await continueClose.promise;
				} })
				: fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	const oldSession = await manager.begin({ owner: OWNER_A, targetId: oldTarget.id, maximumSize: 1 });
	assert.ok(oldSession.writeId);
	const revoking = manager.revokeOwner(OWNER_A);
	await closeStarted.promise;
	const firstFresh = manager.begin({ owner: OWNER_B, targetId: firstFreshTarget.id, maximumSize: 1 });
	const secondFresh = manager.begin({ owner: OWNER_B, targetId: secondFreshTarget.id, maximumSize: 1 });
	let secondOutcome;
	void secondFresh.then(
		(value) => { secondOutcome = { status: 'fulfilled', value }; },
		(reason) => { secondOutcome = { status: 'rejected', reason }; },
	);
	try {
		await Promise.resolve();
		await Promise.resolve();
		assert.equal(secondOutcome?.status, 'rejected', 'capacity rejects before the prior revocation drains');
		assert.match(secondOutcome.reason.message, /session.*(?:capacity|count|limit)/iu);
	} finally {
		continueClose.resolve();
	}
	await Promise.allSettled([firstFresh, secondFresh, revoking]);
	await manager.dispose();
});

test('aggregate admitted bytes reserve exact boundaries and release after cleanup', async () => {
	let statCalls = 0;
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const descriptors = ['six', 'four', 'one'].map((name) => targets.registerPath(
		`/tmp/${name}.scape`,
		{ owner: OWNER_A, purpose: 'project' },
	));
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 3,
		maximumSaveBytes: 10,
		maximumAdmittedBytes: 10,
		statfsImpl: async () => {
			statCalls += 1;
			return availableBytes(10);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	const six = await manager.begin({ owner: OWNER_A, targetId: descriptors[0].id, maximumSize: 6 });
	const four = await manager.begin({ owner: OWNER_A, targetId: descriptors[1].id, maximumSize: 4 });
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: descriptors[2].id, maximumSize: 1 }),
		/admitted.*(?:byte|capacity|limit)|aggregate.*(?:byte|capacity|limit)/iu,
	);
	assert.equal(statCalls, 2);
	assert.equal(openCalls, 2, 'aggregate excess must reject before stat or staging open');

	await manager.abort(six.writeId, { owner: OWNER_A });
	const one = await manager.begin({ owner: OWNER_A, targetId: descriptors[2].id, maximumSize: 1 });
	await manager.abort(four.writeId, { owner: OWNER_A });
	await manager.abort(one.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('disk admission checks exact statfs arguments against cross-owner aggregate bytes', async () => {
	const statfsCalls = [];
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const firstTarget = targets.registerPath('/tmp/aggregate-disk-a.scape', { owner: OWNER_A, purpose: 'project' });
	const secondTarget = targets.registerPath('/tmp/aggregate-disk-b.scape', { owner: OWNER_B, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 2,
		maximumSaveBytes: 10,
		maximumAdmittedBytes: 10,
		statfsImpl: async (...args) => {
			statfsCalls.push(args);
			return availableBytes(9);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	const first = await manager.begin({ owner: OWNER_A, targetId: firstTarget.id, maximumSize: 6 });
	await assert.rejects(
		manager.begin({ owner: OWNER_B, targetId: secondTarget.id, maximumSize: 4 }),
		/(?:available|capacity|disk|space)/iu,
	);
	assert.deepEqual(statfsCalls, [
		['/tmp', { bigint: true }],
		['/tmp', { bigint: true }],
	]);
	assert.equal(openCalls, 1, 'each request fits alone, but the aggregate does not');
	await manager.abort(first.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('per-save maximum rejects before consuming a target or inspecting its filesystem', async () => {
	let statCalls = 0;
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const target = targets.registerPath('/tmp/practical-maximum.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 1,
		maximumSaveBytes: 5,
		maximumAdmittedBytes: 5,
		statfsImpl: async () => {
			statCalls += 1;
			return availableBytes(5);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});

	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 6 }),
		/(?:practical|per-save|save).*maximum/iu,
	);
	assert.equal(statCalls, 0);
	assert.equal(openCalls, 0);
	const boundary = await manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 5 });
	await manager.abort(boundary.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('production practical save maximum accepts the boundary and refuses the next byte', async () => {
	let statCalls = 0;
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const boundaryTarget = targets.registerPath('/tmp/production-boundary.scape', { owner: OWNER_A, purpose: 'project' });
	const excessTarget = targets.registerPath('/tmp/production-excess.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		statfsImpl: async () => {
			statCalls += 1;
			return availableBytes(MAX_DESKTOP_SAVE_BYTES);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	const boundary = await manager.begin({
		owner: OWNER_A,
		targetId: boundaryTarget.id,
		maximumSize: MAX_DESKTOP_SAVE_BYTES,
	});
	await assert.rejects(
		manager.begin({
			owner: OWNER_A,
			targetId: excessTarget.id,
			maximumSize: MAX_DESKTOP_SAVE_BYTES + 1,
		}),
		/(?:practical|per-save|save).*maximum/iu,
	);
	assert.equal(statCalls, 1);
	assert.equal(openCalls, 1);
	await manager.abort(boundary.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('filesystem capacity fails closed before staging and releases the pending reservation', async () => {
	const results = [availableBytes(4), availableBytes(5)];
	let statCalls = 0;
	let openCalls = 0;
	let renameCalls = 0;
	const targets = new SaveTargetStore();
	const refusedTarget = targets.registerPath('/tmp/disk-refused.scape', { owner: OWNER_A, purpose: 'project' });
	const replacementTarget = targets.registerPath('/tmp/disk-replacement.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 1,
		maximumSaveBytes: 5,
		maximumAdmittedBytes: 5,
		statfsImpl: async () => results[statCalls++],
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
		renameImpl: async () => { renameCalls += 1; },
		unlinkImpl: async () => undefined,
	});
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: refusedTarget.id, maximumSize: 5 }),
		/(?:available|capacity|disk|space)/iu,
	);
	assert.equal(openCalls, 0);
	assert.equal(renameCalls, 0, 'disk refusal cannot replace the destination');
	const replacement = await manager.begin({ owner: OWNER_A, targetId: replacementTarget.id, maximumSize: 5 });
	assert.equal(openCalls, 1);
	await manager.abort(replacement.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('filesystem capacity requires valid bigint bavail and bsize values', async () => {
	for (const details of [
		{ bavail: 1, bsize: 1n },
		{ bavail: 1n, bsize: 1 },
		{ bavail: -1n, bsize: 1n },
		{ bavail: 1n, bsize: 0n },
		null,
	]) {
		let openCalls = 0;
		const targets = new SaveTargetStore();
		const target = targets.registerPath('/tmp/invalid-statfs.scape', { owner: OWNER_A, purpose: 'project' });
		const manager = new AtomicSaveManager({
			targets,
			maximumSessions: 1,
			maximumSaveBytes: 1,
			maximumAdmittedBytes: 1,
			statfsImpl: async () => details,
			openImpl: async () => {
				openCalls += 1;
				return fakeHandle();
			},
		});
		await assert.rejects(
			manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 }),
			/(?:filesystem|capacity|disk|space)/iu,
		);
		assert.equal(openCalls, 0);
		await manager.dispose();
	}
});

test('filesystem capacity inspection failures refuse before staging open', async () => {
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const target = targets.registerPath('/tmp/failed-statfs.scape', {
		owner: OWNER_A,
		purpose: 'project',
	});
	const manager = new AtomicSaveManager({
		targets,
		statfsImpl: async () => { throw new Error('statfs failed'); },
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle();
		},
	});
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: target.id, maximumSize: 1 }),
		/filesystem capacity/iu,
	);
	assert.equal(openCalls, 0);
	await manager.dispose();
});

test('failed staging open releases capacity for a later session', async () => {
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const failedTarget = targets.registerPath('/tmp/open-failed.scape', { owner: OWNER_A, purpose: 'project' });
	const replacementTarget = targets.registerPath('/tmp/open-replacement.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 1,
		maximumSaveBytes: 1,
		maximumAdmittedBytes: 1,
		statfsImpl: async () => availableBytes(1),
		openImpl: async () => {
			openCalls += 1;
			if (openCalls === 1) throw new Error('open failed');
			return fakeHandle();
		},
		unlinkImpl: async () => undefined,
	});
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: failedTarget.id, maximumSize: 1 }),
		/temporary save file/iu,
	);
	const replacement = await manager.begin({
		owner: OWNER_A,
		targetId: replacementTarget.id,
		maximumSize: 1,
	});
	await manager.abort(replacement.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('save capacity remains reserved through rename and releases only after commit', async () => {
	const renameStarted = deferred();
	const continueRename = deferred();
	const targets = new SaveTargetStore();
	const firstTarget = targets.registerPath('/tmp/commit-pending.scape', { owner: OWNER_A, purpose: 'project' });
	const replacementTarget = targets.registerPath('/tmp/commit-replacement.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 1,
		maximumSaveBytes: 1,
		maximumAdmittedBytes: 1,
		statfsImpl: async () => availableBytes(1),
		openImpl: async () => fakeHandle(),
		renameImpl: async () => {
			renameStarted.resolve();
			await continueRename.promise;
		},
		unlinkImpl: async () => undefined,
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: firstTarget.id, maximumSize: 1 });
	const finishing = manager.finish(session.writeId, { owner: OWNER_A });
	await renameStarted.promise;
	try {
		await assert.rejects(
			manager.begin({ owner: OWNER_A, targetId: replacementTarget.id, maximumSize: 1 }),
			/session.*(?:capacity|count|limit)/iu,
		);
	} finally {
		continueRename.resolve();
	}
	await finishing;
	const replacement = await manager.begin({ owner: OWNER_A, targetId: replacementTarget.id, maximumSize: 1 });
	await manager.abort(replacement.writeId, { owner: OWNER_A });
	await manager.dispose();
});

test('cleanup errors retain capacity and prevent repeated staging exhaustion', async () => {
	let statCalls = 0;
	let openCalls = 0;
	const targets = new SaveTargetStore();
	const leakingTarget = targets.registerPath('/tmp/leaking.scape', { owner: OWNER_A, purpose: 'project' });
	const byteRefusedTarget = targets.registerPath('/tmp/after-byte-leak.scape', { owner: OWNER_A, purpose: 'project' });
	const zeroLeakTarget = targets.registerPath('/tmp/zero-leak.scape', { owner: OWNER_A, purpose: 'project' });
	const countRefusedTarget = targets.registerPath('/tmp/after-count-leak.scape', { owner: OWNER_A, purpose: 'project' });
	const manager = new AtomicSaveManager({
		targets,
		maximumSessions: 2,
		maximumSaveBytes: 1,
		maximumAdmittedBytes: 1,
		statfsImpl: async () => {
			statCalls += 1;
			return availableBytes(1);
		},
		openImpl: async () => {
			openCalls += 1;
			return fakeHandle({ closeImpl: async () => { throw new Error('close failed'); } });
		},
		unlinkImpl: async () => { throw new Error('unlink failed'); },
	});
	const session = await manager.begin({ owner: OWNER_A, targetId: leakingTarget.id, maximumSize: 1 });
	assert.equal(await manager.abort(session.writeId, { owner: OWNER_A }), true);
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: byteRefusedTarget.id, maximumSize: 1 }),
		/admitted.*(?:byte|capacity|limit)|aggregate.*(?:byte|capacity|limit)/iu,
	);
	const zeroLeak = await manager.begin({ owner: OWNER_A, targetId: zeroLeakTarget.id, maximumSize: 0 });
	assert.equal(await manager.abort(zeroLeak.writeId, { owner: OWNER_A }), true);
	await assert.rejects(
		manager.begin({ owner: OWNER_A, targetId: countRefusedTarget.id, maximumSize: 0 }),
		/session.*(?:capacity|count|limit)/iu,
	);
	assert.equal(statCalls, 2);
	assert.equal(openCalls, 2);
	await assert.rejects(manager.dispose(), /cleanup failed|staging cleanup/iu);
});

function availableBytes(bytes) {
	return { bavail: BigInt(bytes), bsize: 1n };
}

function fakeHandle({ closeImpl, syncImpl, writeImpl } = {}) {
	return {
		async close() {
			await closeImpl?.();
		},
		async sync() {
			await syncImpl?.();
		},
		async write(_buffer, _offset, length) {
			if (writeImpl) return writeImpl(length);
			return { bytesWritten: length };
		},
	};
}

function deferred() {
	const state = Promise.withResolvers();
	return Object.freeze(state);
}
