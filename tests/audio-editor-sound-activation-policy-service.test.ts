/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createSoundActivationPolicyService,
	type SoundActivationPreferencePatch,
	type SoundActivationPolicyRecordingState,
	type SoundActivationPolicySnapshot,
} from '../src/common/editor/controller/sound-activation-policy-service.ts';
import {
	DEFAULT_SOUND_ACTIVATION_PREFERENCES,
	type SoundActivationPreferences,
} from '../src/common/editor/sound-activation-preferences.ts';
import type { RecordingSoundActivationSource } from '../src/common/editor/controller/recording-transaction-types.ts';

const DEVICE_SOURCE = Object.freeze({
	sourceKey: 'device:default',
	kind: 'device' as const,
	sampleRate: 48_000,
	channelCount: 2,
});

const DISPLAY_SOURCE = Object.freeze({
	sourceKey: 'display',
	kind: 'display' as const,
	sampleRate: 44_100,
	channelCount: 1,
});

const ENABLED_PREFERENCES: SoundActivationPreferences = Object.freeze({
	enabled: true,
	thresholdDb: -36,
	hysteresisDb: 4,
	holdMilliseconds: 125,
});

const RECORDER = Object.freeze({ stop() {} });

test('policy defaults disabled and exposes one deeply immutable canonical snapshot', () => {
	const fixture = createFixture();
	assert.equal(fixture.service.getSettings(DEVICE_SOURCE), null);
	const snapshot = fixture.service.getSnapshot();
	assert.deepEqual(snapshot, {
		preferences: DEFAULT_SOUND_ACTIVATION_PREFERENCES,
		preferenceMutationBlocked: false,
		preferenceMutationBlockReason: null,
		sources: [],
	});
	assert.equal(Object.isFrozen(snapshot), true);
	assert.equal(Object.isFrozen(snapshot.preferences), true);
	assert.equal(Object.isFrozen(snapshot.sources), true);
	assert.equal(fixture.publishes.length, 0);
});

test('settings are converted and frozen once per exact source session', () => {
	const fixture = createFixture({ preferences: ENABLED_PREFERENCES });
	const first = fixture.service.getSettings(DEVICE_SOURCE);
	assert.deepEqual(first, { thresholdDb: -36, hysteresisDb: 4, holdFrames: 6_000 });
	assert.equal(Object.isFrozen(first), true);

	fixture.replacePreferences({
		...ENABLED_PREFERENCES,
		thresholdDb: -18,
		holdMilliseconds: 250,
	});
	assert.equal(fixture.service.getSettings({ ...DEVICE_SOURCE }), first);
	assert.deepEqual(fixture.service.getSettings(DISPLAY_SOURCE), {
		thresholdDb: -18,
		hysteresisDb: 4,
		holdFrames: 11_025,
	});
	assert.equal(fixture.service.discardSource(DEVICE_SOURCE.sourceKey), true);
	const nextSession = fixture.service.getSettings(DEVICE_SOURCE);
	assert.notEqual(nextSession, first);
	assert.deepEqual(nextSession, { thresholdDb: -18, hysteresisDb: 4, holdFrames: 12_000 });
});

test('source states remain independent while a shared source key has one canonical row', () => {
	const fixture = createFixture({ preferences: ENABLED_PREFERENCES });
	const deviceSettings = fixture.service.getSettings(DEVICE_SOURCE);
	assert.equal(fixture.service.getSettings({ ...DEVICE_SOURCE }), deviceSettings);
	fixture.service.getSettings(DISPLAY_SOURCE);

	fixture.service.setState(DEVICE_SOURCE, 'armed');
	fixture.service.setState(DISPLAY_SOURCE, 'capturing');
	fixture.service.setState({ ...DEVICE_SOURCE }, 'armed');
	const snapshot = fixture.service.getSnapshot();
	assert.deepEqual(snapshot.sources, [
		{
			sourceKey: 'device:default',
			kind: 'device',
			sampleRate: 48_000,
			channelCount: 2,
			settings: { thresholdDb: -36, hysteresisDb: 4, holdFrames: 6_000 },
			state: 'armed',
		},
		{
			sourceKey: 'display',
			kind: 'display',
			sampleRate: 44_100,
			channelCount: 1,
			settings: { thresholdDb: -36, hysteresisDb: 4, holdFrames: 5_513 },
			state: 'capturing',
		},
	]);
	assert.equal(Object.isFrozen(snapshot.sources[0]), true);
	assert.equal(Object.isFrozen(snapshot.sources[0]?.settings), true);
	assert.equal(fixture.publishes.length, 4, 'two registrations plus two changed states publish');

	assert.throws(() => fixture.service.getSettings({
		...DEVICE_SOURCE,
		channelCount: 1,
	}), /changed.*device:default/i);
	fixture.service.setState({ ...DEVICE_SOURCE, sourceKey: 'device:missing' }, 'armed');
	assert.equal(fixture.service.getSnapshot().sources.length, 2, 'late or unknown state cannot resurrect a source');
});

test('preference mutations write one complete global record and validate every field', async () => {
	const fixture = createFixture();
	assert.equal(await fixture.service.setEnabled(true), true);
	assert.equal(await fixture.service.setThresholdDb(-24.5), true);
	assert.equal(await fixture.service.setHysteresisDb(3.5), true);
	assert.equal(await fixture.service.setHoldMilliseconds(375), true);
	assert.deepEqual(fixture.preferences(), {
		enabled: true,
		thresholdDb: -24.5,
		hysteresisDb: 3.5,
		holdMilliseconds: 375,
	});
	assert.equal(fixture.updates.length, 4);
	for (const patch of fixture.updates) {
		assert.deepEqual(Reflect.ownKeys(patch), ['recording']);
		assert.deepEqual(Reflect.ownKeys(patch.recording), ['soundActivation']);
		assert.equal(Object.isFrozen(patch), true);
		assert.equal(Object.isFrozen(patch.recording), true);
		assert.equal(Object.isFrozen(patch.recording.soundActivation), true);
	}
	assert.equal(await fixture.service.setHoldMilliseconds(375), false, 'an equal value is a no-op');
	assert.equal(fixture.updates.length, 4);

	for (const operation of [
		() => fixture.service.setEnabled(1),
		() => fixture.service.setThresholdDb('20'),
		() => fixture.service.setThresholdDb(-0),
		() => fixture.service.setHysteresisDb(Number.NaN),
		() => fixture.service.setHysteresisDb(25),
		() => fixture.service.setHoldMilliseconds(1.5),
		() => fixture.service.setHoldMilliseconds(600_001),
	]) await assert.rejects(operation(), /sound activation/i);
	assert.equal(fixture.updates.length, 4);
});

test('preference mutations no-op throughout recording preparation, scheduling, capture, and finishing', async () => {
	const cases: readonly [string, Partial<SoundActivationPolicyRecordingState>, string][] = [
		['recording start', { recordingStarting: true }, 'recording-scheduling'],
		['start promise', { recordingStartPromise: Promise.resolve() }, 'recording-scheduling'],
		['timed preparation', { timedRecordingPreparing: true }, 'recording-scheduling'],
		['prepared timer', { timedRecording: { generation: 3 } }, 'recording-prepared'],
		['prepared recorder', { timedRecording: { generation: 3 }, recorder: RECORDER }, 'recording-prepared'],
		['active recorder', { recorder: RECORDER }, 'recording-active'],
		['finalization', { recorder: RECORDER, recordingFinishing: true }, 'recording-finishing'],
	];
	for (const [name, state, reason] of cases) {
		const fixture = createFixture({ state });
		assert.equal(await fixture.service.setEnabled(true), false, name);
		assert.equal(fixture.updates.length, 0, name);
		assert.deepEqual(fixture.preferences(), DEFAULT_SOUND_ACTIVATION_PREFERENCES, name);
		assert.equal(fixture.service.getSnapshot().preferenceMutationBlocked, true, name);
		assert.equal(fixture.service.getSnapshot().preferenceMutationBlockReason, reason, name);
	}
});

test('a failed or concurrent preference update never commits partial policy state', async () => {
	let resolveUpdate: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => { resolveUpdate = resolve; });
	const fixture = createFixture({
		update: async (patch, commit) => {
			await pending;
			commit(patch.recording.soundActivation);
		},
	});
	const first = fixture.service.setEnabled(true);
	assert.equal(fixture.service.getSnapshot().preferenceMutationBlockReason, 'preference-update');
	assert.equal(await fixture.service.setThresholdDb(-20), false);
	assert.equal(fixture.updates.length, 1);
	resolveUpdate?.();
	assert.equal(await first, true);
	assert.deepEqual(fixture.preferences(), { ...DEFAULT_SOUND_ACTIVATION_PREFERENCES, enabled: true });

	const failure = new Error('storage refused');
	fixture.setUpdate(async () => { throw failure; });
	await assert.rejects(fixture.service.setThresholdDb(-20), failure);
	assert.deepEqual(fixture.preferences(), { ...DEFAULT_SOUND_ACTIVATION_PREFERENCES, enabled: true });
	assert.equal(fixture.service.getSnapshot().preferenceMutationBlocked, false);
});

test('preference updates publish both pending and settled policy snapshots', async () => {
	let resolveUpdate: (() => void) | undefined;
	const pending = new Promise<void>((resolve) => { resolveUpdate = resolve; });
	const fixture = createFixture({
		update: async (patch, commit) => {
			await pending;
			commit(patch.recording.soundActivation);
		},
	});
	const operation = fixture.service.setEnabled(true);
	assert.deepEqual(fixture.publishedSnapshots.map((snapshot) => ({
		enabled: snapshot.preferences.enabled,
		blocked: snapshot.preferenceMutationBlocked,
		reason: snapshot.preferenceMutationBlockReason,
	})), [{
		enabled: false,
		blocked: true,
		reason: 'preference-update',
	}]);

	resolveUpdate?.();
	assert.equal(await operation, true);
	assert.deepEqual(fixture.publishedSnapshots.map((snapshot) => ({
		enabled: snapshot.preferences.enabled,
		blocked: snapshot.preferenceMutationBlocked,
		reason: snapshot.preferenceMutationBlockReason,
	})), [
		{ enabled: false, blocked: true, reason: 'preference-update' },
		{ enabled: true, blocked: false, reason: null },
	]);

	fixture.setUpdate(async () => { throw new Error('storage refused'); });
	await assert.rejects(fixture.service.setThresholdDb(-20), /storage refused/);
	assert.deepEqual(fixture.publishedSnapshots.slice(-2).map((snapshot) => (
		snapshot.preferenceMutationBlockReason
	)), ['preference-update', null]);
});

test('pending policy snapshots retain the last committed preference record', async () => {
	let settleUpdate = (): void => undefined;
	const pending = new Promise<void>((resolve) => { settleUpdate = resolve; });
	const fixture = createFixture({
		update: async (patch, commit) => {
			commit(patch.recording.soundActivation);
			await pending;
			commit(DEFAULT_SOUND_ACTIVATION_PREFERENCES);
			throw new Error('durable storage refused');
		},
	});

	const operation = fixture.service.setEnabled(true);
	assert.deepEqual(fixture.service.getSnapshot().preferences, DEFAULT_SOUND_ACTIVATION_PREFERENCES);
	assert.equal(fixture.service.getSnapshot().preferenceMutationBlockReason, 'preference-update');
	assert.equal(fixture.service.getSettings(DEVICE_SOURCE), null);
	settleUpdate();
	await assert.rejects(operation, /durable storage refused/u);
	assert.deepEqual(fixture.service.getSnapshot().preferences, DEFAULT_SOUND_ACTIVATION_PREFERENCES);
});

test('terminal cancellation, explicit discard, and reset remove stale source sessions exactly once', () => {
	const fixture = createFixture({ preferences: ENABLED_PREFERENCES });
	fixture.service.getSettings(DEVICE_SOURCE);
	fixture.service.getSettings(DISPLAY_SOURCE);
	assert.equal(fixture.service.discardSource('missing'), false);
	fixture.service.setState(DISPLAY_SOURCE, 'cancelled');
	assert.equal(fixture.service.discardSource(DISPLAY_SOURCE.sourceKey), false);
	assert.deepEqual(fixture.service.getSnapshot().sources.map(({ sourceKey }) => sourceKey), ['device:default']);
	assert.equal(fixture.service.resetSources(), true);
	assert.equal(fixture.service.resetSources(), false);
	assert.deepEqual(fixture.service.getSnapshot().sources, []);
	assert.equal(fixture.publishes.length, 4, 'register, register, discard, and reset publish');
	for (const sourceKey of ['', '   ', 2, null, Symbol('source')]) {
		assert.throws(() => fixture.service.discardSource(sourceKey), /source key/i);
	}
});

test('hostile sources, gate states, and preference providers fail closed without side effects', () => {
	const fixture = createFixture({ preferences: ENABLED_PREFERENCES });
	const accessor = { ...DEVICE_SOURCE } as Record<string, unknown>;
	let getterCalls = 0;
	Object.defineProperty(accessor, 'sampleRate', {
		enumerable: true,
		get() { getterCalls += 1; return 48_000; },
	});
	const inherited = Object.assign(Object.create({ hostile: true }) as Record<string, unknown>, DEVICE_SOURCE);
	for (const source of [
		null,
		[],
		accessor,
		inherited,
		{ ...DEVICE_SOURCE, [Symbol('field')]: true },
		{ ...DEVICE_SOURCE, unknown: true },
		{ ...DEVICE_SOURCE, sourceKey: '' },
		{ ...DEVICE_SOURCE, kind: 'microphone' },
		{ ...DEVICE_SOURCE, sampleRate: 44_100.5 },
		{ ...DEVICE_SOURCE, sampleRate: 384_001 },
		{ ...DEVICE_SOURCE, channelCount: 0 },
	]) assert.throws(
		() => fixture.service.getSettings(source as unknown as RecordingSoundActivationSource),
		/sound activation.*source|source.*sound activation/i,
	);
	assert.equal(getterCalls, 0);
	assert.equal(fixture.publishes.length, 0);
	assert.deepEqual(fixture.service.getSnapshot().sources, []);

	fixture.service.getSettings(DEVICE_SOURCE);
	for (const state of ['', 'recording', null, {}, Symbol('state')]) {
		assert.throws(
			() => fixture.service.setState(DEVICE_SOURCE, state as never),
			/gate state/i,
		);
	}
	assert.equal(fixture.service.getSnapshot().sources[0]?.state, 'disarmed');

	const invalidPreferences = createFixture({ preferences: ENABLED_PREFERENCES });
	invalidPreferences.replacePreferences({ ...ENABLED_PREFERENCES, thresholdDb: Number.NaN });
	assert.throws(() => invalidPreferences.service.getSnapshot(), /sound activation/i);
	assert.throws(() => invalidPreferences.service.getSettings(DEVICE_SOURCE), /sound activation/i);
});

interface FixtureOptions {
	readonly preferences?: SoundActivationPreferences;
	readonly state?: Partial<SoundActivationPolicyRecordingState>;
	readonly update?: UpdateImplementation;
}

type UpdateImplementation = (
	patch: SoundActivationPreferencePatch,
	commit: (preferences: SoundActivationPreferences) => void,
) => Promise<void>;

function createFixture(options: FixtureOptions = {}) {
	let preferences: unknown = options.preferences ?? DEFAULT_SOUND_ACTIVATION_PREFERENCES;
	let update = options.update;
	const state: SoundActivationPolicyRecordingState = {
		recordingStarting: false,
		recordingStartPromise: null,
		timedRecordingPreparing: false,
		timedRecording: null,
		recorder: null,
		recordingFinishing: false,
		...options.state,
	};
	const updates: SoundActivationPreferencePatch[] = [];
	const publishes: number[] = [];
	const publishedSnapshots: SoundActivationPolicySnapshot[] = [];
	const commit = (next: SoundActivationPreferences) => { preferences = next; };
	const service = createSoundActivationPolicyService({
		state,
		getPreferences: () => preferences,
		updatePreferences: async (patch) => {
			updates.push(patch);
			if (update) await update(patch, commit);
			else commit(patch.recording.soundActivation);
		},
		publish: () => {
			publishes.push(publishes.length + 1);
			publishedSnapshots.push(service.getSnapshot());
		},
	});
	return {
		service,
		state,
		updates,
		publishes,
		publishedSnapshots,
		preferences: () => preferences,
		replacePreferences: (next: unknown) => { preferences = next; },
		setUpdate: (next: UpdateImplementation) => { update = next; },
	};
}
