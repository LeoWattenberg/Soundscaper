import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createInitialStorageCapacitySnapshot,
	createStorageCapacityService,
} from '../src/common/editor/controller/storage-capacity-service.ts';

test('storage capacity refresh ignores a late completion after controller shutdown', async () => {
	const estimate = deferred<Readonly<{ usage: number; quota: number }>>();
	let inactive = false;
	const updates: unknown[] = [];
	const service = createStorageCapacityService({
		estimateStorage: () => estimate.promise,
		isInactive: () => inactive,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => { updates.push('publish'); },
		copy: copyFixture(),
	});

	const refresh = service.refreshStorageUsage();
	inactive = true;
	estimate.resolve({ usage: 12, quota: 100 });

	assert.equal(await refresh, null);
	assert.deepEqual(updates, []);
});

test('storage preflight publishes its requirement before estimating and records its outcome', async () => {
	const estimate = deferred<Readonly<{ usage: number; quota: number }>>();
	const updates: unknown[] = [];
	const service = createStorageCapacityService({
		estimateStorage: () => estimate.promise,
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => { updates.push('publish'); },
		copy: copyFixture(),
	});

	const preflight = service.preflightStorage(100, 'recording');
	assert.deepEqual(updates, [
		{
			...createInitialStorageCapacitySnapshot(),
			lastPreflight: {
				operation: 'recording',
				requiredBytes: 100,
				requiredFreeBytes: 110,
				status: 'checking',
			},
		},
		'publish',
	]);
	estimate.resolve({ usage: 900, quota: 1_000 });
	await assert.rejects(
		preflight,
		/Recording needs 100 B/,
	);
	const final = updates.at(-2) as ReturnType<typeof createInitialStorageCapacitySnapshot>;
	assert.equal(final.free, 100);
	assert.equal(final.pressure, 'critical');
	assert.equal(final.lastPreflight?.status, 'insufficient');
	await assert.rejects(
		service.preflightStorage(100, 'project'),
		/Project saving needs 100 B/u,
	);
});

test('storage preflight records ready and unknown quota outcomes', async () => {
	let estimate = { usage: 900 as number | null, quota: 1_000 as number | null };
	const updates: ReturnType<typeof createInitialStorageCapacitySnapshot>[] = [];
	const service = createStorageCapacityService({
		estimateStorage: async () => estimate,
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});

	await assert.doesNotReject(service.preflightStorage(90, 'export'));
	assert.equal(updates.at(-1)?.lastPreflight?.status, 'ready');
	estimate = { usage: null, quota: null };
	await assert.doesNotReject(service.preflightStorage(50, 'import'));
	assert.equal(updates.at(-1)?.lastPreflight?.status, 'unknown');
	await assert.rejects(
		service.preflightStorage(Number.POSITIVE_INFINITY, 'import'),
		/non-negative safe integer/u,
	);
});

test('preflight estimation publishes the raw requirement and returns one normalized ready estimate', async () => {
	const estimate = deferred<unknown>();
	const updates: unknown[] = [];
	let estimateCalls = 0;
	const service = createStorageCapacityService({
		estimateStorage: () => {
			estimateCalls += 1;
			return estimate.promise;
		},
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => { updates.push('publish'); },
		now: sequenceClock(),
		copy: copyFixture(),
	});

	const preflight = service.estimateStorageForPreflight(100, 'import');
	assert.equal(estimateCalls, 1);
	assert.deepEqual(updates, [
		{
			...createInitialStorageCapacitySnapshot(),
			lastPreflight: {
				operation: 'import',
				requiredBytes: 100,
				requiredFreeBytes: 110,
				status: 'checking',
			},
		},
		'publish',
	]);
	estimate.resolve({ usage: 100, quota: 1_000 });

	assert.deepEqual(await preflight, { usage: 100, quota: 1_000 });
	assert.equal(estimateCalls, 1, 'one visible preflight owns one storage estimate');
	const final = updates.at(-2) as ReturnType<typeof createInitialStorageCapacitySnapshot>;
	assert.equal(final.usage, 100);
	assert.equal(final.quota, 1_000);
	assert.equal(final.free, 900);
	assert.equal(final.lastPreflight?.status, 'ready');
});

test('preflight estimation returns known insufficiency without throwing and normalizes unknown estimates', async (context) => {
	await context.test('known insufficient', async () => {
		let snapshot = createInitialStorageCapacitySnapshot();
		let estimateCalls = 0;
		const service = createStorageCapacityService({
			estimateStorage: async () => {
				estimateCalls += 1;
				return { usage: 900, quota: 1_000 };
			},
			isInactive: () => false,
			setSnapshot: (value) => { snapshot = value; },
			publish: () => undefined,
			copy: copyFixture(),
		});

		assert.deepEqual(
			await service.estimateStorageForPreflight(100, 'import'),
			{ usage: 900, quota: 1_000 },
		);
		assert.equal(estimateCalls, 1);
		assert.equal(snapshot.free, 100);
		assert.deepEqual(snapshot.lastPreflight, {
			operation: 'import', requiredBytes: 100, requiredFreeBytes: 110, status: 'insufficient',
		});
	});

	for (const scenario of [
		{ name: 'null', estimate: null, normalized: { usage: null, quota: null } },
		{ name: 'partial', estimate: { usage: 25 }, normalized: { usage: 25, quota: null } },
	] as const) {
		await context.test(scenario.name, async () => {
			let snapshot = createInitialStorageCapacitySnapshot();
			let estimateCalls = 0;
			const service = createStorageCapacityService({
				estimateStorage: async () => {
					estimateCalls += 1;
					return scenario.estimate;
				},
				isInactive: () => false,
				setSnapshot: (value) => { snapshot = value; },
				publish: () => undefined,
				copy: copyFixture(),
			});

			assert.deepEqual(
				await service.estimateStorageForPreflight(100, 'import'),
				scenario.normalized,
			);
			assert.equal(estimateCalls, 1);
			assert.equal(snapshot.free, null);
			assert.equal(snapshot.lastPreflight?.status, 'unknown');
		});
	}
});

test('an already-aborted preflight estimate has no estimator or snapshot side effects', async () => {
	const controller = new AbortController();
	const reason = new Error('capacity estimate was already cancelled');
	controller.abort(reason);
	let estimateCalls = 0;
	const updates: unknown[] = [];
	const service = createStorageCapacityService({
		estimateStorage: async () => {
			estimateCalls += 1;
			return { usage: 0, quota: 1_000 };
		},
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => { updates.push('publish'); },
		copy: copyFixture(),
	});

	await assert.rejects(
		service.estimateStorageForPreflight(100, 'import', controller.signal),
		(error: unknown) => error === reason,
	);
	assert.equal(estimateCalls, 0);
	assert.deepEqual(updates, []);
});

test('cancelling a pending estimate restores settled state and consumes a late provider settlement', async (context) => {
	for (const lateSettlement of ['resolve', 'reject'] as const) {
		await context.test(lateSettlement, async () => {
			const pending = deferred<unknown>();
			let estimateCalls = 0;
			let snapshot = createInitialStorageCapacitySnapshot();
			let publishes = 0;
			const service = createStorageCapacityService({
				estimateStorage: () => {
					estimateCalls += 1;
					if (estimateCalls === 1) return { usage: 100, quota: 1_000 };
					return pending.promise;
				},
				isInactive: () => false,
				setSnapshot: (value) => { snapshot = value; },
				publish: () => { publishes += 1; },
				copy: copyFixture(),
			});
			await service.estimateStorageForPreflight(10, 'export');
			const settled = snapshot.lastPreflight;
			assert.equal(settled?.status, 'ready');

			const controller = new AbortController();
			const estimating = service.estimateStorageForPreflight(100, 'import', controller.signal);
			assert.equal(estimateCalls, 2);
			assert.equal(snapshot.lastPreflight?.status, 'checking');
			const reason = new Error(`cancel pending estimate before late ${lateSettlement}`);
			controller.abort(reason);
			await assertRejectsPromptly(estimating, (error) => error === reason);
			assert.deepEqual(snapshot.lastPreflight, settled);
			assert.notEqual(snapshot.lastPreflight?.status, 'checking');
			const snapshotAfterAbort = snapshot;
			const publishesAfterAbort = publishes;

			if (lateSettlement === 'resolve') pending.resolve({ usage: 900, quota: 1_000 });
			else pending.reject(new Error('late estimator rejection'));
			await flushMicrotasks();
			assert.equal(snapshot, snapshotAfterAbort);
			assert.equal(publishes, publishesAfterAbort);
		});
	}
});

test('abort wins after provider resolution but before the preflight continuation', async () => {
	const reason = new Error('abort after provider resolution');
	const fixture = await settlementRaceFixture();
	const updateCount = fixture.updates.length;
	fixture.provider.resolve({ usage: 0, quota: 1_000 });
	queueMicrotask(() => { fixture.controller.abort(reason); });

	await assert.rejects(fixture.preflight, (error: unknown) => error === reason);
	assert.deepEqual(
		fixture.updates.slice(updateCount).map(({ lastPreflight }) => lastPreflight),
		[fixture.settled.lastPreflight],
	);
	const restored = fixture.snapshot();
	await flushMicrotasks();
	assert.equal(fixture.snapshot(), restored);
});

test('abort wins after provider rejection but before the preflight catch continuation', async () => {
	const reason = new Error('abort after provider rejection');
	const fixture = await settlementRaceFixture();
	const updateCount = fixture.updates.length;
	fixture.provider.reject(new Error('provider rejection must lose to cancellation'));
	queueMicrotask(() => { fixture.controller.abort(reason); });

	await assert.rejects(fixture.preflight, (error: unknown) => error === reason);
	assert.deepEqual(
		fixture.updates.slice(updateCount).map(({ lastPreflight }) => lastPreflight),
		[fixture.settled.lastPreflight],
	);
	const restored = fixture.snapshot();
	await flushMicrotasks();
	assert.equal(fixture.snapshot(), restored);
});

test('a cancelled older estimate cannot restore over a newer settled preflight', async () => {
	const olderEstimate = deferred<unknown>();
	const newerEstimate = deferred<unknown>();
	let estimateCalls = 0;
	let snapshot = createInitialStorageCapacitySnapshot();
	const service = createStorageCapacityService({
		estimateStorage: () => (estimateCalls++ === 0 ? olderEstimate.promise : newerEstimate.promise),
		isInactive: () => false,
		setSnapshot: (value) => { snapshot = value; },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});
	const olderController = new AbortController();
	const older = service.estimateStorageForPreflight(100, 'import', olderController.signal);
	const newer = service.estimateStorageForPreflight(20, 'export');
	newerEstimate.resolve({ usage: 100, quota: 1_000 });
	assert.deepEqual(await newer, { usage: 100, quota: 1_000 });
	const newerSnapshot = snapshot;
	assert.deepEqual(snapshot.lastPreflight, {
		operation: 'export', requiredBytes: 20, requiredFreeBytes: 22, status: 'ready',
	});

	const reason = new Error('cancel superseded import estimate');
	olderController.abort(reason);
	await assertRejectsPromptly(older, (error) => error === reason);
	olderEstimate.resolve({ usage: 950, quota: 1_000 });
	await flushMicrotasks();
	assert.equal(snapshot, newerSnapshot);
});

test('an older preflight completion cannot replace the latest visible requirement', async () => {
	const firstEstimate = deferred<Readonly<{ usage: number; quota: number }>>();
	const secondEstimate = deferred<Readonly<{ usage: number; quota: number }>>();
	let estimateCall = 0;
	let snapshot = createInitialStorageCapacitySnapshot();
	const service = createStorageCapacityService({
		estimateStorage: () => (estimateCall++ === 0 ? firstEstimate.promise : secondEstimate.promise),
		isInactive: () => false,
		setSnapshot: (value) => { snapshot = value; },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});

	const first = service.preflightStorage(10, 'import');
	const second = service.preflightStorage(20, 'export');
	secondEstimate.resolve({ usage: 100, quota: 1_000 });
	await second;
	firstEstimate.resolve({ usage: 900, quota: 1_000 });
	await first;
	assert.deepEqual(snapshot.lastPreflight, {
		operation: 'export', requiredBytes: 20, requiredFreeBytes: 22, status: 'ready',
	});
	assert.equal(snapshot.usage, 100);
	assert.equal(snapshot.quota, 1_000);
	assert.equal(snapshot.free, 900);
	assert.equal(snapshot.pressure, 'normal');
	assert.equal(snapshot.updatedAt, 1);
});

test('storage refresh exposes usage, quota, free space, pressure, and eviction protection', async () => {
	const updates: ReturnType<typeof createInitialStorageCapacitySnapshot>[] = [];
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: 800, quota: 1_000 }),
		queryPersistentStorage: async () => false,
		requestPersistentStorage: async () => false,
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});

	assert.deepEqual(await service.refreshStorageUsage(), {
		...createInitialStorageCapacitySnapshot(),
		usage: 800,
		quota: 1_000,
		free: 200,
		pressure: 'warning',
		evictionProtection: 'best-effort',
		persistenceRequestAvailable: true,
		updatedAt: 1,
	});
	assert.equal(updates.length, 1);
});

test('a supported persistence request with an unavailable query stays unknown', async () => {
	let snapshot = createInitialStorageCapacitySnapshot();
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: null, quota: null }),
		queryPersistentStorage: async () => null,
		requestPersistentStorage: async () => false,
		persistenceRequestAvailable: () => true,
		isInactive: () => false,
		setSnapshot: (value) => { snapshot = value; },
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	assert.equal(snapshot.evictionProtection, 'unknown');
	assert.equal(snapshot.persistenceRequestAvailable, true);
});

test('disposable cleanup is explicitly unavailable for an ephemeral memory backend', async () => {
	let cleanupCalls = 0;
	let snapshot = createInitialStorageCapacitySnapshot();
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: null, quota: null }),
		cleanupDisposableStorage: async () => { cleanupCalls += 1; },
		disposableCleanupAvailable: () => false,
		isInactive: () => false,
		setSnapshot: (value) => { snapshot = value; },
		publish: () => undefined,
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	await service.cleanupDisposableStorage();
	assert.equal(cleanupCalls, 0);
	assert.equal(snapshot.cleanupAvailable, false);
});

test('explicit persistence and disposable cleanup actions update visible state', async () => {
	let cleanupCalls = 0;
	let persisted = false;
	const updates: ReturnType<typeof createInitialStorageCapacitySnapshot>[] = [];
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: cleanupCalls ? 100 : 150, quota: 1_000 }),
		queryPersistentStorage: async () => persisted,
		requestPersistentStorage: async () => { persisted = true; return true; },
		cleanupDisposableStorage: async () => { cleanupCalls += 1; },
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});

	const persistence = await service.requestStoragePersistence();
	assert.equal(persistence?.evictionProtection, 'granted');
	assert.equal(persistence?.persistenceRequestAvailable, true);
	const cleaned = await service.cleanupDisposableStorage();
	assert.equal(cleanupCalls, 1);
	assert.equal(cleaned?.cleanupStatus, 'complete');
	assert.equal(cleaned?.usage, 100);
	assert.equal(cleaned?.lastCleanupAt, 2);
	assert.ok(updates.some((snapshot) => snapshot.cleanupStatus === 'running'));
});

test('reproducible derivative cleanup has separate state and remains available for memory pressure', async () => {
	let derivativeCleanupCalls = 0;
	const updates: ReturnType<typeof createInitialStorageCapacitySnapshot>[] = [];
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: null, quota: null }),
		cleanupDerivativeCache: async () => {
			derivativeCleanupCalls += 1;
			return {
				before: { bytes: 15, entries: 2 }, after: { bytes: 0, entries: 0 },
				removedBytes: 15, removedEntries: 2, skippedEntries: 0, satisfied: true,
			};
		},
		isInactive: () => false,
		setSnapshot: (value) => { updates.push(value); },
		publish: () => undefined,
		now: sequenceClock(),
		copy: copyFixture(),
	});

	await service.refreshStorageUsage();
	const result = await service.cleanupDerivativeCache();

	assert.equal(derivativeCleanupCalls, 1);
	assert.equal(result?.derivativeCleanupStatus, 'complete');
	assert.equal(result?.derivativeCleanupAvailable, true);
	assert.equal(result?.lastDerivativeCleanupAt, 2);
	assert.deepEqual(result?.lastDerivativeCleanup, {
		before: { bytes: 15, entries: 2 }, after: { bytes: 0, entries: 0 },
		removedBytes: 15, removedEntries: 2, skippedEntries: 0, satisfied: true,
	});
	assert.ok(updates.some((snapshot) => snapshot.derivativeCleanupStatus === 'running'));
	assert.equal(updates.some((snapshot) => snapshot.cleanupStatus === 'running'), false);
});

async function settlementRaceFixture() {
	const provider = deferred<unknown>();
	const updates: ReturnType<typeof createInitialStorageCapacitySnapshot>[] = [];
	let estimateCalls = 0;
	let snapshot = createInitialStorageCapacitySnapshot();
	const service = createStorageCapacityService({
		estimateStorage: () => {
			estimateCalls += 1;
			return estimateCalls === 1 ? { usage: 100, quota: 1_000 } : provider.promise;
		},
		isInactive: () => false,
		setSnapshot: (value) => {
			snapshot = value;
			updates.push(value);
		},
		publish: () => undefined,
		copy: copyFixture(),
	});
	await service.estimateStorageForPreflight(10, 'export');
	const settled = snapshot;
	const controller = new AbortController();
	const preflight = service.estimateStorageForPreflight(100, 'import', controller.signal);
	assert.equal(estimateCalls, 2);
	assert.equal(snapshot.lastPreflight?.status, 'checking');
	return {
		controller,
		preflight,
		provider,
		settled,
		snapshot: () => snapshot,
		updates,
	};
}

function copyFixture() {
	return {
		storageOperationRecording: 'Recording',
		storageOperationExport: 'Export',
		storageOperationEffect: 'Effect',
		storageOperationProject: 'Project saving',
		storageOperationImport: 'Import',
		insufficientStorage: '{operation} needs {required}.',
		formatBytes: (bytes: number) => `${bytes} B`,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<Value>((fulfill, fail) => {
		resolve = fulfill;
		reject = fail;
	});
	return { promise, reject, resolve };
}

function sequenceClock() {
	let value = 0;
	return () => { value += 1; return value; };
}

async function assertRejectsPromptly(
	promise: Promise<unknown>,
	validate: (error: unknown) => boolean,
): Promise<void> {
	let timeout: ReturnType<typeof setTimeout> | null = null;
	const deadline = new Promise<never>((_resolve, reject) => {
		timeout = setTimeout(() => reject(new Error('Expected prompt storage-preflight cancellation.')), 1_000);
	});
	try {
		await Promise.race([assert.rejects(promise, validate), deadline]);
	} finally {
		if (timeout !== null) clearTimeout(timeout);
	}
}

async function flushMicrotasks(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}
