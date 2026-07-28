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

function copyFixture() {
	return {
		storageOperationRecording: 'Recording',
		storageOperationExport: 'Export',
		storageOperationEffect: 'Effect',
		storageOperationImport: 'Import',
		insufficientStorage: '{operation} needs {required}.',
		formatBytes: (bytes: number) => `${bytes} B`,
	};
}

function deferred<Value>() {
	let resolve!: (value: Value) => void;
	const promise = new Promise<Value>((fulfill) => { resolve = fulfill; });
	return { promise, resolve };
}

function sequenceClock() {
	let value = 0;
	return () => { value += 1; return value; };
}
