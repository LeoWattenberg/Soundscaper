/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PLUGIN_HOST_MAXIMUM_PROCESSES,
	PluginHostIsolationRegistry,
	type PluginHostLaunch,
	type PluginHostProcess,
	type PluginInstanceAcquisition,
} from '../desktop/plugin-host-isolation.ts';

interface PendingStart {
	readonly launch: PluginHostLaunch;
	readonly resolve: () => void;
	readonly reject: (error: Error) => void;
}

function digest(index: number): string {
	return index.toString(16).padStart(64, '0');
}

function createHarness(): Readonly<{
	registry: PluginHostIsolationRegistry;
	launches: PluginHostLaunch[];
	pending: PendingStart[];
	killed: string[];
	settleAll: () => void;
}> {
	const launches: PluginHostLaunch[] = [];
	const pending: PendingStart[] = [];
	const killed: string[] = [];
	let minted = 0;
	const registry = new PluginHostIsolationRegistry({
		isEnabled: () => true,
		mintId: () => `capacity-${String(++minted)}`,
		startHost: (launch) => {
			launches.push(launch);
			const process: PluginHostProcess = {
				kill: () => { killed.push(launch.hostId); },
				openVendorUi: ({ windowHandleId }) => windowHandleId,
				closeVendorUi: () => undefined,
			};
			return new Promise<PluginHostProcess>((resolve, reject) => {
				pending.push({ launch, resolve: () => { resolve(process); }, reject });
			});
		},
	});
	return {
		registry, launches, pending, killed,
		settleAll: () => {
			for (const start of pending.splice(0, pending.length)) start.resolve();
		},
	};
}

function acquire(
	registry: PluginHostIsolationRegistry,
	owner: object,
	binarySha256: string,
): Promise<PluginInstanceAcquisition> {
	return registry.acquireInstance({ owner, binarySha256, format: 'vst3' });
}

function refusalCode(outcome: PluginInstanceAcquisition): string {
	assert.equal(outcome.status, 'refused');
	return outcome.status === 'refused' ? outcome.code : 'unreachable';
}

test('the exact host ceiling shares a same-key start and owner revocation immediately recovers capacity', async () => {
	const harness = createHarness();
	const owner = {};
	const acquisitions = Array.from(
		{ length: PLUGIN_HOST_MAXIMUM_PROCESSES },
		(_unused, index) => acquire(harness.registry, owner, digest(index + 1)),
	);
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES);
	assert.equal(harness.registry.snapshot().hostCount, PLUGIN_HOST_MAXIMUM_PROCESSES);

	const shared = acquire(harness.registry, owner, digest(1));
	await Promise.resolve();
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES,
		'a same-key request shares the pending start even at saturation');
	const excess = await acquire(harness.registry, owner, digest(PLUGIN_HOST_MAXIMUM_PROCESSES + 1));
	assert.equal(refusalCode(excess), 'host-capacity');
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES,
		'exhaustion refuses before invoking the process factory');

	const firstStart = harness.pending.shift();
	assert.ok(firstStart);
	firstStart.resolve();
	const [first, sameHost] = await Promise.all([acquisitions[0], shared]);
	assert.equal(first.status, 'hosted');
	assert.equal(sameHost.status, 'hosted');
	if (first.status === 'hosted' && sameHost.status === 'hosted') {
		assert.equal(sameHost.instance.hostId, first.instance.hostId);
	}

	harness.registry.revokeOwner(owner);
	assert.equal(harness.registry.snapshot().hostCount, 0,
		'owner loss frees live and still-starting host slots synchronously');
	const replacement = acquire(harness.registry, {}, digest(PLUGIN_HOST_MAXIMUM_PROCESSES + 1));
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES + 1,
		'a replacement starts while the revoked process starts are still unsettled');
	harness.settleAll();
	for (const outcome of await Promise.all(acquisitions.slice(1))) {
		assert.equal(refusalCode(outcome), 'owner-changed');
	}
	assert.equal((await replacement).status, 'hosted');
});

test('a failed start releases one saturated host slot', async () => {
	const harness = createHarness();
	const owner = {};
	const acquisitions = Array.from(
		{ length: PLUGIN_HOST_MAXIMUM_PROCESSES },
		(_unused, index) => acquire(harness.registry, owner, digest(index + 1)),
	);
	assert.equal(refusalCode(await acquire(
		harness.registry, owner, digest(PLUGIN_HOST_MAXIMUM_PROCESSES + 1),
	)), 'host-capacity');
	const failedStart = harness.pending.shift();
	assert.ok(failedStart);
	failedStart.reject(new Error('fixture start failure'));
	assert.equal(refusalCode(await acquisitions[0]), 'host-start-failed');
	assert.equal(harness.registry.snapshot().hostCount, PLUGIN_HOST_MAXIMUM_PROCESSES - 1);

	const replacement = acquire(harness.registry, owner, digest(PLUGIN_HOST_MAXIMUM_PROCESSES + 1));
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES + 1);
	assert.equal(harness.registry.snapshot().hostCount, PLUGIN_HOST_MAXIMUM_PROCESSES);
	harness.settleAll();
	assert.ok((await Promise.all([...acquisitions.slice(1), replacement]))
		.every((outcome) => outcome.status === 'hosted'));
	harness.registry.dispose();
});

test('disposing a saturated registry clears every host admission before starts settle', async () => {
	const harness = createHarness();
	const owner = {};
	const acquisitions = Array.from(
		{ length: PLUGIN_HOST_MAXIMUM_PROCESSES },
		(_unused, index) => acquire(harness.registry, owner, digest(index + 1)),
	);
	assert.equal(harness.registry.snapshot().hostCount, PLUGIN_HOST_MAXIMUM_PROCESSES);
	harness.registry.dispose();
	assert.equal(harness.registry.snapshot().hostCount, 0);
	assert.equal(refusalCode(await acquire(harness.registry, {}, digest(10_000))), 'disposed');
	assert.equal(harness.launches.length, PLUGIN_HOST_MAXIMUM_PROCESSES);

	harness.settleAll();
	for (const outcome of await Promise.all(acquisitions)) assert.equal(refusalCode(outcome), 'disposed');
	assert.equal(harness.killed.length, PLUGIN_HOST_MAXIMUM_PROCESSES,
		'every process arriving after disposal is killed');
	assert.equal(harness.registry.snapshot().hostCount, 0);
});
