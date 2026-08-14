/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	classifyAudioTrackFreezeFreshnessV1,
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	normalizeOptionalAudioTrackFreezeV1,
	sameAudioTrackFreezeV1,
	type AudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import {
	commitAudioTrackFreezeCandidateV21,
	installAudioTrackFreezeCandidateV21,
	removeAudioTrackFreezeCandidateV21,
} from '../src/common/editor/audio-track-freeze-lifecycle-v21.ts';
import { createDefaultMixerGraphV21, normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const SHA_C = 'c'.repeat(64);
const SHA_D = 'd'.repeat(64);
const SOURCE_CONTENT_IDENTITIES = Object.freeze([
	Object.freeze({ sourceId: 'source-a', contentSha256: SHA_A }),
	Object.freeze({ sourceId: 'source-b', contentSha256: SHA_B }),
]);

test('normalizes the exact freeze record into detached recursively frozen state', () => {
	const input = freezeRecord({ renderStartFrame: 2, renderFrameCount: 98 });
	const normalized = normalizeAudioTrackFreezeV1(input);
	assert.deepEqual(normalized, input);
	assert.notEqual(normalized, input);
	assert.ok(Object.isFrozen(normalized));
	assert.equal(normalizeAudioTrackFreezeV1(normalized), normalized);
	assert.equal(normalizeOptionalAudioTrackFreezeV1(undefined), undefined);
	assert.equal(sameAudioTrackFreezeV1(input, normalized), true);
	assert.equal(sameAudioTrackFreezeV1(input, freezeRecord({ rackDigestSha256: SHA_D })), false);
});

test('rejects noncanonical, open, accessor-backed, symbolic, and invalid freeze records', () => {
	const cases: unknown[] = [
		null,
		{ ...freezeRecord(), extra: true },
		{ ...freezeRecord(), schemaVersion: 2 },
		{ ...freezeRecord(), derivedSourceId: '' },
		{ ...freezeRecord(), inputDigestSha256: 'A'.repeat(64) },
		{ ...freezeRecord(), rackDigestSha256: 'a'.repeat(63) },
		{ ...freezeRecord(), renderStartFrame: -0 },
		{ ...freezeRecord(), renderFrameCount: 0 },
		{ ...freezeRecord(), renderStartFrame: Number.MAX_SAFE_INTEGER, renderFrameCount: 1 },
		{ ...freezeRecord(), capturePosition: 'post-fader' },
		Object.assign(Object.create({ inherited: true }), freezeRecord()),
		Object.assign({ ...freezeRecord() }, { [Symbol('hidden')]: true }),
	];
	for (const candidate of cases) assert.throws(() => normalizeAudioTrackFreezeV1(candidate));
	let reads = 0;
	const hostile = { ...freezeRecord() } as Record<string, unknown>;
	Object.defineProperty(hostile, 'derivedSourceId', {
		enumerable: true,
		get() { reads += 1; return 'derived'; },
	});
	assert.throws(() => normalizeAudioTrackFreezeV1(hostile), /data property|own data/iu);
	assert.equal(reads, 0);
});

test('computes deterministic component digests over exact freeze-boundary authority', () => {
	const input = digestInput();
	const first = computeAudioTrackFreezeDigestsV1(input);
	const second = computeAudioTrackFreezeDigestsV1({
		...input,
		clips: [...input.clips].reverse(),
		automationLanes: [...input.automationLanes],
	});
	assert.deepEqual(first, {
		inputDigestSha256: '39923ec62a5e7dd587d4037c83ff6f0153089623fc258273f2382fdf715f98a5',
		rackDigestSha256: '171ab8200b1bd557f4c1743a8230c96387b95e86e534196491422dfa512c4bd6',
		automationDigestSha256: '18813c511f3088e86dbf6987c469532731060883c86f7f2d9eec2f487a0e6ec6',
		freshnessDigestSha256: 'b1546e828dff7ac41ec83290f5937214c691059e196abe1fc8c3c673e1687951',
	});
	assert.deepEqual(first, second);
	for (const digest of Object.values(first)) assert.match(digest, /^[a-f0-9]{64}$/u);
	assert.ok(Object.isFrozen(first));

	const stripOnly = computeAudioTrackFreezeDigestsV1({
		...input,
		track: { ...input.track, gain: 0.25, pan: 0.8, mute: true, solo: true },
	});
	assert.deepEqual(stripOnly, first, 'live strip controls are outside the freeze boundary');

	const changedClip = computeAudioTrackFreezeDigestsV1({
		...input,
		clips: input.clips.map((clip) => clip.id === 'clip-a' ? { ...clip, gain: 0.75 } : clip),
	});
	assert.notEqual(changedClip.inputDigestSha256, first.inputDigestSha256);
	assert.equal(changedClip.rackDigestSha256, first.rackDigestSha256);
	assert.equal(changedClip.automationDigestSha256, first.automationDigestSha256);
	assert.notEqual(changedClip.freshnessDigestSha256, first.freshnessDigestSha256);

	const changedSource = computeAudioTrackFreezeDigestsV1({
		...input,
		sourceContentIdentities: [
			{ sourceId: 'source-a', contentSha256: SHA_D },
			{ sourceId: 'source-b', contentSha256: SHA_B },
		],
	});
	assert.notEqual(changedSource.inputDigestSha256, first.inputDigestSha256);
	const changedRange = computeAudioTrackFreezeDigestsV1({
		...input,
		renderFrameCount: 1_025,
	});
	assert.notEqual(changedRange.inputDigestSha256, first.inputDigestSha256);
	assert.equal(changedRange.rackDigestSha256, first.rackDigestSha256);
	assert.equal(changedRange.automationDigestSha256, first.automationDigestSha256);
	assert.notEqual(changedRange.freshnessDigestSha256, first.freshnessDigestSha256);

	const changedRack = computeAudioTrackFreezeDigestsV1({
		...input,
		track: {
			...input.track,
			effects: input.track.effects.map((effect) => ({
				...effect,
				params: { ...effect.params, lookahead: 25 },
			})),
		},
	});
	assert.notEqual(changedRack.rackDigestSha256, first.rackDigestSha256);
	assert.equal(changedRack.inputDigestSha256, first.inputDigestSha256);

	const changedAutomation = computeAudioTrackFreezeDigestsV1({
		...input,
		automationLanes: input.automationLanes.map((lane) => lane.id === 'lane-effect'
			? { ...lane, points: [{ ...lane.points[0], value: 0.75 }] }
			: lane),
	});
	assert.notEqual(changedAutomation.automationDigestSha256, first.automationDigestSha256);

	const changedStripAutomation = computeAudioTrackFreezeDigestsV1({
		...input,
		automationLanes: input.automationLanes.map((lane) => lane.id === 'lane-strip'
			? { ...lane, points: [{ ...lane.points[0], value: 0.1 }] }
			: lane),
	});
	assert.deepEqual(changedStripAutomation, first);
});

test('digest admission rejects empty, ambiguous, malformed, and hostile snapshots', () => {
	const input = digestInput();
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		track: { ...input.track, clipIds: [] },
	}), /empty|clip/iu);
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		sourceContentIdentities: input.sourceContentIdentities.slice(0, 1),
	}), /source-b/iu);
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		sourceContentIdentities: [...input.sourceContentIdentities, input.sourceContentIdentities[0]],
	}), /duplicate/iu);
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		sourceContentIdentities: [...input.sourceContentIdentities, { sourceId: 'unused', contentSha256: SHA_D }],
	}), /unused|exact/iu);
	const sparse = [...input.clips];
	delete sparse[0];
	assert.throws(() => computeAudioTrackFreezeDigestsV1({ ...input, clips: sparse }));
	const cyclic = { ...input.clips[0] } as Record<string, unknown>;
	cyclic.opaqueExtensions = cyclic;
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		clips: [cyclic, input.clips[1]],
	}), /cyclic/iu);
	let reads = 0;
	const hostile = { ...input.clips[0] } as Record<string, unknown>;
	Object.defineProperty(hostile, 'gain', {
		enumerable: true,
		get() { reads += 1; return 1; },
	});
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...input,
		clips: [hostile, input.clips[1]],
	}), /data/iu);
	assert.equal(reads, 0);
});

test('classifies unfrozen, fresh, and component-specific stale observations', () => {
	const digests = computeAudioTrackFreezeDigestsV1(digestInput());
	const freeze = freezeRecord({ ...digests });
	assert.deepEqual(classifyAudioTrackFreezeFreshnessV1(undefined, digests), {
		status: 'unfrozen',
		changedComponents: [],
	});
	assert.deepEqual(classifyAudioTrackFreezeFreshnessV1(freeze, digests), {
		status: 'fresh',
		changedComponents: [],
	});
	const changed = { ...digests, rackDigestSha256: SHA_D, freshnessDigestSha256: SHA_C };
	assert.deepEqual(classifyAudioTrackFreezeFreshnessV1(freeze, changed), {
		status: 'stale',
		changedComponents: ['rack', 'freshness'],
	});
});

test('install and refresh use exact expected-state CAS without mutating editable authority', () => {
	const { project, freeze, derivedSource } = lifecycleFixture();
	const installed = installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a',
		expectedFreeze: null,
		replacementFreeze: freeze,
		derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	const installedTrack = trackById(installed, 'track-a');
	assert.deepEqual(installedTrack.audioFreeze, freeze);
	assert.deepEqual(installedTrack.clipIds, ['clip-a', 'clip-b']);
	assert.deepEqual(installedTrack.effects, trackById(project, 'track-a').effects);
	assert.equal(installedTrack.gain, 0.8);
	assert.equal((installed.sources as readonly Record<string, unknown>[]).at(-1)?.id, 'derived-a');
	assert.equal(Object.hasOwn(trackById(project, 'track-a'), 'audioFreeze'), false);
	assert.ok(Object.isFrozen(installed));
	assert.ok(Object.isFrozen(installedTrack));

	assert.throws(() => installAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	}), /changed|expected/iu);

	const refreshedFreeze = freezeRecord({
		...freeze,
		derivedSourceId: 'derived-b',
		freshnessDigestSha256: SHA_D,
	});
	const refreshed = installAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a',
		expectedFreeze: freeze,
		replacementFreeze: refreshedFreeze,
		derivedSource: { ...derivedSource, id: 'derived-b', storageKey: 'derived:derived-b', contentSha256: SHA_D },
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	assert.equal(
		normalizeAudioTrackFreezeV1(trackById(refreshed, 'track-a').audioFreeze).derivedSourceId,
		'derived-b',
	);
	assert.deepEqual((refreshed.sources as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'source-a', 'source-b', 'derived-b',
	]);
});

test('remove returns to retained live state and retires only the unreferenced derived descriptor', () => {
	const { project, freeze, derivedSource } = lifecycleFixture();
	const installed = installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	const removed = removeAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a', expectedFreeze: freeze,
	});
	const track = trackById(removed, 'track-a');
	assert.equal(Object.hasOwn(track, 'audioFreeze'), false);
	assert.deepEqual(track.clipIds, ['clip-a', 'clip-b']);
	assert.equal((track.effects as readonly unknown[]).length, 1);
	assert.equal((removed.sources as readonly Record<string, unknown>[]).some(({ id }) => id === 'derived-a'), false);
	assert.throws(() => removeAudioTrackFreezeCandidateV21(removed, {
		trackId: 'track-a', expectedFreeze: freeze,
	}), /changed|expected/iu);
});

test('commit requires fresh verified state and performs only the freeze-boundary bake', () => {
	const { project, freeze, derivedSource, digests } = lifecycleFixture();
	const installed = installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	const committed = commitAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a',
		expectedFreeze: freeze,
		operationDigests: digests,
		derivedSourceContentSha256: SHA_C,
		derivedClip: derivedClip(),
	});
	const before = trackById(installed, 'track-a');
	const after = trackById(committed, 'track-a');
	for (const field of ['id', 'name', 'gain', 'pan', 'mute', 'solo', 'armed', 'laneGroupId', 'folderBusId']) {
		assert.equal(after[field], before[field], `commit retains track.${field}`);
	}
	assert.deepEqual(after.clipIds, ['clip-derived']);
	assert.deepEqual(after.effects, []);
	assert.equal(after.effectsActive, true);
	assert.equal(Object.hasOwn(after, 'audioFreeze'), false);
	assert.deepEqual((committed.clips as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'clip-other', 'clip-derived',
	]);
	assert.deepEqual((committed.sources as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'source-b', 'derived-a',
	]);
	assert.deepEqual((committed.automationLanes as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'lane-strip', 'lane-other-track',
	]);
	assert.equal(committed.mixer, installed.mixer, 'downstream routing remains live and exact');
	assert.deepEqual(trackById(installed, 'track-a').clipIds, ['clip-a', 'clip-b']);
	assert.equal((installed.clips as readonly unknown[]).length, 3);
	assert.ok(Object.isFrozen(committed.clips));
	assert.ok(Object.isFrozen(committed.automationLanes));
});

test('commit retires only sidechain edges targeting the removed rack', () => {
	const { project, freeze, derivedSource, digests } = lifecycleFixture();
	const installed = installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	const graph = createDefaultMixerGraphV21([{ id: 'track-a' }, { id: 'track-b' }]);
	const routed = {
		...installed,
		mixer: normalizeMixerGraphV21({
			...graph,
			edges: [...graph.edges, sidechain('sidechain-to-baked-rack', 'track-a', 'fx-a'),
				sidechain('sidechain-to-other-rack', 'track-b', 'fx-b')],
		}),
	};
	const committed = commitAudioTrackFreezeCandidateV21(routed, {
		trackId: 'track-a', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: SHA_C, derivedClip: derivedClip(),
	});
	const mixer = normalizeMixerGraphV21(committed.mixer);
	assert.equal(mixer.edges.some(({ id }) => id === 'sidechain-to-baked-rack'), false);
	assert.equal(mixer.edges.some(({ id }) => id === 'sidechain-to-other-rack'), true);
	assert.deepEqual(
		mixer.edges.filter(({ kind }) => kind === 'assignment'),
		graph.edges.filter(({ kind }) => kind === 'assignment'),
	);
});

test('lifecycle candidates reject stale admissions, descriptor mismatch, collisions, and document payloads', () => {
	const { project, freeze, derivedSource, digests } = lifecycleFixture();
	assert.throws(() => installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze,
		derivedSource: { ...derivedSource, pcm: [0, 1] },
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	}), /PCM|payload|descriptor/iu);
	assert.throws(() => installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze,
		derivedSource: { ...derivedSource, opaqueExtensions: { payload: 'AAAA' } },
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	}), /PCM|payload|descriptor/iu);
	assert.throws(() => installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze,
		derivedSource: { ...derivedSource, id: 'source-a' },
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	}), /match|collision/iu);
	const installed = installAudioTrackFreezeCandidateV21(project, {
		trackId: 'track-a', expectedFreeze: null, replacementFreeze: freeze, derivedSource,
		sourceContentIdentities: SOURCE_CONTENT_IDENTITIES,
	});
	assert.throws(() => commitAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a', expectedFreeze: freeze,
		operationDigests: { ...digests, inputDigestSha256: SHA_D },
		derivedSourceContentSha256: SHA_C,
		derivedClip: derivedClip(),
	}), /stale|digest/iu);
	assert.throws(() => commitAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: SHA_D,
		derivedClip: derivedClip(),
	}), /content|digest/iu);
	assert.throws(() => commitAudioTrackFreezeCandidateV21(installed, {
		trackId: 'track-a', expectedFreeze: freeze, operationDigests: digests,
		derivedSourceContentSha256: SHA_C,
		derivedClip: { ...derivedClip(), timelineStartFrame: 1 },
	}), /range|start/iu);
});

test('rack automation digests are ordered by parameter address, not document position', () => {
	const effects = [
		{ id: 'fx-a', type: 'limiter', enabled: true, params: { threshold: -1, lookahead: 10 } },
		{ id: 'fx-b', type: 'highpass', enabled: true, params: { frequency: 200 } },
	];
	const rackLane = (id: string, effectId: string, parameterId: string) => ({
		id,
		address: { kind: 'effect', strip: { kind: 'track', id: 'track-a' }, effectId, parameterId },
		timebase: 'absolute-samples',
		points: [{ id: `${id}-p`, position: 0, value: 1 }],
		segments: [],
	});
	const first = rackLane('lane-1', 'fx-a', 'ceiling');
	const second = rackLane('lane-2', 'fx-b', 'frequency');
	const base = { ...digestInput(), track: { ...digestInput().track, effects } };
	const ordered = computeAudioTrackFreezeDigestsV1({ ...base, automationLanes: [first, second] });
	const reordered = computeAudioTrackFreezeDigestsV1({ ...base, automationLanes: [second, first] });

	// Editing a lane moves it to the end of the document array, which must not make an
	// otherwise untouched freeze look stale.
	assert.equal(reordered.automationDigestSha256, ordered.automationDigestSha256);
	assert.equal(reordered.freshnessDigestSha256, ordered.freshnessDigestSha256);

	// Content still moves the digest, and a duplicated address is refused outright.
	const changed = computeAudioTrackFreezeDigestsV1({
		...base,
		automationLanes: [{ ...first, points: [{ id: 'lane-1-p', position: 0, value: 0.5 }] }, second],
	});
	assert.notEqual(changed.automationDigestSha256, ordered.automationDigestSha256);
	assert.throws(() => computeAudioTrackFreezeDigestsV1({
		...base,
		automationLanes: [first, { ...first, id: 'lane-3' }],
	}), /duplicate address/iu);
});

function digestInput() {
	const effects = [{
		id: 'fx-a',
		type: 'limiter',
		enabled: true,
		params: { threshold: -1, lookahead: 10 },
	}];
	return {
		sampleRate: 48_000,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		track: {
			type: 'audio', id: 'track-a', clipIds: ['clip-a', 'clip-b'],
			gain: 1, pan: 0, mute: false, solo: false,
			effectsActive: true, effects,
		},
		clips: [
			{
				id: 'clip-a', kind: 'audio', sourceId: 'source-a', timelineStartFrame: 0,
				sourceStartFrame: 4, sourceDurationFrames: 400, durationFrames: 400,
				gain: 1, fadeInFrames: 2, fadeOutFrames: 3, envelope: [],
				opaqueExtensions: {},
			},
			{
				id: 'clip-b', kind: 'audio', sourceId: 'source-b', timelineStartFrame: 500,
				sourceStartFrame: 0, sourceDurationFrames: 200, durationFrames: 200,
				gain: 1, fadeInFrames: 0, fadeOutFrames: 0, envelope: [],
				opaqueExtensions: {},
			},
		],
		sourceContentIdentities: [
			{ sourceId: 'source-a', contentSha256: SHA_A },
			{ sourceId: 'source-b', contentSha256: SHA_B },
		],
		automationLanes: [
			lane('lane-effect', {
				kind: 'effect', strip: { kind: 'track', id: 'track-a' },
				effectId: 'fx-a', parameterId: 'threshold',
			}),
			lane('lane-strip', {
				kind: 'strip', strip: { kind: 'track', id: 'track-a' }, parameterId: 'gain',
			}),
			lane('lane-unrelated-effect', {
				kind: 'effect', strip: { kind: 'track', id: 'track-a' },
				effectId: 'not-in-rack', parameterId: 'amount',
			}),
		],
	};
}

function lane(id: string, address: Readonly<Record<string, unknown>>) {
	return {
		id,
		address,
		timebase: 'absolute-samples',
		points: [{ id: `${id}-point`, position: 0, value: 0.5 }],
		segments: [],
	};
}

function freezeRecord(overrides: Partial<AudioTrackFreezeV1> = {}): AudioTrackFreezeV1 {
	return {
		schemaVersion: 1,
		derivedSourceId: 'derived-a',
		inputDigestSha256: SHA_A,
		rackDigestSha256: SHA_B,
		automationDigestSha256: SHA_C,
		freshnessDigestSha256: SHA_A,
		renderStartFrame: 0,
		renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
		...overrides,
	};
}

function lifecycleFixture(): {
	project: Readonly<Record<string, unknown>>;
	freeze: AudioTrackFreezeV1;
	derivedSource: Readonly<Record<string, unknown>>;
	digests: AudioTrackFreezeDigestsV1;
} {
	const input = digestInput();
	const digests = computeAudioTrackFreezeDigestsV1(input);
	const freeze = freezeRecord({ ...digests });
	const derivedSource = {
		id: 'derived-a', kind: 'audio', name: 'Frozen Track A', mimeType: 'audio/wav',
		storageKey: 'derived:derived-a', contentSha256: SHA_C,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000,
		originalSampleRate: 48_000, sampleFormat: 'float32', chunkFrames: 65_536,
		opaqueExtensions: {},
	};
	return {
		freeze,
		derivedSource,
		digests,
		project: {
			schemaVersion: 21,
			sampleRate: 48_000,
			tracks: [
				{
					...input.track,
					gain: 0.8,
					name: 'Track A', armed: false, laneGroupId: 'folder-a', folderBusId: 'bus-a',
					displayMode: 'waveform', color: '#fff', collapsed: false, height: 160,
					opaqueExtensions: {},
				},
				{
					type: 'audio', id: 'track-b', name: 'Track B', clipIds: ['clip-other'],
					gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [],
				},
			],
			clips: [
				...input.clips,
				{
					id: 'clip-other', kind: 'audio', sourceId: 'source-b', timelineStartFrame: 800,
					sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100,
				},
			],
			sources: [
				{ id: 'source-a', kind: 'audio', storageKey: 'pcm:a' },
				{ id: 'source-b', kind: 'audio', storageKey: 'pcm:b' },
			],
			automationLanes: [
				...input.automationLanes.filter(({ id }) => id !== 'lane-unrelated-effect'),
				lane('lane-other-track', {
					kind: 'effect', strip: { kind: 'track', id: 'track-b' },
					effectId: 'fx-b', parameterId: 'amount',
				}),
			],
			mixer: { schemaVersion: 1, sentinel: 'routing-retained' },
		},
	};
}

function derivedClip(): Readonly<Record<string, unknown>> {
	return {
		id: 'clip-derived', kind: 'audio', sourceId: 'derived-a', title: 'Track A (committed)',
		anchor: 'sample', musicalStartBeat: null, musicalExtent: 'fixedSamples', musicalDurationBeats: null,
		timelineStartFrame: 0, durationFrames: 1_024,
		sourceStartFrame: 0, sourceDurationFrames: 1_024,
		trimStartFrames: 0, trimEndFrames: 0,
		gain: 1, fadeInFrames: 0, fadeOutFrames: 0, reversed: false, envelope: [],
		groupId: null, avLinkId: null, binItemId: null, color: 'auto',
		pitchCents: 0, speedRatio: 1, preserveFormants: false, stretchToTempo: false,
		renderCacheRevision: 0, warpMap: { schemaVersion: 1, kind: 'audio-warp', points: [] },
		opaqueExtensions: {},
	};
}

function sidechain(id: string, targetTrackId: string, effectId: string) {
	return {
		id, kind: 'sidechain', source: { kind: 'track', id: 'track-b' },
		destination: {
			kind: 'effect-sidechain', strip: { kind: 'track', id: targetTrackId }, effectId,
		},
		position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1],
	};
}

function trackById(project: Readonly<Record<string, unknown>>, id: string): Record<string, unknown> {
	const tracks = project.tracks as readonly Record<string, unknown>[];
	const track = tracks.find((candidate) => candidate.id === id);
	assert.ok(track);
	return track;
}
