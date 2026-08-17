/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
	PLUGIN_HOST_BENIGN_STOP_REASONS,
	PLUGIN_VENDOR_UI_DENIED_CAPABILITIES,
	PLUGIN_VENDOR_UI_SURFACES,
	PluginHostIsolationRegistry,
	pluginHostIsolationKey,
	type PluginHostLaunch,
	type PluginHostProcess,
	type PluginHostStopReason,
	type PluginInstanceAcquisition,
	type PluginInstanceRecord,
	type PluginVendorUiOutcome,
	type PluginVendorUiWindow,
} from '../desktop/plugin-host-isolation.ts';
import {
	PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES,
	PluginInstanceStateStore,
} from '../desktop/plugin-instance-state.ts';
import { PLUGIN_HOST_FAULT_LIMIT, PLUGIN_HOST_FAULT_WINDOW_MS } from '../desktop/plugin-quarantine.ts';

const LIMITER = 'a'.repeat(64);
const REVERB = 'b'.repeat(64);

interface Deferred {
	readonly launch: PluginHostLaunch;
	/** The harness owns the process object, so a start is settled, not supplied. */
	readonly resolve: () => void;
	readonly reject: (error: Error) => void;
}

interface Harness {
	readonly registry: PluginHostIsolationRegistry;
	readonly launches: PluginHostLaunch[];
	readonly killed: string[];
	readonly openedWindows: string[];
	readonly openRequests: unknown[];
	readonly closedWindows: string[];
	readonly pending: Deferred[];
	readonly store: PluginInstanceStateStore;
	advance(ms: number): void;
	failNextStart(message: string): void;
	failVendorUi(message: string): void;
	settleStarts(): void;
}

function createHarness(options: Partial<{
	enabled: boolean;
	manual: boolean;
	useStore: boolean;
	isDigestQuarantined: (binarySha256: string) => boolean;
}> = {}): Harness {
	const launches: PluginHostLaunch[] = [];
	const killed: string[] = [];
	const openedWindows: string[] = [];
	const openRequests: unknown[] = [];
	const closedWindows: string[] = [];
	const pending: Deferred[] = [];
	const store = new PluginInstanceStateStore();
	let clock = 1_000_000;
	let nextFailure: string | null = null;
	let vendorFailure: string | null = null;
	let minted = 0;
	const registry = new PluginHostIsolationRegistry({
		startHost: (launch) => {
			launches.push(launch);
			const process: PluginHostProcess = {
				kill: () => killed.push(launch.hostId),
				openVendorUi: (request) => {
					if (vendorFailure !== null) throw new Error(vendorFailure);
					openRequests.push(request);
					openedWindows.push(request.windowHandleId);
				},
				closeVendorUi: (windowHandleId) => closedWindows.push(windowHandleId),
			};
			if (nextFailure !== null) {
				const message = nextFailure;
				nextFailure = null;
				return Promise.reject(new Error(message));
			}
			if (!options.manual) return Promise.resolve(process);
			return new Promise<PluginHostProcess>((resolve, reject) => {
				pending.push({ launch, resolve: () => { resolve(process); }, reject });
			});
		},
		mintId: () => {
			minted += 1;
			return `id-${String(minted)}`;
		},
		isEnabled: options.enabled === false ? undefined : () => true,
		isStateEligible: options.useStore ? (instanceId) => store.isEligible(instanceId) : undefined,
		isDigestQuarantined: options.isDigestQuarantined,
		now: () => clock,
	});
	return {
		registry, launches, killed, openedWindows, openRequests, closedWindows, pending, store,
		advance: (ms) => { clock += ms; },
		failNextStart: (message) => { nextFailure = message; },
		failVendorUi: (message) => { vendorFailure = message; },
		settleStarts: () => {
			for (const deferred of pending.splice(0, pending.length)) deferred.resolve();
		},
	};
}

function hosted(outcome: PluginInstanceAcquisition): PluginInstanceRecord {
	assert.equal(outcome.status, 'hosted', outcome.status === 'refused' ? outcome.message : '');
	if (outcome.status !== 'hosted') throw new Error('unreachable');
	return outcome.instance;
}

function refusal(outcome: PluginInstanceAcquisition | PluginVendorUiOutcome): Readonly<{ code: string; message: string }> {
	assert.equal(outcome.status, 'refused');
	if (outcome.status !== 'refused') throw new Error('unreachable');
	return outcome;
}

function openedWindow(outcome: PluginVendorUiOutcome): PluginVendorUiWindow {
	assert.equal(outcome.status, 'opened');
	if (outcome.status !== 'opened') throw new Error('unreachable');
	return outcome.window;
}

async function acquire(
	harness: Harness,
	owner: object,
	binarySha256: string,
	instanceId?: string,
): Promise<PluginInstanceAcquisition> {
	return harness.registry.acquireInstance({ owner, binarySha256, format: 'vst3', ...(instanceId ? { instanceId } : {}) });
}

test('plug-in hosting is off until something turns it on', async () => {
	const harness = createHarness({ enabled: false });
	const outcome = await acquire(harness, {}, LIMITER);
	assert.equal(refusal(outcome).code, 'hosting-disabled');
	assert.equal(harness.launches.length, 0, 'a disabled surface must never spawn a host');
	assert.equal(harness.registry.snapshot().enabled, false);
	assert.equal(refusal(harness.registry.openVendorUi('id-1')).code, 'hosting-disabled');
});

test('one host per owner and digest: shared within the pair, never across one', async () => {
	const harness = createHarness();
	const editor = { name: 'renderer-1' };
	const second = { name: 'renderer-2' };

	// Same owner, same digest: two instances, one process.
	const firstInstance = hosted(await acquire(harness, editor, LIMITER));
	const sameBinary = hosted(await acquire(harness, editor, LIMITER));
	assert.equal(sameBinary.hostId, firstInstance.hostId);
	assert.equal(harness.launches.length, 1, 'the same binary for the same owner reuses its host');

	// Same owner, unrelated digest: never shared.
	const otherBinary = hosted(await acquire(harness, editor, REVERB));
	assert.notEqual(otherBinary.hostId, firstInstance.hostId);
	assert.equal(harness.launches.length, 2);

	// Unrelated owner, same digest: never shared either.
	const otherOwner = hosted(await acquire(harness, second, LIMITER));
	assert.notEqual(otherOwner.hostId, firstInstance.hostId);
	assert.notEqual(otherOwner.ownerId, firstInstance.ownerId);
	assert.equal(harness.launches.length, 3);
	assert.equal(harness.registry.snapshot().hostCount, 3);

	assert.equal(
		pluginHostIsolationKey(firstInstance.ownerId, LIMITER) === pluginHostIsolationKey(otherOwner.ownerId, LIMITER),
		false,
	);
	// The launch main performs names the digest, not a path on disk.
	assert.deepEqual(Object.keys(harness.launches[0]).sort(), ['binarySha256', 'format', 'hostId', 'ownerId']);
});

test('concurrent requests for one isolation unit share the one starting process', async () => {
	const harness = createHarness({ manual: true });
	const editor = {};
	const both = Promise.all([acquire(harness, editor, LIMITER), acquire(harness, editor, LIMITER)]);
	await Promise.resolve();
	assert.equal(harness.pending.length, 1, 'a second request must not spawn a second process for the same pair');
	harness.settleStarts();
	const [first, second] = await both;
	assert.equal(hosted(first).hostId, hosted(second).hostId);
	assert.equal(harness.launches.length, 1);
});

test('revoking a digest kills its hosts and prevents any automatic restart', async () => {
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const unrelated = hosted(await acquire(harness, editor, REVERB));
	const window = openedWindow(harness.registry.openVendorUi(instance.instanceId));

	const affected = harness.registry.revokeDigest(LIMITER);
	assert.deepEqual([...affected], [instance.instanceId]);
	assert.deepEqual(harness.killed, [instance.hostId]);
	assert.deepEqual(harness.closedWindows, [window.windowHandleId], 'helper loss closes the vendor window');
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.state, 'revoked');
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.hostId, null);
	assert.equal(harness.registry.describeDigest(LIMITER).revoked, true);

	// The next instance request is the only thing that could restart a host,
	// and it refuses. Nothing else in the registry restarts anything.
	const after = await acquire(harness, editor, LIMITER);
	assert.equal(refusal(after).code, 'digest-revoked');
	assert.equal(harness.launches.length, 2, 'a revoked digest never comes back on the next request');
	assert.equal(harness.registry.describeInstance(unrelated.instanceId)?.state, 'hosted');

	assert.equal(harness.registry.restoreDigest(LIMITER), true);
	assert.equal(hosted(await acquire(harness, editor, LIMITER)).state, 'hosted');
	assert.equal(harness.launches.length, 3, 'only an explicit restore brings the digest back');
});

test('a revocation while a host is starting still wins', async () => {
	const harness = createHarness({ manual: true });
	const acquisition = acquire(harness, {}, LIMITER);
	await Promise.resolve();
	harness.registry.revokeDigest(LIMITER);
	harness.settleStarts();
	assert.equal(refusal(await acquisition).code, 'digest-revoked');
	assert.deepEqual(harness.killed, [harness.launches[0].hostId], 'the host that started anyway is torn down');
	assert.equal(harness.registry.snapshot().hostCount, 0);
});

test('two qualifying faults in the window quarantine the digest; benign stops do not', async () => {
	const harness = createHarness();
	const editor = {};
	const first = hosted(await acquire(harness, editor, LIMITER));
	const crash = harness.registry.reportHostStopped({ hostId: first.hostId ?? '', reason: 'crash' });
	assert.equal(crash.qualifyingFault, true);
	assert.equal(crash.quarantined, false);
	assert.deepEqual([...crash.instanceIds], [first.instanceId]);
	assert.equal(harness.registry.describeInstance(first.instanceId)?.state, 'faulted');

	const second = hosted(await acquire(harness, editor, LIMITER, first.instanceId));
	const benign = harness.registry.reportHostStopped({ hostId: second.hostId ?? '', reason: 'user-cancelled' });
	assert.equal(benign.qualifyingFault, false, 'user cancellation is not a fault');
	assert.equal(harness.registry.describeInstance(first.instanceId)?.state, 'stopped');
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, 1);

	const third = hosted(await acquire(harness, editor, LIMITER, first.instanceId));
	const quarantining = harness.registry.reportHostStopped({ hostId: third.hostId ?? '', reason: 'hang' });
	assert.equal(quarantining.quarantined, true);
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, PLUGIN_HOST_FAULT_LIMIT);
	assert.equal(refusal(await acquire(harness, editor, LIMITER)).code, 'digest-quarantined');

	// An unknown host cannot charge a fault to anything.
	const stray = harness.registry.reportHostStopped({ hostId: 'no-such-host', reason: 'crash' });
	assert.equal(stray.qualifyingFault, false);
	assert.deepEqual([...stray.instanceIds], []);
});

test('a stop reason outside the benign list is charged as a fault, not waved through', async () => {
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	// Only the benign vocabulary is benign. A reason nobody recognises must not
	// be able to launder a crash into an ordinary stop and clear the ledger.
	const unknown = harness.registry.reportHostStopped({
		hostId: instance.hostId ?? '', reason: 'user-cancelled ' as PluginHostStopReason,
	});
	assert.equal(unknown.qualifyingFault, true);
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, 1);
	for (const reason of PLUGIN_HOST_BENIGN_STOP_REASONS) {
		const next = hosted(await acquire(harness, editor, LIMITER, instance.instanceId));
		assert.equal(harness.registry.reportHostStopped({ hostId: next.hostId ?? '', reason }).qualifyingFault, false);
	}
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, 1, 'benign stops never touch the ledger');
	assert.equal(harness.registry.describeDigest(LIMITER).quarantined, false);
});

test('faults outside the window do not accumulate into a quarantine', async () => {
	const harness = createHarness();
	const editor = {};
	const first = hosted(await acquire(harness, editor, LIMITER));
	harness.registry.reportHostStopped({ hostId: first.hostId ?? '', reason: 'crash' });
	harness.advance(PLUGIN_HOST_FAULT_WINDOW_MS + 1);
	const second = hosted(await acquire(harness, editor, LIMITER, first.instanceId));
	const later = harness.registry.reportHostStopped({ hostId: second.hostId ?? '', reason: 'crash' });
	assert.equal(later.quarantined, false);
	assert.equal(harness.registry.describeDigest(LIMITER).quarantined, false);
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, 1);
});

test('a crash leaves the opaque state intact and offers bypass, not a fabricated freeze', async () => {
	const harness = createHarness({ useStore: true });
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const bytes = Uint8Array.from({ length: 512 }, (_value, index) => index & 0xff);
	const persisted = harness.store.persist({ instanceId: instance.instanceId, generation: 1, bytes });
	assert.equal(persisted.status, 'persisted');

	harness.registry.reportHostStopped({ hostId: instance.hostId ?? '', reason: 'crash' });
	const decision = harness.registry.continuityFor({
		instanceId: instance.instanceId,
		retainedOpaqueState: harness.store.describe(instance.instanceId).retained,
	});
	assert.equal(decision.mode, 'bypass');
	assert.equal(decision.freeze, null, 'no freeze is manufactured after a failure');
	assert.equal(decision.parametersIntact, true);
	assert.equal(decision.cause, 'faulted');
	assert.equal(decision.opaqueState?.byteLength, 512);
	assert.deepEqual(harness.store.read(instance.instanceId)?.bytes, bytes, 'the crash cost the state nothing');
});

test('an oversize state makes the instance ineligible to rehost but keeps its state', async () => {
	const harness = createHarness({ useStore: true });
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const bytes = Uint8Array.from({ length: 128 }, (_value, index) => index);
	harness.store.persist({ instanceId: instance.instanceId, generation: 1, bytes });
	harness.registry.reportHostStopped({ hostId: instance.hostId ?? '', reason: 'oversize-state' });
	harness.store.declareOversizeState({
		instanceId: instance.instanceId,
		generation: 2,
		declaredByteLength: PLUGIN_OPAQUE_STATE_MAXIMUM_BYTES + 4_096,
	});

	const rehost = await acquire(harness, editor, LIMITER, instance.instanceId);
	assert.equal(refusal(rehost).code, 'state-ineligible');
	assert.deepEqual(harness.store.read(instance.instanceId)?.bytes, bytes,
		'ineligibility must not be implemented as a discard');
	assert.equal(harness.launches.length, 1);
});

test('losing the renderer owner closes its hosts and advances its generation', async () => {
	const harness = createHarness();
	const editor = {};
	const other = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const survivor = hosted(await acquire(harness, other, LIMITER));
	const window = openedWindow(harness.registry.openVendorUi(instance.instanceId));
	assert.equal(instance.ownerGeneration, 1);

	const affected = harness.registry.revokeOwner(editor);
	assert.deepEqual([...affected], [instance.instanceId]);
	assert.deepEqual(harness.closedWindows, [window.windowHandleId], 'owner loss closes the vendor window at once');
	assert.equal(harness.registry.describeInstance(instance.instanceId), null);
	assert.equal(harness.registry.describeInstance(survivor.instanceId)?.state, 'hosted',
		'an unrelated owner keeps its own host');

	const reopened = hosted(await acquire(harness, editor, LIMITER));
	assert.equal(reopened.ownerGeneration, 2);
	assert.notEqual(reopened.hostId, instance.hostId);
});

test('a departing owner takes its detached instances with it, not only its hosted ones', async () => {
	// A host that faulted leaves its instances attached to nothing. If they
	// outlive their owner, the next session restoring that project's instance id
	// is refused for the rest of the process lifetime and the map grows across
	// every reload — a leak that presents as a plug-in that will not come back.
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	harness.registry.reportHostStopped({ hostId: instance.hostId ?? '', reason: 'crash' });
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.hostId, null,
		'the crashed host leaves the instance attached to nothing');

	const affected = harness.registry.revokeOwner(editor);
	assert.deepEqual([...affected], [instance.instanceId], 'revocation names everything the owner owned');
	assert.equal(harness.registry.describeInstance(instance.instanceId), null);
	assert.equal(harness.registry.snapshot().instanceCount, 0);

	// The restored project asks for its own instance id back and gets it.
	const next = {};
	const restored = hosted(await acquire(harness, next, LIMITER, instance.instanceId));
	assert.equal(restored.instanceId, instance.instanceId);
	assert.equal(restored.state, 'hosted');
});

test('the host fault window is the durable store\'s window, not a second one beside it', async () => {
	// A second copy of the limit is a second answer to "is this quarantined?".
	const source = readFileSync(new URL('../desktop/plugin-host-isolation.ts', import.meta.url), 'utf8');
	assert.equal(/= 10 \* 60_000|FAULT_LIMIT = \d/u.test(source), false,
		'the isolation registry must take the fault window and limit from the durable store');

	const harness = createHarness();
	const instance = hosted(await acquire(harness, {}, LIMITER));
	harness.registry.reportHostStopped({ hostId: instance.hostId ?? '', reason: 'crash' });
	harness.advance(PLUGIN_HOST_FAULT_WINDOW_MS + 1);
	assert.equal(harness.registry.describeDigest(LIMITER).recentFaults, 0, 'the store\'s window is the one applied');
});

test('a digest the durable quarantine already holds is refused without a second ledger', async () => {
	const quarantined = new Set<string>([REVERB]);
	const harness = createHarness({ isDigestQuarantined: (digest) => quarantined.has(digest) });
	assert.equal(refusal(await acquire(harness, {}, REVERB)).code, 'digest-quarantined');
	assert.equal(harness.launches.length, 0, 'a durably quarantined binary must never be spawned');
	assert.equal(harness.registry.describeDigest(REVERB).quarantined, true);

	// A digest the durable store does not hold is hosted as usual, and the
	// registry's own answer follows the store rather than shadowing it.
	assert.equal(hosted(await acquire(harness, {}, LIMITER)).binarySha256, LIMITER);
	quarantined.add(LIMITER);
	assert.equal(harness.registry.describeDigest(LIMITER).quarantined, true);
});

test('vendor UI is an opaque helper-owned window whose loss is not the effect being closed', async () => {
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const window = openedWindow(harness.registry.openVendorUi(instance.instanceId));
	assert.deepEqual(
		Object.keys(window).sort(),
		['hostId', 'instanceId', 'ownerGeneration', 'surface', 'windowHandleId'],
	);
	for (const value of Object.values(window)) assert.ok(typeof value === 'string' || typeof value === 'number');
	assert.equal(window.surface, 'helper-owned-top-level');
	assert.equal(PLUGIN_VENDOR_UI_SURFACES.length, 1, 'an embedded native child window is not a modelled fallback');
	assert.ok(PLUGIN_VENDOR_UI_DENIED_CAPABILITIES.includes('embedded-child-window'));
	for (const capability of ['renderer-bridge', 'dom', 'node', 'file-system', 'network', 'child-process'] as const) {
		assert.ok(PLUGIN_VENDOR_UI_DENIED_CAPABILITIES.includes(capability));
	}
	assert.deepEqual(harness.openedWindows, [window.windowHandleId], 'the helper opens its own window');

	assert.equal(harness.registry.closeVendorUi(window.windowHandleId), true);
	assert.deepEqual(harness.closedWindows, [window.windowHandleId]);
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.state, 'hosted',
		'closing the vendor window does not close the effect');
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.hostId, instance.hostId);
	assert.deepEqual(harness.killed, []);
	assert.equal(harness.registry.closeVendorUi(window.windowHandleId), false);

	// Helper loss closes it immediately, without anyone asking.
	const second = openedWindow(harness.registry.openVendorUi(instance.instanceId));
	harness.registry.reportHostStopped({ hostId: instance.hostId ?? '', reason: 'crash' });
	assert.deepEqual(harness.registry.vendorUiWindows(), []);
	assert.deepEqual(harness.closedWindows, [window.windowHandleId, second.windowHandleId]);
	assert.equal(refusal(harness.registry.openVendorUi(instance.instanceId)).code, 'instance-not-hosted');
	assert.equal(refusal(harness.registry.openVendorUi('id-999')).code, 'unknown-instance');
});

test('renderer-facing records carry opaque ids and never a filesystem path', async () => {
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const window = openedWindow(harness.registry.openVendorUi(instance.instanceId));
	const published = JSON.stringify([instance, window, harness.registry.describeDigest(LIMITER)]);
	for (const fragment of ['/', '\\', 'Path', 'path']) {
		assert.equal(published.includes(fragment), false, `renderer-facing data must not contain ${fragment}`);
	}
	assert.equal(instance.binarySha256, LIMITER, 'the binary is named by digest only');
});

test('a host that fails to start refuses the request without poisoning the digest', async () => {
	const harness = createHarness();
	const editor = {};
	// Main resolves the binary path, so the start failure it reports names one.
	// The refusal crosses to the renderer and must carry none of it.
	harness.failNextStart(
		"spawn '/home/leo/Library/Audio/Plug-Ins/VST3/Vendor Limiter.vst3/Contents/MacOS/Limiter' ENOENT",
	);
	const failed = refusal(await acquire(harness, editor, LIMITER));
	assert.equal(failed.code, 'host-start-failed');
	for (const fragment of ['/', '\\', 'Plug-Ins', 'Limiter', 'ENOENT', 'spawn']) {
		assert.equal(failed.message.includes(fragment), false, `a refusal must not carry ${fragment}`);
	}
	assert.ok(failed.message.length <= 200, 'a refusal message is bounded main-authored text');
	assert.equal(harness.registry.snapshot().hostCount, 0);
	assert.equal(harness.registry.describeDigest(LIMITER).quarantined, false);
	assert.equal(hosted(await acquire(harness, editor, LIMITER)).state, 'hosted');
});

test('an explicit restore brings back a digest that was quarantined and then revoked', async () => {
	const harness = createHarness();
	const editor = {};
	const first = hosted(await acquire(harness, editor, LIMITER));
	harness.registry.reportHostStopped({ hostId: first.hostId ?? '', reason: 'crash' });
	const second = hosted(await acquire(harness, editor, LIMITER, first.instanceId));
	harness.registry.reportHostStopped({ hostId: second.hostId ?? '', reason: 'crash' });
	assert.equal(harness.registry.describeDigest(LIMITER).quarantined, true);

	// The user revokes a digest that is already quarantined, then changes their
	// mind. A restore that reports success must not leave a second hold on.
	harness.registry.revokeDigest(LIMITER);
	assert.equal(harness.registry.restoreDigest(LIMITER), true);
	const digest = harness.registry.describeDigest(LIMITER);
	assert.equal(digest.revoked, false);
	assert.equal(digest.quarantined, false);
	assert.equal(digest.recentFaults, 0);
	assert.equal(hosted(await acquire(harness, editor, LIMITER, first.instanceId)).state, 'hosted');
	assert.equal(harness.registry.restoreDigest(REVERB), false, 'nothing was holding that digest down');
});

test('a host started for an owner generation that is gone never serves the next one', async () => {
	const harness = createHarness({ manual: true });
	const editor = {};
	const inFlight = acquire(harness, editor, LIMITER);
	await Promise.resolve();
	assert.equal(harness.pending.length, 1);

	// The renderer goes away while its host is still starting, and comes back
	// before the process has settled. The generation that was revoked must not
	// hand its process to the generation that replaced it.
	harness.registry.revokeOwner(editor);
	const rebuilt = acquire(harness, editor, LIMITER);
	await Promise.resolve();
	harness.settleStarts();
	await Promise.resolve();
	harness.settleStarts();

	assert.equal(refusal(await inFlight).code, 'owner-changed');
	const next = hosted(await rebuilt);
	assert.equal(next.ownerGeneration, 2, 'the surviving instance belongs to the live generation');
	assert.notEqual(next.hostId, harness.launches[0].hostId);
	assert.ok(harness.killed.includes(harness.launches[0].hostId),
		'the process started for the lost generation is killed, not adopted');
	assert.equal(harness.registry.snapshot().hostCount, 1);
});

test('a vendor window the helper refuses to open is never published as open', async () => {
	const harness = createHarness();
	const editor = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	const window = openedWindow(harness.registry.openVendorUi(instance.instanceId));

	// One instance owns one window. Asking again hands back the open handle
	// rather than minting native windows without a bound.
	assert.equal(openedWindow(harness.registry.openVendorUi(instance.instanceId)).windowHandleId, window.windowHandleId);
	assert.deepEqual(harness.openedWindows, [window.windowHandleId]);
	assert.equal(harness.registry.snapshot().vendorWindowCount, 1);
	// The helper is handed two opaque ids and nothing else to open one with.
	assert.deepEqual(harness.openRequests, [{ instanceId: instance.instanceId, windowHandleId: window.windowHandleId }]);
	for (const value of Object.values(harness.openRequests[0] as Record<string, unknown>)) {
		assert.equal(typeof value, 'string');
	}
	assert.equal(Object.isFrozen(harness.openRequests[0]), true);
	assert.equal(harness.registry.closeVendorUi(window.windowHandleId), true);

	harness.failVendorUi('the helper could not create a window on this display');
	const refused = refusal(harness.registry.openVendorUi(instance.instanceId));
	assert.equal(refused.code, 'vendor-ui-unavailable');
	assert.equal(refused.message.includes('display'), false, 'a helper message is not renderer-facing text');
	assert.deepEqual(harness.registry.vendorUiWindows(), [], 'a window that never opened is not tracked as open');
	assert.equal(harness.registry.snapshot().vendorWindowCount, 0);
	assert.equal(harness.registry.describeInstance(instance.instanceId)?.state, 'hosted',
		'a window that failed to open did not close the effect');
});

test('an instance the project closed stops being tracked and takes an idle host with it', async () => {
	const harness = createHarness();
	const editor = {};
	const first = hosted(await acquire(harness, editor, LIMITER));
	const second = hosted(await acquire(harness, editor, LIMITER));
	const window = openedWindow(harness.registry.openVendorUi(first.instanceId));
	assert.equal(harness.registry.snapshot().instanceCount, 2);

	assert.equal(harness.registry.releaseInstance(first.instanceId), true);
	assert.equal(harness.registry.describeInstance(first.instanceId), null);
	assert.deepEqual(harness.closedWindows, [window.windowHandleId], 'the instance leaving closes its own window');
	assert.deepEqual(harness.killed, [], 'the host still has an instance to serve');
	assert.equal(harness.registry.describeInstance(second.instanceId)?.hostId, first.hostId);

	assert.equal(harness.registry.releaseInstance(second.instanceId), true);
	assert.deepEqual(harness.killed, [first.hostId], 'the last instance leaving takes the process with it');
	assert.equal(harness.registry.snapshot().instanceCount, 0);
	assert.equal(harness.registry.snapshot().hostCount, 0);
	assert.equal(harness.registry.releaseInstance(first.instanceId), false, 'releasing twice is not a second teardown');
	assert.equal(harness.killed.length, 1);
});

test('an instance id may not be reused across owners or binaries, and disposal stops everything', async () => {
	const harness = createHarness();
	const editor = {};
	const other = {};
	const instance = hosted(await acquire(harness, editor, LIMITER));
	assert.equal(refusal(await acquire(harness, other, LIMITER, instance.instanceId)).code, 'instance-conflict');
	assert.equal(refusal(await acquire(harness, editor, REVERB, instance.instanceId)).code, 'instance-conflict');
	assert.equal(refusal(await acquire(harness, editor, 'not-a-digest')).code, 'invalid-identity');
	assert.equal(refusal(await acquire(harness, editor, LIMITER, '../escape')).code, 'invalid-identity');

	harness.registry.dispose();
	assert.deepEqual(harness.killed, [instance.hostId]);
	assert.equal(harness.registry.snapshot().disposed, true);
	assert.equal(refusal(await acquire(harness, editor, LIMITER)).code, 'disposed');
	harness.registry.dispose();
	assert.equal(harness.killed.length, 1, 'disposal is idempotent');
});
