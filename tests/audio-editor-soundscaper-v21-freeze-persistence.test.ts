/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	computeAudioTrackFreezeDigestsV1,
	normalizeAudioTrackFreezeV1,
	type AudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { projectFeatureAudioRenderedFallbackPlayback } from '../src/common/editor/project-feature-audio-rendered-fallback.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { createAudioClipV10, createAudioSourceV10, createAudioTrackV10 } from '../src/common/editor/project-v10.ts';
import { compactProjectSourceMetadata } from '../src/common/editor/retention.js';
import {
	soundscaperAudioTrackFreezeRequirementIdV21,
} from '../src/soundscaper/editor-project-feature-requirements-v21.ts';
import {
	cloneSoundscaperProjectV21,
	createSoundscaperProjectV21,
	loadSoundscaperProjectV21,
} from '../src/soundscaper/editor-project-v21.ts';
import { validateSoundscaperProjectV21 } from '../src/soundscaper/editor-project-v21-validation.ts';

const NOW = '2026-08-14T12:00:00.000Z';
const DERIVED_DIGEST = 'c3'.repeat(32);
const LIVE_DIGEST = 'd4'.repeat(32);

test('V21 persists one exact optional freeze and owns its per-track rendered fallback', () => {
	const project = frozenProject();
	const track = project.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>;
	const freeze = normalizeAudioTrackFreezeV1(track.audioFreeze);
	assert.ok(Object.isFrozen(freeze));
	assert.equal(freeze.derivedSourceId, 'voice-freeze');
	const requirements = project.featureRequirements.requirements.filter(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	));
	assert.deepEqual(requirements, [{
		id: soundscaperAudioTrackFreezeRequirementIdV21('voice'),
		featureId: PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze,
		displayName: 'Frozen audio track',
		disposition: 'rendered-fallback',
		fallback: {
			role: 'audio-track-render-v1', kind: 'audio', sourceId: 'voice-freeze',
			sha256: DERIVED_DIGEST, targetTrackId: 'voice',
		},
	}]);
	assert.equal(validateSoundscaperProjectV21(project), true);
	assert.deepEqual(
		(compactProjectSourceMetadata(project).sources as readonly Readonly<{ id: string }>[])
			.map(({ id }) => id),
		['voice-source', 'voice-freeze'],
	);
	assert.doesNotMatch(
		JSON.stringify(project),
		/"(?:pcm|base64|channelData|audioBuffer|payload|chunks|bytes|blob|data)":/u,
	);

	const cloned = cloneSoundscaperProjectV21(project);
	const loaded = loadSoundscaperProjectV21(structuredClone(project));
	assert.deepEqual(cloned, project);
	assert.deepEqual(loaded.project, project);
	assert.notStrictEqual(cloned, project);
	assert.ok(Object.isFrozen(normalizeAudioTrackFreezeV1(
		(cloned.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>).audioFreeze,
	)));
});

test('V21 freeze validation rejects wrong owners, missing identity, geometry drift, and document media bodies', () => {
	const project = frozenProject();
	const cases: ReadonlyArray<readonly [
		(project: Record<string, unknown>) => void,
		RegExp,
	]> = [
		[(candidate) => {
			const track = trackRecord(candidate);
			track.audioFreeze = { ...track.audioFreeze as object, extra: true };
		}, /unsupported field|freeze/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			delete source.contentSha256;
		}, /contentSha256|digest/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			source.frameCount = 999;
		}, /frameCount|geometry|render range/iu],
		[(candidate) => {
			const source = sourceRecord(candidate, 'voice-freeze');
			source.opaqueExtensions = { payload: 'AAAA' };
		}, /PCM|payload|media bod/iu],
		[(candidate) => {
			const track = trackRecord(candidate);
			track.type = 'video';
		}, /track|audioFreeze|video/iu],
	];
	for (const [mutate, message] of cases) {
		const candidate = structuredClone(project) as unknown as Record<string, unknown>;
		mutate(candidate);
		assert.throws(() => validateSoundscaperProjectV21(candidate), message);
	}
});

test('an unavailable audio-track-freeze capability projects only the derived frozen track render', () => {
	const project = frozenProject();
	const known = new Set(Object.values(PROJECT_FEATURE_CAPABILITY_IDS));
	const available = new Set(known);
	available.delete(PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
	const report = evaluateProjectFeatureRequirements(project.featureRequirements, {
		knownFeatureIds: known,
		availableFeatureIds: available,
		sources: project.sources,
		clips: project.clips,
		tracks: project.tracks,
		schemaVersion: project.schemaVersion,
		sampleRate: project.sampleRate,
		sequences: project.sequences,
		primarySequenceId: project.primarySequenceId,
	});
	const freezeItem = report.items.find(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	));
	assert.equal(freezeItem?.availability, 'unavailable');
	assert.equal(freezeItem?.disposition, 'rendered-fallback');
	const projected = projectFeatureAudioRenderedFallbackPlayback(project, report);
	assert.equal(projected.metadata?.featureId, PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze);
	assert.equal(projected.metadata?.sourceId, 'voice-freeze');
	const playback = projected.project;
	const target = playback.tracks.find(({ id }) => id === 'voice') as Readonly<Record<string, unknown>>;
	assert.deepEqual(target.clipIds, ['soundscaper:rendered-audio-fallback:track-clip']);
	assert.deepEqual(target.effects, []);
	assert.equal(target.effectsActive, false);
	assert.equal(Object.hasOwn(target, 'audioFreeze'), false);
	const rendered = playback.clips.find(({ id }) => (
		id === 'soundscaper:rendered-audio-fallback:track-clip'
	)) as Readonly<Record<string, unknown>>;
	assert.equal(rendered.sourceId, 'voice-freeze');
	assert.equal(rendered.timelineStartFrame, 64);
	assert.equal(rendered.durationFrames, 1_024);
	assert.equal(rendered.anchor, 'sample');
	assert.deepEqual(playback.automationLanes, [project.automationLanes[1]]);
	assert.deepEqual(project.tracks.find(({ id }) => id === 'voice')?.clipIds, ['voice-clip']);
});

function frozenProject() {
	const liveSource = createAudioSourceV10({
		id: 'voice-source', name: 'Voice source', storageKey: 'pcm:voice-source',
		contentSha256: LIVE_DIGEST,
		frameCount: 512, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const derivedSource = createAudioSourceV10({
		id: 'voice-freeze', name: 'Voice freeze', storageKey: 'derived:voice-freeze',
		contentSha256: DERIVED_DIGEST,
		frameCount: 1_024, channelCount: 2, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClipV10({
		id: 'voice-clip', sourceId: 'voice-source', title: 'Voice',
		timelineStartFrame: 100, durationFrames: 512,
		sourceStartFrame: 0, sourceDurationFrames: 512,
	});
	const effect = {
		id: 'voice-fx', type: 'limiter', enabled: true,
		params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
	};
	const automationEffect = {
		id: 'voice-filter', type: 'highpass', enabled: true,
		params: { frequency: 1_000, q: 1 },
	};
	const automationLanes = [
		{
			id: 'voice-effect-frequency',
			address: {
				kind: 'effect', strip: { kind: 'track', id: 'voice' },
				effectId: 'voice-filter', parameterId: 'frequency',
			},
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1_000 }], segments: [],
		},
		{
			id: 'voice-strip-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 1 }], segments: [],
		},
	] as const;
	const editableTrack = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
		effects: [effect, automationEffect],
	});
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000,
		renderStartFrame: 64,
		renderFrameCount: 1_024,
		track: editableTrack,
		clips: [clip],
		sourceContentIdentities: [{ sourceId: liveSource.id, contentSha256: LIVE_DIGEST }],
		automationLanes,
		tempoMap: null,
	});
	const track = createAudioTrackV10({
		id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [effect, automationEffect],
		audioFreeze: freezeRecord(digests),
	});
	return createSoundscaperProjectV21({
		id: 'freeze-project', title: 'Freeze project', now: NOW,
		sources: [liveSource, derivedSource], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
		automationLanes,
	});
}

function freezeRecord(digests: AudioTrackFreezeDigestsV1): AudioTrackFreezeV1 {
	return {
		schemaVersion: 1,
		derivedSourceId: 'voice-freeze',
		...digests,
		renderStartFrame: 64,
		renderFrameCount: 1_024,
		capturePosition: 'post-insert-pre-strip',
	};
}

function trackRecord(project: Record<string, unknown>): Record<string, unknown> {
	return (project.tracks as Array<Record<string, unknown>>).find(({ id }) => id === 'voice')!;
}

function sourceRecord(project: Record<string, unknown>, id: string): Record<string, unknown> {
	return (project.sources as Array<Record<string, unknown>>).find((source) => source.id === id)!;
}
