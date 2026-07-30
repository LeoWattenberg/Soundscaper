/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	preflightScapeImportCapacity,
	scapeImportCapacityRequirement,
	ScapeImportQuotaError,
} from '../src/common/editor/scape-import-capacity.ts';

const EXACT_EIGHT_GIB_ASSET_BYTES = 8_589_932_094;

test('Scape import capacity sums manifest assets and adds exact ten-percent headroom', () => {
	const exact = scapeImportCapacityRequirement(manifest(EXACT_EIGHT_GIB_ASSET_BYTES));
	assert.deepEqual(exact, {
		assetBytes: EXACT_EIGHT_GIB_ASSET_BYTES,
		headroomBytes: 858_993_210,
		requiredFreeBytes: 9_448_925_304,
	});
	assert.equal(Object.isFrozen(exact), true);

	assert.deepEqual(scapeImportCapacityRequirement(manifest(0, 1, 9, 10)), {
		assetBytes: 20,
		headroomBytes: 2,
		requiredFreeBytes: 22,
	});
	assert.deepEqual(scapeImportCapacityRequirement(manifest(1, 1, 1)), {
		assetBytes: 3,
		headroomBytes: 1,
		requiredFreeBytes: 4,
	});
});

test('Scape import capacity rejects invalid or unsafe manifest asset arithmetic', () => {
	for (const size of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
		assert.throws(
			() => scapeImportCapacityRequirement(manifest(size)),
			/manifest asset.*safe non-negative integer/iu,
		);
	}
	assert.throws(
		() => scapeImportCapacityRequirement(manifest(Number.MAX_SAFE_INTEGER, 1)),
		/asset-byte total.*safe integer/iu,
	);
	assert.throws(
		() => scapeImportCapacityRequirement(manifest(Number.MAX_SAFE_INTEGER)),
		/required free bytes.*safe integer/iu,
	);
});

test('optional or unknown storage estimates do not block Scape import admission', async () => {
	const expected = {
		assetBytes: 100,
		headroomBytes: 10,
		requiredFreeBytes: 110,
	};
	assert.deepEqual(await preflightScapeImportCapacity(manifest(100)), expected);
	assert.deepEqual(await preflightScapeImportCapacity(manifest(100), {
		estimateStorage: null,
	}), expected);

	const unknownEstimates: unknown[] = [
		undefined,
		null,
		{},
		{ usage: null, quota: 1_000 },
		{ usage: 0, quota: null },
		{ usage: -1, quota: 1_000 },
		{ usage: 0, quota: -1 },
		{ usage: Number.NaN, quota: 1_000 },
		{ usage: 0, quota: Number.NaN },
		{ usage: Number.POSITIVE_INFINITY, quota: 1_000 },
		{ usage: 0, quota: Number.NEGATIVE_INFINITY },
	];
	for (const estimate of unknownEstimates) {
		assert.deepEqual(await preflightScapeImportCapacity(manifest(100), {
			estimateStorage: () => estimate,
		}), expected);
	}

	assert.deepEqual(await preflightScapeImportCapacity(manifest(100), {
		estimateStorage: () => ({ usage: 890, quota: 1_000 }),
	}), expected, 'exactly enough known free bytes are admitted');
});

test('insufficient known capacity throws a stable quota error with frozen exact details', async () => {
	await assert.rejects(
		preflightScapeImportCapacity(manifest(1_000), {
			estimateStorage: () => ({ usage: 500, quota: 1_000 }),
		}),
		(error: unknown) => {
			assert.ok(error instanceof ScapeImportQuotaError);
			assert.equal(error.name, 'ScapeImportQuotaError');
			assert.equal(error.code, 'QUOTA_EXCEEDED');
			assert.equal(error.message, 'There is not enough storage available to import this .scape project.');
			assert.deepEqual(error.details, {
				assetBytes: 1_000,
				headroomBytes: 100,
				requiredFreeBytes: 1_100,
				usage: 500,
				quota: 1_000,
				availableBytes: 500,
			});
			assert.equal(Object.isFrozen(error.details), true);
			assert.equal(Reflect.set(error.details, 'availableBytes', 999), false);
			return true;
		},
	);

	await assert.rejects(
		preflightScapeImportCapacity(manifest(1), {
			estimateStorage: () => ({ usage: 2, quota: 1 }),
		}),
		(error: unknown) => {
			assert.ok(error instanceof ScapeImportQuotaError);
			assert.equal(error.details.availableBytes, 0);
			return true;
		},
	);
});

test('storage estimator rejection propagates without quota-error rewriting', async () => {
	const failure = new Error('estimate failed');
	await assert.rejects(
		preflightScapeImportCapacity(manifest(1), {
			estimateStorage: async () => { throw failure; },
		}),
		(error: unknown) => error === failure,
	);
	await assert.rejects(
		preflightScapeImportCapacity(manifest(1), {
			estimateStorage: () => { throw failure; },
		}),
		(error: unknown) => error === failure,
	);
});

test('cancellation promptly wins a race with a signal-ignoring estimator', async () => {
	const controller = new AbortController();
	const estimate = deferred<unknown>();
	let estimatorCalls = 0;
	const admission = preflightScapeImportCapacity(manifest(1), {
		signal: controller.signal,
		estimateStorage: () => {
			estimatorCalls += 1;
			return estimate.promise;
		},
	});
	assert.equal(estimatorCalls, 1);
	const reason = new Error('cancel capacity preflight');
	controller.abort(reason);
	await assert.rejects(admission, (error: unknown) => error === reason);
	estimate.resolve({ usage: 0, quota: 1_000 });

	const alreadyAborted = new AbortController();
	const earlyReason = new Error('already cancelled');
	alreadyAborted.abort(earlyReason);
	let earlyEstimatorCalls = 0;
	await assert.rejects(preflightScapeImportCapacity(manifest(1), {
		signal: alreadyAborted.signal,
		estimateStorage: () => {
			earlyEstimatorCalls += 1;
			return { usage: 0, quota: 1_000 };
		},
	}), (error: unknown) => error === earlyReason);
	assert.equal(earlyEstimatorCalls, 0);
});

function manifest(...sizes: number[]): Readonly<{
	assets: readonly Readonly<{ size: number }>[];
}> {
	return Object.freeze({
		assets: Object.freeze(sizes.map((size) => Object.freeze({ size }))),
	});
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}
