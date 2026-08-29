/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	FRAMESCAPER_SEQUENCE_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectSequence } from '../src/framescaper/editor-project-sequence.ts';
import {
	FramescaperVideoProxyAttachmentCapacityErrorSequence,
	acquireFramescaperVideoProxyAttachmentBudgetSequence,
	assertFramescaperVideoProxyAttachmentCapacitySequence,
} from '../src/framescaper/editor-video-proxy-attachment-capacity-sequence.ts';

const AMPLE_QUOTA = 1_000_000_000;

const MATERIAL = Object.freeze({
	info: { candidateByteLength: 1_024 },
	timingPublication: { bytes: new Uint8Array(112) },
});

function tick(): Promise<void> {
	return new Promise((resolve) => { setTimeout(resolve, 0); });
}

function store(
	persistent: boolean | null,
	usage: number | null,
	quota: number | null,
): never {
	return {
		queryPersistentStorage: async () => persistent,
		estimateStorage: async () => ({ usage, quota }),
	} as unknown as never;
}

async function assertCapacity(
	capacityStore: never,
	signal?: AbortSignal,
): Promise<void> {
	await assertFramescaperVideoProxyAttachmentCapacitySequence(
		capacityStore,
		createFramescaperProjectSequence(PROFILE, {}) as never,
		createFramescaperProjectSequence(PROFILE, { title: 'Next revision' } as never) as never,
		MATERIAL as never,
		signal,
	);
}

function isCapacityRefusal(error: unknown): boolean {
	assert.ok(error instanceof FramescaperVideoProxyAttachmentCapacityErrorSequence);
	assert.equal(error.code, 'FRAMESCAPER_SEQUENCE_PROXY_CAPACITY_UNAVAILABLE');
	return true;
}

test('a persistent store with ample known quota admits the attachment', async () => {
	await assert.doesNotReject(() => assertCapacity(store(true, 0, AMPLE_QUOTA)));
});

test('storage that is not durably persistent is refused', async () => {
	await assert.rejects(() => assertCapacity(store(false, 0, AMPLE_QUOTA)), isCapacityRefusal);
	await assert.rejects(() => assertCapacity(store(null, 0, AMPLE_QUOTA)), isCapacityRefusal);
});

test('an unknown or nonsensical usage or quota is refused rather than assumed', async () => {
	await assert.rejects(() => assertCapacity(store(true, null, AMPLE_QUOTA)), isCapacityRefusal);
	await assert.rejects(() => assertCapacity(store(true, 0, null)), isCapacityRefusal);
	await assert.rejects(() => assertCapacity(store(true, -1, AMPLE_QUOTA)), isCapacityRefusal);
});

test('existing usage counts against the quota the attachment needs', async () => {
	await assert.rejects(
		() => assertCapacity(store(true, AMPLE_QUOTA - 1, AMPLE_QUOTA)),
		(error: Error) => {
			isCapacityRefusal(error);
			assert.match(error.message, /quota is insufficient for atomic proxy attachment/u);
			return true;
		},
	);
});

test('usage already beyond the quota clamps to no free space rather than going negative', async () => {
	await assert.rejects(
		() => assertCapacity(store(true, AMPLE_QUOTA * 2, AMPLE_QUOTA)),
		(error: Error) => {
			isCapacityRefusal(error);
			assert.match(error.message, /quota is insufficient for atomic proxy attachment/u);
			return true;
		},
	);
});

test('a quota too small for the staged publication is refused', async () => {
	await assert.rejects(() => assertCapacity(store(true, 0, 1_024)), isCapacityRefusal);
});

test('a cancelled capacity check rethrows its own abort reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled the attachment');
	controller.abort(reason);

	await assert.rejects(
		() => assertCapacity(store(true, 0, AMPLE_QUOTA), controller.signal),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('the first budget holder is admitted immediately and the next one waits', async () => {
	const budgetStore = {};
	const sequence: string[] = [];

	const release = await acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore);
	let admitted = false;
	const queued = acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore)
		.then((next) => { admitted = true; sequence.push('second'); return next; });

	await tick();
	assert.equal(admitted, false, 'a second attachment must not run beside the first');

	sequence.push('release-first');
	release();
	(await queued)();

	assert.deepEqual(sequence, ['release-first', 'second']);
});

test('releasing a budget twice does not hand the slot out twice', async () => {
	const budgetStore = {};
	const release = await acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore);

	release();
	release();

	let admitted = 0;
	const first = acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore)
		.then((next) => { admitted += 1; return next; });
	const second = acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore)
		.then((next) => { admitted += 1; return next; });

	const firstRelease = await first;
	await tick();
	assert.equal(admitted, 1, 'a duplicated release must not admit two holders at once');

	firstRelease();
	(await second)();
});

test('a cancelled waiter rejects without blocking the holders behind it', async () => {
	const budgetStore = {};
	const held = await acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore);
	const controller = new AbortController();

	const cancelled = acquireFramescaperVideoProxyAttachmentBudgetSequence(
		budgetStore,
		controller.signal,
	);
	const rejection = assert.rejects(
		() => cancelled,
		(error: Error) => error.name === 'AbortError',
	);

	let followerAdmitted = false;
	const follower = acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore)
		.then((next) => { followerAdmitted = true; return next; });

	await tick();
	controller.abort();
	await rejection;

	held();
	(await follower)();
	assert.equal(followerAdmitted, true, 'an abandoned waiter must not strand the queue');
});

test('an already-cancelled acquisition rejects with its own reason', async () => {
	const controller = new AbortController();
	const reason = new Error('the caller cancelled before queueing');
	controller.abort(reason);

	await assert.rejects(
		() => acquireFramescaperVideoProxyAttachmentBudgetSequence({}, controller.signal),
		(error: unknown) => {
			assert.equal(error, reason);
			return true;
		},
	);
});

test('budgets are held per store rather than globally', async () => {
	const first = {};
	const second = {};

	const releaseFirst = await acquireFramescaperVideoProxyAttachmentBudgetSequence(first);
	const releaseSecond = await acquireFramescaperVideoProxyAttachmentBudgetSequence(second);

	assert.equal(typeof releaseFirst, 'function');
	assert.equal(typeof releaseSecond, 'function');
	releaseFirst();
	releaseSecond();
});

test('a fully drained store admits a later attachment immediately', async () => {
	const budgetStore = {};

	(await acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore))();
	const release = await acquireFramescaperVideoProxyAttachmentBudgetSequence(budgetStore);

	assert.equal(typeof release, 'function');
	release();
});
