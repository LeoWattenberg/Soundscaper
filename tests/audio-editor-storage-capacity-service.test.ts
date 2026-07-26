import assert from 'node:assert/strict';
import test from 'node:test';

import { createStorageCapacityService } from '../src/common/editor/controller/storage-capacity-service.ts';

test('storage capacity refresh ignores a late completion after controller shutdown', async () => {
	const estimate = deferred<Readonly<{ usage: number; quota: number }>>();
	let inactive = false;
	const updates: unknown[] = [];
	const service = createStorageCapacityService({
		estimateStorage: () => estimate.promise,
		isInactive: () => inactive,
		setEstimate: (value) => { updates.push(value); },
		publish: () => { updates.push('publish'); },
		copy: copyFixture(),
	});

	const refresh = service.refreshStorageUsage();
	inactive = true;
	estimate.resolve({ usage: 12, quota: 100 });

	assert.equal(await refresh, null);
	assert.deepEqual(updates, []);
});

test('storage preflight enforces headroom with operation-specific messages', async () => {
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: 900, quota: 1_000 }),
		isInactive: () => false,
		setEstimate: () => undefined,
		publish: () => undefined,
		copy: copyFixture(),
	});

	await assert.rejects(
		service.preflightStorage(100, 'recording'),
		/Recording needs 100 B/,
	);
	await assert.doesNotReject(service.preflightStorage(90, 'export'));
});

test('unknown browser quotas do not block an operation', async () => {
	const service = createStorageCapacityService({
		estimateStorage: async () => ({ usage: null, quota: null }),
		isInactive: () => false,
		setEstimate: () => undefined,
		publish: () => undefined,
		copy: copyFixture(),
	});
	await assert.doesNotReject(service.preflightStorage(Number.POSITIVE_INFINITY, 'import'));
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
