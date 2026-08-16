/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assertNativeMediaCapabilitySnapshotV1,
	createNativeMediaCapabilitySnapshotV1,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	nativeMediaCapabilityRefusals,
	NATIVE_MEDIA_CAPABILITY_CLOSED_OBSERVATION,
	NATIVE_MEDIA_CAPABILITY_DOMAINS,
	NATIVE_MEDIA_CAPABILITY_STATES,
	NativeMediaCapabilityError,
	resolveNativeMediaCapability,
} from '../src/common/editor/native-media-capability-snapshot.ts';

const FINGERPRINT = 'a1'.repeat(32);

test('the report distinguishes every state the milestone-5B contract names', () => {
	assert.deepEqual([...NATIVE_MEDIA_CAPABILITY_STATES], [
		'disabled', 'blocked-policy', 'unavailable', 'available', 'degraded', 'quarantined',
	]);
	assert.deepEqual([...NATIVE_MEDIA_CAPABILITY_DOMAINS], [
		'codec', 'operation', 'backend', 'queue', 'watch', 'scratch', 'display', 'ofx',
	]);
});

test('every observation is closed by default, so nothing is capable until proven', () => {
	assert.deepEqual(NATIVE_MEDIA_CAPABILITY_CLOSED_OBSERVATION, {
		policyCleared: false,
		masterEnabled: false,
		buildSupported: false,
		probeSucceeded: false,
		selfTestPassed: false,
		quarantined: false,
		degraded: false,
		userEnabled: false,
	});
	assert.deepEqual(resolveNativeMediaCapability({}), {
		state: 'blocked-policy', reason: 'policy-row-blocked',
	});
});

test('capability is the intersection of policy, build, probe, self-test, and health', () => {
	const cleared = { policyCleared: true, masterEnabled: true, buildSupported: true, probeSucceeded: true, selfTestPassed: true };

	assert.deepEqual(resolveNativeMediaCapability(cleared), { state: 'available', reason: 'ready' });
	assert.deepEqual(resolveNativeMediaCapability({ ...cleared, buildSupported: false }), {
		state: 'unavailable', reason: 'build-does-not-support',
	});
	assert.deepEqual(resolveNativeMediaCapability({ ...cleared, probeSucceeded: false }), {
		state: 'unavailable', reason: 'driver-probe-failed',
	});
	assert.deepEqual(resolveNativeMediaCapability({ ...cleared, selfTestPassed: false }), {
		state: 'unavailable', reason: 'self-test-failed',
	});
	assert.deepEqual(resolveNativeMediaCapability({ ...cleared, degraded: true }), {
		state: 'degraded', reason: 'degraded-after-failure',
	});
	assert.deepEqual(resolveNativeMediaCapability({ ...cleared, masterEnabled: false }), {
		state: 'disabled', reason: 'master-switch-off',
	});
});

test('a blocked policy row dominates every switch, and quarantine stays visible', () => {
	const everythingElseReady = {
		masterEnabled: true, buildSupported: true, probeSucceeded: true,
		selfTestPassed: true, userEnabled: true,
	};

	assert.deepEqual(
		resolveNativeMediaCapability({ ...everythingElseReady, policyCleared: false }),
		{ state: 'blocked-policy', reason: 'policy-row-blocked' },
	);
	// A capability that has hurt the editor must not read as merely switched off.
	assert.deepEqual(
		resolveNativeMediaCapability({ ...everythingElseReady, policyCleared: true, quarantined: true, masterEnabled: false }),
		{ state: 'quarantined', reason: 'quarantined-after-repeated-failure' },
	);
	assert.deepEqual(
		resolveNativeMediaCapability({ ...everythingElseReady, policyCleared: false, quarantined: true }),
		{ state: 'blocked-policy', reason: 'policy-row-blocked' },
	);
});

test('availability never implies user enablement', () => {
	const snapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		buildFingerprint: FINGERPRINT,
		entries: [
			ready('backend', 'native-cpu', { userEnabled: true }),
			ready('backend', 'nvdec', { userEnabled: false }),
		],
	});
	const cpu = nativeMediaCapabilityEntry(snapshot, 'backend', 'native-cpu');
	const nvdec = nativeMediaCapabilityEntry(snapshot, 'backend', 'nvdec');

	assert.equal(nvdec?.state, 'available');
	assert.equal(nvdec?.userEnabled, false);
	assert.equal(isNativeMediaCapabilityUsable(nvdec), false);
	assert.equal(isNativeMediaCapabilityUsable(cpu), true);
	assert.equal(isNativeMediaCapabilityUsable(null), false);
});

test('a knowingly degraded capability stays usable while an unavailable one does not', () => {
	const snapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		entries: [
			ready('backend', 'qsv', { userEnabled: true, degraded: true }),
			ready('backend', 'amf', { userEnabled: true, probeSucceeded: false }),
		],
	});

	assert.equal(isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, 'backend', 'qsv')), true);
	assert.equal(isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, 'backend', 'amf')), false);
});

test('disabling every helper still reports what each capability would have been', () => {
	const snapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: false,
		buildFingerprint: FINGERPRINT,
		entries: [
			ready('codec', 'prores', { userEnabled: true }),
			{ domain: 'codec', id: 'hevc', policyCleared: false },
			ready('queue', 'persistent-render-queue', { quarantined: true }),
		],
	});

	assert.equal(snapshot.masterEnabled, false);
	assert.equal(nativeMediaCapabilityEntry(snapshot, 'codec', 'prores')?.state, 'disabled');
	assert.equal(nativeMediaCapabilityEntry(snapshot, 'codec', 'prores')?.reason, 'master-switch-off');
	assert.equal(nativeMediaCapabilityEntry(snapshot, 'codec', 'hevc')?.state, 'blocked-policy');
	assert.equal(nativeMediaCapabilityEntry(snapshot, 'queue', 'persistent-render-queue')?.state, 'quarantined');
	assert.deepEqual(
		nativeMediaCapabilityRefusals(snapshot).map((entry) => entry.id),
		['hevc', 'persistent-render-queue'],
	);
	assert.equal(snapshot.entries.every((entry) => entry.buildFingerprint === FINGERPRINT), true);
});

test('an entry inherits the snapshot build fingerprint and may carry its own', () => {
	const other = 'b2'.repeat(32);
	const snapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		buildFingerprint: FINGERPRINT,
		entries: [ready('ofx', 'isolated-host', { userEnabled: true }), {
			...ready('backend', 'videotoolbox', { userEnabled: true }), buildFingerprint: other,
		}],
	});

	assert.equal(nativeMediaCapabilityEntry(snapshot, 'ofx', 'isolated-host')?.buildFingerprint, FINGERPRINT);
	assert.equal(nativeMediaCapabilityEntry(snapshot, 'backend', 'videotoolbox')?.buildFingerprint, other);
});

test('malformed snapshot input is refused rather than normalized', () => {
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		entries: [{ domain: 'transcode' as never, id: 'x' }],
	}), NativeMediaCapabilityError);
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		entries: [{ domain: 'codec', id: 'Not Kebab' }],
	}), /bounded lowercase kebab-case/u);
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		entries: [{ domain: 'codec', id: 'h264' }, { domain: 'codec', id: 'h264' }],
	}), /reported more than once/u);
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		buildFingerprint: 'not-a-digest', entries: [],
	}), /lowercase SHA-256 digest/u);
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		entries: [{ domain: 'codec', id: 'h264', detail: '' }],
	}), /bounded non-empty text/u);
	assert.throws(() => createNativeMediaCapabilitySnapshotV1({
		entries: [{ domain: 'codec', id: 'h264', detail: 'x'.repeat(513) }],
	}), /bounded non-empty text/u);
});

test('an independently parsed snapshot is admitted only when it is self-consistent', () => {
	const snapshot = createNativeMediaCapabilitySnapshotV1({
		masterEnabled: true,
		buildFingerprint: FINGERPRINT,
		entries: [ready('display', 'external-programme', { userEnabled: true })],
	});
	const detached = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
	assert.doesNotThrow(() => assertNativeMediaCapabilitySnapshotV1(detached));

	for (const [mutate, pattern] of [
		[(value: Record<string, unknown>) => { value.snapshotVersion = 2; }, /version is unsupported/u],
		[(value: Record<string, unknown>) => { value.extra = 1; }, /exactly its schema keys/u],
		[(value: Record<string, unknown>) => {
			(entriesOf(value)[0] as Record<string, unknown>).state = 'wonderful';
		}, /known state and reason/u],
		[(value: Record<string, unknown>) => {
			(entriesOf(value)[0] as Record<string, unknown>).userEnabled = 'yes';
		}, /state its user opt-in/u],
		[(value: Record<string, unknown>) => {
			const entry = entriesOf(value)[0] as Record<string, unknown>;
			entry.state = 'disabled';
			entry.reason = 'master-switch-off';
		}, /contradicts its own master switch/u],
	] as const) {
		const tampered = JSON.parse(JSON.stringify(snapshot)) as Record<string, unknown>;
		mutate(tampered);
		assert.throws(() => assertNativeMediaCapabilitySnapshotV1(tampered), pattern);
	}
});

function entriesOf(value: Record<string, unknown>): unknown[] {
	return value.entries as unknown[];
}

function ready(
	domain: 'backend' | 'codec' | 'display' | 'ofx' | 'operation' | 'queue' | 'scratch' | 'watch',
	id: string,
	overrides: Readonly<Record<string, boolean>> = {},
) {
	return {
		domain,
		id,
		policyCleared: true,
		buildSupported: true,
		probeSucceeded: true,
		selfTestPassed: true,
		...overrides,
	} as const;
}
