/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createNativePluginScanController,
	type NativePluginScanAvailability,
	type NativePluginScanResult,
} from '../src/common/editor/controller/effects/native-plugin-scan-controller.ts';

function deferred<Value>() {
	let resolve: (value: Value) => void = () => undefined;
	const promise = new Promise<Value>((complete) => { resolve = complete; });
	return { promise, resolve };
}

function fixture() {
	const calls: string[] = [];
	const jobs = [deferred<NativePluginScanResult>(), deferred<NativePluginScanResult>()];
	let availability: NativePluginScanAvailability = {
		enabled: true, quarantined: false, payload: { status: 'available' },
		consent: { formats: [{ format: 'vst3', supported: true, granted: true, roots: [
			{ rootId: 'system', name: 'System VST3 folder', admitted: true },
			{ rootId: 'custom', name: 'Custom folder', admitted: true },
			{ rootId: 'excluded', name: 'Excluded folder', admitted: false },
		] }] },
	};
	let tick: (() => void) | null = null;
	const controller = createNativePluginScanController({
		nativePluginAvailability: () => Promise.resolve(availability),
		nativePluginScanProgress: () => Promise.resolve(availability),
		scanNativePlugins: ({ rootId }) => {
			calls.push(rootId);
			return jobs[calls.length - 1]!.promise;
		},
	}, {
		setInterval: (callback) => { tick = callback; return 1; },
		clearInterval: () => { tick = null; },
	});
	return { controller, calls, jobs,
		setAvailability: (next: NativePluginScanAvailability) => { availability = next; },
		availability: () => availability,
		tick: async () => { tick?.(); await flush(); },
		hasTimer: () => tick !== null,
	};
}

const result: NativePluginScanResult = { status: 'described', scan: { entries: [{}] } };
async function flush() { for (let index = 0; index < 12; index += 1) await Promise.resolve(); }

test('opening starts one background scan and reports folder and helper progress', async () => {
	const f = fixture();
	const operation = f.controller.startOnOpen();
	assert.equal(f.controller.startOnOpen(), operation, 'Strict Mode and repeated mounts share the startup scan');
	await flush();
	assert.deepEqual(f.calls, ['system']);
	assert.equal(f.controller.getSnapshot().currentFolder, 'System VST3 folder');
	assert.equal(f.controller.getSnapshot().total, 2);
	f.setAvailability({ ...f.availability(), scanProgress: { format: 'vst3', progress: 0.5 } });
	await f.tick();
	assert.equal(f.controller.getSnapshot().progress, 0.25);
	f.jobs[0]!.resolve(result);
	await flush();
	assert.deepEqual(f.calls, ['system', 'custom']);
	assert.equal(f.controller.getSnapshot().completed, 1);
	f.jobs[1]!.resolve(result);
	await operation;
	assert.equal(f.controller.getSnapshot().status, 'complete');
	assert.equal(f.controller.getSnapshot().found, 2);
	assert.equal(f.controller.getSnapshot().progress, 1);
	assert.equal(f.hasTimer(), false);
	await f.controller.startOnOpen();
	assert.deepEqual(f.calls, ['system', 'custom']);
});

test('disabled, unavailable, quarantined, ungranted, and empty installations do not scan', async () => {
	for (const patch of [
		{ enabled: false }, { quarantined: true }, { payload: { status: 'unavailable' } },
		{ consent: { formats: [] } },
		{ consent: { formats: [{ ...fixture().availability().consent.formats[0]!, granted: false }] } },
	]) {
		const f = fixture();
		f.setAvailability({ ...f.availability(), ...patch });
		await f.controller.startOnOpen();
		assert.deepEqual(f.calls, []);
		assert.equal(f.controller.getSnapshot().status, 'idle');
	}
});

test('disabling while a scan runs stops the remaining folders even if a result races cancellation', async () => {
	const f = fixture();
	const operation = f.controller.startOnOpen();
	await flush();
	f.controller.setEnabled(false);
	f.jobs[0]!.resolve(result);
	await operation;
	assert.deepEqual(f.calls, ['system']);
	assert.equal(f.controller.getSnapshot().status, 'cancelled');
	assert.equal(f.controller.getSnapshot().found, 0);
	assert.equal(f.hasTimer(), false);
});

test('a disable observed through the desktop bridge cancels the batch without quarantining or regranting', async () => {
	const f = fixture();
	const operation = f.controller.startOnOpen();
	await flush();
	f.setAvailability({ ...f.availability(), enabled: false });
	await f.tick();
	f.jobs[0]!.resolve({ status: 'failed', code: 'helper-cancelled', message: 'Cancelled' });
	await operation;
	assert.deepEqual(f.calls, ['system']);
	assert.equal(f.controller.getSnapshot().status, 'cancelled');
});

test('manual rescans share the background progress and refuse duplicates', async () => {
	const f = fixture();
	const operation = f.controller.scan();
	assert.equal(f.controller.scan(), operation);
	await flush();
	f.jobs[0]!.resolve({ status: 'failed', code: 'helper-failed', message: 'Scanner failed' });
	await flush();
	f.jobs[1]!.resolve(result);
	await operation;
	assert.equal(f.controller.getSnapshot().status, 'failed');
	assert.equal(f.controller.getSnapshot().found, 1);
	assert.equal(f.controller.getSnapshot().detail, 'Scanner failed');
});

test('disposal during availability lookup prevents any scan and is idempotent', async () => {
	const pending = deferred<NativePluginScanAvailability>();
	let scanned = false;
	const controller = createNativePluginScanController({
		nativePluginAvailability: () => pending.promise,
		scanNativePlugins: () => { scanned = true; return Promise.resolve(result); },
	});
	const operation = controller.startOnOpen();
	controller.dispose();
	controller.dispose();
	pending.resolve(fixture().availability());
	await operation;
	assert.equal(scanned, false);
});

test('availability failure is reported and releases timers', async () => {
	const controller = createNativePluginScanController({
		nativePluginAvailability: () => Promise.reject(new Error('Bridge failed')),
		scanNativePlugins: () => Promise.resolve(result),
	});
	await controller.startOnOpen();
	assert.equal(controller.getSnapshot().status, 'failed');
	assert.equal(controller.getSnapshot().detail, 'Bridge failed');
});

test('an unreadable or truncated described result remains visible as a warning', async () => {
	const f = fixture();
	const operation = f.controller.scan();
	await flush();
	f.jobs[0]!.resolve({ status: 'described', scan: { status: 'root-oversized', detail: 'Only a prefix fit.', entries: [{}] } });
	await flush();
	f.jobs[1]!.resolve(result);
	await operation;
	assert.equal(f.controller.getSnapshot().status, 'failed');
	assert.equal(f.controller.getSnapshot().found, 2);
	assert.equal(f.controller.getSnapshot().detail, 'Only a prefix fit.');
});
