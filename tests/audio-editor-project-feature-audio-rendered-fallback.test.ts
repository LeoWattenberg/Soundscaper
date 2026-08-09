/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioEditorProjectV10 } from '../src/common/editor/project-v10.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { createEffect } from '../src/common/editor/effects.js';
import {
	PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS,
	projectFeatureAudioRenderedFallbackPlayback,
} from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import {
	PROJECT_FEATURE_AUDIO_CAPABILITY_IDS,
	PROJECT_FEATURE_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClipV9,
	createAudioSourceV9,
	createAudioTrackV9,
} from '../src/common/editor/project-v9.ts';

const AUDIO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.audioEffects;
const DIGEST = 'ab'.repeat(32);

interface MutableFixture extends Record<string, unknown> {
	masterChannels: number;
	sources: Array<Record<string, unknown>>;
	tracks: Array<Record<string, unknown>>;
	metadata: Record<string, unknown>;
}

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'publisher-audio-render',
			featureId: AUDIO_EFFECTS,
			displayName: 'Publisher audio render',
			availability: 'unavailable',
			declaredDisposition: 'rendered-fallback',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1',
				kind: 'audio',
				sourceId: 'fallback-source',
				sha256: DIGEST,
			},
			message: 'Audio effects are unavailable.',
			...overrides,
		}],
	};
}

function project(featureId: string = AUDIO_EFFECTS) {
	const source = createAudioSourceV9({
		id: 'source-a',
		storageKey: 'source-a',
		frameCount: 8,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const fallback = createAudioSourceV9({
		id: 'fallback-source',
		storageKey: 'fallback-source',
		frameCount: 12,
		channelCount: 2,
		sampleRate: 48_000,
	});
	const clip = createAudioClipV9({
		id: 'clip-a',
		sourceId: source.id,
		durationFrames: 8,
		sourceDurationFrames: 8,
	});
	const track = createAudioTrackV9({
		id: 'track-a',
		clipIds: [clip.id],
		gain: 0.5,
		effects: [createEffect('compressor', { id: 'effect-a' })],
	});
	return createAudioEditorProjectV10({
		id: 'project-a',
		now: '2026-07-30T12:00:00.000Z',
		masterChannels: 2,
		sampleRate: 48_000,
		sources: [source, fallback],
		clips: [clip],
		tracks: [track],
		master: { gain: 0.75, effects: [createEffect('limiter', { id: 'master-effect' })] },
		mixer: {
			groups: [],
			sends: [],
			routes: { [track.id]: { groupId: null, sends: {} } },
		},
		featureRequirements: {
			schemaVersion: 1,
			requirements: [{
				id: 'publisher-audio-render',
				featureId,
				displayName: 'Publisher audio render',
				disposition: 'rendered-fallback',
				fallback: { kind: 'audio', sourceId: fallback.id, sha256: DIGEST },
			}],
		},
	});
}

test('every registered first-party audio capability can bind one whole-mix fallback', () => {
	assert.deepEqual(PROJECT_FEATURE_AUDIO_CAPABILITY_IDS, [
		PROJECT_FEATURE_CAPABILITY_IDS.audioImport,
		PROJECT_FEATURE_CAPABILITY_IDS.audioPlayback,
		PROJECT_FEATURE_CAPABILITY_IDS.audioTimelineEditing,
		PROJECT_FEATURE_CAPABILITY_IDS.audioMixing,
		PROJECT_FEATURE_CAPABILITY_IDS.audioRecording,
		PROJECT_FEATURE_CAPABILITY_IDS.audioGenerators,
		PROJECT_FEATURE_CAPABILITY_IDS.audioEffects,
		PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		PROJECT_FEATURE_CAPABILITY_IDS.audioAnalysis,
		PROJECT_FEATURE_CAPABILITY_IDS.audioMacros,
		PROJECT_FEATURE_CAPABILITY_IDS.audioSampleEditing,
		PROJECT_FEATURE_CAPABILITY_IDS.musicalTimeline,
		PROJECT_FEATURE_CAPABILITY_IDS.audioWarp,
	]);
	for (const featureId of PROJECT_FEATURE_AUDIO_CAPABILITY_IDS) {
		const input = project(featureId);
		const projected = projectFeatureAudioRenderedFallbackPlayback(input, report({ featureId }));
		assert.equal(projected.metadata?.featureId, featureId);
		assert.equal(projected.metadata?.requirementId, 'publisher-audio-render');
		assert.equal(projected.metadata?.sourceId, 'fallback-source');
		assert.equal((projected.project as typeof input).clips[0]?.sourceId, 'fallback-source');
	}
});

test('an unknown feature can bind the closed whole-mix role without activating feature code', () => {
	const featureId = 'org.example.future-mixer';
	const input = project(featureId);
	const projected = projectFeatureAudioRenderedFallbackPlayback(input, report({
		featureId,
		availability: 'unknown',
	}));

	assert.equal(projected.metadata?.featureId, featureId);
	assert.equal(projected.metadata?.role, 'project-audio-mix-v1');
	assert.equal(projected.metadata?.requirementId, 'publisher-audio-render');
	assert.equal(projected.metadata?.sourceId, 'fallback-source');
	assert.equal((projected.project as typeof input).clips[0]?.sourceId, 'fallback-source');
	assert.deepEqual(input.featureRequirements.requirements[0], {
		id: 'publisher-audio-render',
		featureId,
		displayName: 'Publisher audio render',
		disposition: 'rendered-fallback',
		fallback: {
			role: 'project-audio-mix-v1',
			kind: 'audio',
			sourceId: 'fallback-source',
			sha256: DIGEST,
		},
	});
});

test('an admitted first-party audio-effects render becomes one neutral whole-mix playback clip', () => {
	const input = project();
	const before = structuredClone(input);
	const projected = projectFeatureAudioRenderedFallbackPlayback(input, report());

	assert.notStrictEqual(projected.project, input);
	assert.deepEqual(input, before, 'the canonical project must remain unchanged');
	assert.strictEqual(projected.project.sources, input.sources);
	assert.deepEqual(projected.metadata, {
		schemaVersion: 1,
		role: 'project-audio-mix-v1',
		featureId: AUDIO_EFFECTS,
		requirementId: 'publisher-audio-render',
		sourceId: 'fallback-source',
		trackId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		clipId: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
	});

	const playback = projected.project as typeof input;
	assert.deepEqual(playback.clips, [{
		id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip,
		kind: 'audio',
		sourceId: 'fallback-source',
		title: 'Rendered audio fallback',
		timelineStartFrame: 0,
		sourceStartFrame: 0,
		sourceDurationFrames: 12,
		durationFrames: 12,
		trimStartFrames: 0,
		trimEndFrames: 0,
		gain: 1,
		fadeInFrames: 0,
		fadeOutFrames: 0,
		reversed: false,
		envelope: [],
		groupId: null,
		color: 'auto',
		pitchCents: 0,
		speedRatio: 1,
		preserveFormants: false,
		stretchToTempo: false,
		renderCacheRevision: 0,
		avLinkId: null,
		binItemId: null,
		opaqueExtensions: {},
	}]);
	assert.equal(playback.tracks.length, 1);
	assert.deepEqual(playback.tracks[0], {
		type: 'audio',
		id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		name: 'Rendered audio fallback',
		gain: 1,
		pan: 0,
		mute: false,
		solo: false,
		armed: false,
		displayMode: 'waveform',
		color: '#4f87c8',
		spectrogram: {
			scale: 'logarithmic', minimumFrequency: 20, maximumFrequency: 20_000,
			windowSize: 2_048, windowType: 'hann', gain: 20, range: 80,
		},
		envelope: [],
		effectsActive: false,
		effects: [],
		clipIds: [PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip],
		collapsed: false,
		height: 160,
		laneGroupId: null,
		opaqueExtensions: {},
	});
	assert.deepEqual(playback.mixer, { groups: [], sends: [], routes: {} });
	assert.deepEqual(playback.master, {
		gain: 1, pan: 0, mute: false, solo: false, envelope: [], collapsed: true,
		effectsActive: false, effects: [],
	});
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.metadata), true);
	assert.equal(Object.isFrozen(playback.clips), true);
	assert.equal(Object.isFrozen(playback.tracks), true);
});

test('the fallback retains video and label playback timing while removing every canonical audio path', () => {
	const input = project();
	const videoClip = Object.freeze({
		id: 'video-clip', kind: 'video', sourceId: 'video-source', timelineStartFrame: 3,
		durationFrames: 20,
	});
	const videoTrack = Object.freeze({ type: 'video', id: 'video-track', clipIds: ['video-clip'] });
	const labelTrack = Object.freeze({ type: 'label', id: 'labels', labels: [] });
	const candidate = {
		...input,
		clips: Object.freeze([...input.clips, videoClip]),
		tracks: Object.freeze([input.tracks[0]!, videoTrack, labelTrack]),
	};
	const projected = projectFeatureAudioRenderedFallbackPlayback(candidate, report()).project as typeof candidate;

	assert.deepEqual(projected.clips, [projected.clips[0], videoClip]);
	assert.strictEqual(projected.clips[1], videoClip);
	assert.deepEqual(projected.tracks.map(({ id }) => id), [
		PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track,
		'video-track',
		'labels',
	]);
	assert.strictEqual(projected.tracks[1], videoTrack);
	assert.strictEqual(projected.tracks[2], labelTrack);
});

test('available, bypass, wrong-role, and future requirements never activate fallback playback', () => {
	const input = project();
	for (const candidate of [
		null,
		report({ availability: 'available', disposition: 'native' }),
		report({ declaredDisposition: 'bypass', disposition: 'bypassed', fallback: null }),
		report({ fallback: {
			role: 'project-video-render-v1', kind: 'audio', sourceId: 'fallback-source', sha256: DIGEST,
		} }),
		report({ fallback: { kind: 'video', sourceId: 'fallback-source', sha256: DIGEST } }),
	]) {
		const projected = projectFeatureAudioRenderedFallbackPlayback(
			input,
			candidate as ProjectFeatureRequirementsReport | null,
		);
		assert.strictEqual(projected.project, input);
		assert.equal(projected.metadata, null);
	}

	const future = {
		...input,
		schemaVersion: 11,
		get sources(): never { throw new Error('future sources were traversed'); },
	};
	const projected = projectFeatureAudioRenderedFallbackPlayback(future, report());
	assert.strictEqual(projected.project, future);
	assert.equal(projected.metadata, null);
});

test('ambiguous fallback declarations and unsafe source geometry reject instead of guessing', () => {
	const input = project();
	assert.throws(() => projectFeatureAudioRenderedFallbackPlayback(input, {
		...report(),
		items: [...report().items, {
			...report().items[0]!, requirementId: 'publisher-audio-render-copy',
		}],
	}), /multiple|duplicate|ambiguous.*audio.*fallback/iu);
	assert.throws(() => projectFeatureAudioRenderedFallbackPlayback(input, {
		...report(),
		items: [...report().items, {
			...report().items[0]!,
			requirementId: 'publisher-spectral-render',
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		}],
	}), /multiple|duplicate|ambiguous.*audio.*fallback/iu);

	const mutations: ReadonlyArray<readonly [string, (value: MutableFixture) => void, RegExp]> = [
		['missing source', (value) => { value.sources = value.sources.filter(({ id }) => id !== 'fallback-source'); }, /fallback source.*missing|does not exist/iu],
		['wrong kind', (value) => { value.sources[1]!.kind = 'video'; }, /fallback source.*audio|kind/iu],
		['sample rate', (value) => { value.sources[1]!.sampleRate = 44_100; }, /sample rate/iu],
		['channel count', (value) => { value.sources[1]!.channelCount = 1; }, /channel count/iu],
		['surround', (value) => { value.masterChannels = 6; value.sources[1]!.channelCount = 6; }, /mono|stereo|surround|channel count/iu],
		['ADM', (value) => { value.metadata.adm = { mode: 'authored' }; }, /ADM/iu],
		['frame count', (value) => { value.sources[1]!.frameCount = Number.MAX_SAFE_INTEGER + 1; }, /frame count/iu],
	];
	for (const [name, mutate, pattern] of mutations) {
		const candidate = structuredClone(input) as unknown as MutableFixture;
		mutate(candidate);
		assert.throws(
			() => projectFeatureAudioRenderedFallbackPlayback(candidate, report()),
			pattern,
			name,
		);
	}
});

test('reserved IDs and source descriptor drift reject without reading audio-effect payload state', () => {
	const guarded = structuredClone(project()) as unknown as MutableFixture;
	let payloadReads = 0;
	for (const property of ['effects', 'params', 'context', 'state']) {
		Object.defineProperty(guarded.tracks[0]!, property, {
			configurable: true,
			enumerable: true,
			get() {
				payloadReads += 1;
				throw new Error(`${property} was read`);
			},
		});
	}
	const projected = projectFeatureAudioRenderedFallbackPlayback(guarded, report());
	assert.equal(projected.metadata?.sourceId, 'fallback-source');
	assert.equal(payloadReads, 0);

	for (const collision of [
		{ tracks: [{ type: 'label', id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.track }] },
		{ clips: [{ kind: 'video', id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip }] },
		{ projectBin: { clips: [{ kind: 'video', id: PROJECT_FEATURE_AUDIO_RENDERED_FALLBACK_IDS.clip }] } },
	]) {
		assert.throws(
			() => projectFeatureAudioRenderedFallbackPlayback({ ...project(), ...collision }, report()),
			/reserved.*(?:track|clip).*ID|collision/iu,
		);
	}
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(project(), report({
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio', sourceId: 'source-a', sha256: DIGEST,
			},
		})),
		/fallback descriptor.*project manifest|source.*drift|does not match/iu,
	);
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(project(), report({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
		})),
		/fallback descriptor.*project manifest|does not match/iu,
	);
	assert.throws(
		() => projectFeatureAudioRenderedFallbackPlayback(
			project(PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing),
			report({
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioSpectralEditing,
				fallback: {
					role: 'project-audio-mix-v1', kind: 'audio',
					sourceId: 'fallback-source', sha256: 'cd'.repeat(32),
				},
			}),
		),
		/fallback descriptor.*project manifest|digest.*drift|does not match/iu,
	);
});
