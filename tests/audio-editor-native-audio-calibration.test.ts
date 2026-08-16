/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	NATIVE_AUDIO_CALIBRATION_KEY_PREFIX,
	NATIVE_AUDIO_CALIBRATION_LIMITS,
	NATIVE_AUDIO_CALIBRATION_MEMBERS,
	NATIVE_AUDIO_MODES,
	applyNativeAudioCalibration,
	createNativeAudioCalibrationStore,
	nativeAudioCalibrationDrift,
	nativeAudioCalibrationKey,
	nativeAudioCalibrationSourceKey,
	normalizeNativeAudioCalibrationIdentity,
	type NativeAudioCalibrationIdentity,
	type NativeAudioCalibrationResolution,
	type NativeAudioCalibrationStore,
	type RecordingRoutingLike,
} from '../src/common/editor/controller/native-audio-calibration.ts';
import { normalizeRecordingRouting, recordingRouteSourceKey } from '../src/common/editor/recording-routing.js';

const INPUT = 'native:alsa:in:hw:0,0';
const OUTPUT = 'native:alsa:out:hw:0,0';

const IDENTITY: NativeAudioCalibrationIdentity = Object.freeze({
	inputDeviceId: INPUT,
	outputDeviceId: OUTPUT,
	backend: 'alsa',
	mode: 'shared',
	sampleRate: 48_000,
	bufferFrames: 256,
});

function identity(overrides: Partial<NativeAudioCalibrationIdentity> = {}): NativeAudioCalibrationIdentity {
	return Object.freeze({ ...IDENTITY, ...overrides });
}

function createStore(entries?: readonly unknown[]): NativeAudioCalibrationStore {
	let tick = 0;
	return createNativeAudioCalibrationStore({ entries, now: () => { tick += 1_000; return tick; } });
}

function stale(resolution: NativeAudioCalibrationResolution): Readonly<{ changed: readonly string[] }> {
	assert.equal(resolution.status, 'stale');
	if (resolution.status !== 'stale') throw new Error('unreachable');
	assert.equal(resolution.offsetMilliseconds, 0, 'a stale calibration must never carry an offset');
	return resolution;
}

test('the key is the whole tuple and nothing else', () => {
	assert.deepEqual([...NATIVE_AUDIO_CALIBRATION_MEMBERS],
		['inputDeviceId', 'outputDeviceId', 'backend', 'mode', 'sampleRate', 'bufferFrames']);
	const key = nativeAudioCalibrationKey(IDENTITY);
	assert.ok(key.startsWith(NATIVE_AUDIO_CALIBRATION_KEY_PREFIX));
	assert.equal(key, nativeAudioCalibrationKey({ ...IDENTITY }), 'the same tuple must always key the same');
	// A label is not part of identity: a driver rename must not orphan a measurement.
	assert.equal(nativeAudioCalibrationKey({ ...IDENTITY, label: 'Renamed' } as unknown), key);
	for (const member of NATIVE_AUDIO_CALIBRATION_MEMBERS) {
		const moved = member === 'mode'
			? identity({ mode: 'exclusive' })
			: member === 'sampleRate' || member === 'bufferFrames'
				? identity({ [member]: IDENTITY[member] * 2 })
				: identity({ [member]: `${IDENTITY[member]}-other` });
		assert.notEqual(nativeAudioCalibrationKey(moved), key, `${member} must change the key`);
		assert.deepEqual(nativeAudioCalibrationDrift(IDENTITY, moved), [member]);
	}
});

test('drift is reported in tuple order', () => {
	const moved = identity({ mode: 'exclusive', bufferFrames: 512, backend: 'jack' });
	assert.deepEqual(nativeAudioCalibrationDrift(IDENTITY, moved), ['backend', 'mode', 'bufferFrames']);
});

test('an identity is admitted only inside its bounds', () => {
	assert.deepEqual([...NATIVE_AUDIO_MODES], ['shared', 'exclusive']);
	assert.deepEqual(normalizeNativeAudioCalibrationIdentity({ ...IDENTITY, inputDeviceId: undefined }),
		{ ...IDENTITY, inputDeviceId: '' }, 'one absent endpoint is allowed');
	for (const malformed of [
		null, 'identity', [IDENTITY],
		{ ...IDENTITY, inputDeviceId: '', outputDeviceId: '' },
		{ ...IDENTITY, inputDeviceId: 42 },
		{ ...IDENTITY, inputDeviceId: 'x'.repeat(NATIVE_AUDIO_CALIBRATION_LIMITS.maximumDeviceIdLength + 1) },
		{ ...IDENTITY, backend: '' },
		{ ...IDENTITY, backend: 'b'.repeat(NATIVE_AUDIO_CALIBRATION_LIMITS.maximumBackendLength + 1) },
		{ ...IDENTITY, mode: 'hog' },
		{ ...IDENTITY, sampleRate: NATIVE_AUDIO_CALIBRATION_LIMITS.minimumSampleRate - 1 },
		{ ...IDENTITY, sampleRate: 48_000.5 },
		{ ...IDENTITY, bufferFrames: 0 },
		{ ...IDENTITY, bufferFrames: NATIVE_AUDIO_CALIBRATION_LIMITS.maximumBufferFrames + 1 },
	]) {
		assert.throws(() => normalizeNativeAudioCalibrationIdentity(malformed), /calibration/u);
	}
});

test('a device identifier that reads as a path is never admitted into an identity', () => {
	// The key, the snapshot and the routing source key are all derived from the
	// identity, so admitting a path here would persist one outside main.
	for (const path of ['/dev/snd/pcmC0D0c', 'C:\\Windows\\device', '\\\\?\\pipe\\audio', 'hw\\0']) {
		assert.throws(() => normalizeNativeAudioCalibrationIdentity(identity({ inputDeviceId: path })), /opaque/u);
		assert.throws(() => normalizeNativeAudioCalibrationIdentity(identity({ outputDeviceId: path })), /opaque/u);
		assert.throws(() => nativeAudioCalibrationKey(identity({ inputDeviceId: path })), /opaque/u);
	}
	const restored = createStore([
		{ identity: { ...IDENTITY, inputDeviceId: '/dev/snd/pcmC0D0c' }, offsetMilliseconds: 3, measuredAtEpochMs: 1 },
		{ identity: IDENTITY, offsetMilliseconds: 4, measuredAtEpochMs: 2 },
	]);
	assert.equal(restored.snapshot().length, 1, 'a persisted path is dropped, never restored');
	assert.equal(JSON.stringify(restored.snapshot()).includes('/dev/'), false);
});

test('an exact tuple hit is applied and a moved member is not', () => {
	const store = createStore();
	const recorded = store.record(IDENTITY, 12.5);
	assert.equal(recorded.offsetMilliseconds, 12.5);
	assert.equal(recorded.measuredAtEpochMs, 1_000);
	const applied = store.resolve(IDENTITY);
	assert.equal(applied.status, 'applied');
	assert.equal(applied.offsetMilliseconds, 12.5);
	for (const member of NATIVE_AUDIO_CALIBRATION_MEMBERS) {
		if (member === 'inputDeviceId' || member === 'outputDeviceId') continue;
		const moved = member === 'mode'
			? identity({ mode: 'exclusive' })
			: member === 'backend'
				? identity({ backend: 'jack' })
				: identity({ [member]: IDENTITY[member] * 2 });
		assert.deepEqual(stale(store.resolve(moved)).changed, [member], `${member} must go stale`);
	}
});

test('a calibration for hardware that is no longer in play is absent, not stale', () => {
	const store = createStore();
	store.record(IDENTITY, 9);
	const elsewhere = identity({ inputDeviceId: 'native:jack:in:other', outputDeviceId: 'native:jack:out:other', backend: 'jack' });
	const resolution = store.resolve(elsewhere);
	assert.equal(resolution.status, 'absent');
	assert.equal(resolution.offsetMilliseconds, 0);
	// One shared endpoint is enough to make the old measurement worth naming.
	assert.deepEqual(stale(store.resolve(identity({ outputDeviceId: 'native:alsa:out:hw:1,0' }))).changed, ['outputDeviceId']);
});

test('the nearest entry is chosen by drift, then recency, then key', () => {
	const store = createStore();
	store.record(identity({ bufferFrames: 128, mode: 'exclusive' }), 5);
	store.record(identity({ bufferFrames: 512 }), 7);
	const nearest = stale(store.resolve(IDENTITY));
	assert.deepEqual(nearest.changed, ['bufferFrames'], 'the entry that moved by one member wins');
	const rival = createStore();
	rival.record(identity({ sampleRate: 44_100 }), 1);
	rival.record(identity({ bufferFrames: 512 }), 2);
	assert.deepEqual(stale(rival.resolve(IDENTITY)).changed, ['bufferFrames'], 'the most recent equal-distance entry wins');
});

test('offsets are clamped to the recording model and rubbish is refused', () => {
	const store = createStore();
	assert.equal(store.record(IDENTITY, 9_000).offsetMilliseconds, 500);
	assert.equal(store.record(IDENTITY, -9_000).offsetMilliseconds, -500);
	for (const rubbish of [Number.NaN, Number.POSITIVE_INFINITY, '12', null, undefined]) {
		assert.throws(() => store.record(IDENTITY, rubbish), /finite/u);
	}
});

test('a snapshot round trips, drops unreadable rows and stays ordered', () => {
	const store = createStore();
	store.record(identity({ bufferFrames: 512 }), 4);
	store.record(IDENTITY, 6);
	const snapshot = store.snapshot();
	assert.deepEqual([...snapshot].map((entry) => entry.key).sort(), snapshot.map((entry) => entry.key));
	const restored = createStore([
		...snapshot,
		{ identity: { ...IDENTITY, mode: 'hog' }, offsetMilliseconds: 3 },
		{ identity: IDENTITY, offsetMilliseconds: 'later' },
		'not an entry',
	]);
	assert.equal(restored.snapshot().length, 2, 'malformed persisted rows are dropped, never applied');
	const resolution = restored.resolve(IDENTITY);
	assert.equal(resolution.status, 'applied');
	assert.equal(resolution.offsetMilliseconds, 6);
	assert.equal(restored.forget(IDENTITY), true);
	assert.equal(restored.forget(IDENTITY), false);
	assert.equal(restored.resolve(IDENTITY).status, 'stale');
});

test('the store is bounded and evicts the oldest measurement', () => {
	const store = createStore();
	const limit = NATIVE_AUDIO_CALIBRATION_LIMITS.maximumEntries;
	for (let index = 0; index < limit + 4; index += 1) store.record(identity({ bufferFrames: index + 1 }), index);
	const snapshot = store.snapshot();
	assert.equal(snapshot.length, limit);
	assert.equal(store.resolve(identity({ bufferFrames: 1 })).status, 'stale', 'the first measurement was evicted');
	assert.equal(store.resolve(identity({ bufferFrames: limit + 4 })).status, 'applied');
});

test('a persisted store restored past its bound is trimmed on the way in', () => {
	const limit = NATIVE_AUDIO_CALIBRATION_LIMITS.maximumEntries;
	const entries = Array.from({ length: limit + 3 }, (_unused, index) => ({
		identity: identity({ bufferFrames: index + 1 }),
		offsetMilliseconds: 1,
		measuredAtEpochMs: index + 1,
	}));
	assert.equal(createStore(entries).snapshot().length, limit);
});

test('an applied offset lands in the existing routing offsets and a stale one changes nothing', () => {
	const store = createStore();
	store.record(IDENTITY, 21);
	const routing = normalizeRecordingRouting() as RecordingRoutingLike;
	const sourceKey = nativeAudioCalibrationSourceKey(IDENTITY);
	assert.equal(sourceKey, recordingRouteSourceKey({ kind: 'device', deviceId: INPUT }));
	assert.equal(sourceKey, `device:${INPUT}`);
	const applied = applyNativeAudioCalibration(routing, IDENTITY, store);
	assert.equal(applied.resolution.status, 'applied');
	assert.equal(applied.routing.offsets[sourceKey], 21);
	assert.equal(routing.offsets[sourceKey], undefined, 'the original routing is left alone');
	const moved = applyNativeAudioCalibration(routing, identity({ sampleRate: 44_100 }), store);
	assert.equal(moved.resolution.status, 'stale');
	assert.equal(moved.routing, routing, 'a stale calibration must leave the routing identical');
	const absent = applyNativeAudioCalibration(routing, identity({
		inputDeviceId: 'native:jack:in:other', outputDeviceId: '', backend: 'jack',
	}), store);
	assert.equal(absent.resolution.status, 'absent');
	assert.equal(absent.routing, routing);
});

test('an output-only session has no recording source to calibrate', () => {
	const store = createStore();
	const outputOnly = identity({ inputDeviceId: '' });
	assert.throws(() => nativeAudioCalibrationSourceKey(outputOnly), /input endpoint/u);
	assert.throws(() => applyNativeAudioCalibration(normalizeRecordingRouting() as RecordingRoutingLike, outputOnly, store),
		/recording input source/u);
});

test('store options are validated before any measurement is trusted', () => {
	assert.throws(() => createNativeAudioCalibrationStore(null as unknown as undefined), /options must be an object/u);
	assert.throws(() => createNativeAudioCalibrationStore([] as unknown as undefined), /options must be an object/u);
	assert.equal(createNativeAudioCalibrationStore().snapshot().length, 0);
	const wallClock = createNativeAudioCalibrationStore();
	assert.ok(wallClock.record(IDENTITY, 1).measuredAtEpochMs > 0, 'the default clock is the wall clock');
});
