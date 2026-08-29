/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createCrossProductHandoffLaunchIntent } from
	'../src/common/cross-product-handoff-intent.ts';
import { computeAudioTrackFreezeDigestsV1 } from
	'../src/common/editor/audio-track-freeze-v21.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	CrossProductHandoffRefusalError,
	convertCrossProductEditableCopy,
} from '../src/common/transfer/cross-product-handoff-conversion.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import {
	SOUNDSCAPER_PROJECT_FIELDS,
	validateSoundscaperProject,
} from '../src/soundscaper/editor-project-validation.ts';
import { createSoundscaperProjectFeatureCompatibilityService } from
	'../src/soundscaper/editor-project-feature-compatibility.ts';
import {
	FRAMESCAPER_PROJECT_FIELDS,
	createFramescaperProject,
	validateFramescaperProject,
} from '../src/framescaper/editor-project.ts';
import { createFramescaperProjectFeatureCompatibilityService } from
	'../src/framescaper/editor-project-feature-requirements.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from
	'../src/framescaper/editor-project-runtime-profile.ts';

const NOW = '2026-08-29T12:00:00.000Z';

test('Soundscaper audio-warp authority refuses before creating an intrinsically read-only Framescaper copy', () => {
	assertUnsupportedDestinationAuthority(
		audioWarpProject(),
		'framescaper',
		'clips',
		/audio-warp/iu,
	);
});

test('Soundscaper Project Bin audio-warp authority is included in destination preflight', () => {
	assertUnsupportedDestinationAuthority(
		audioWarpProject(true),
		'framescaper',
		'projectBin',
		/audio-warp/iu,
	);
});

test('Soundscaper audio-freeze authority refuses before creating an intrinsically read-only Framescaper copy', () => {
	assertUnsupportedDestinationAuthority(
		audioFreezeProject(),
		'framescaper',
		'tracks',
		/audio-freeze/iu,
	);
});

test('supported opaque binary authority still produces a truthful refusal ledger', () => {
	for (const [index, binary] of [
		Uint8Array.of(1, 2, 3),
		Uint8Array.of(4, 5, 6).buffer,
	].entries()) {
		assertUnsupportedDestinationAuthority(
			createSoundscaperProject({
				id: `editable-copy-binary-${String(index)}`, title: 'Opaque binary', now: NOW,
				opaqueExtensions: { binary },
			}),
			'framescaper',
			'opaqueExtensions',
			/opaque authority/iu,
		);
	}
});

test('top-level supported binary opaque authority is never mistaken for an empty root', () => {
	for (const [index, opaqueExtensions] of [
		new Uint8Array(),
		new ArrayBuffer(4),
	].entries()) {
		assertUnsupportedDestinationAuthority(
			createSoundscaperProject({
				id: `editable-copy-binary-root-${String(index)}`, title: 'Opaque binary root', now: NOW,
				opaqueExtensions,
			}),
			'framescaper',
			'opaqueExtensions',
			/opaque authority/iu,
		);
	}
});

test('invalid binary impostors are rejected by owning validation before refusal-ledger hashing', () => {
	const base = createSoundscaperProject({
		id: 'editable-copy-binary-impostor', title: 'Binary impostor', now: NOW,
	});
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: base, destinationFamily: 'framescaper',
		invocationId: 'binary-impostor-invocation', destinationProjectId: 'binary-impostor-copy',
	});
	for (const opaqueExtensions of [
		Object.create(Uint8Array.prototype) as Uint8Array,
		Object.create(ArrayBuffer.prototype) as ArrayBuffer,
	]) {
		assert.throws(
			() => convertCrossProductEditableCopy({
				intent, sourceProject: { ...base, opaqueExtensions },
			}),
			(error: unknown) => error instanceof TypeError
				&& !(error instanceof CrossProductHandoffRefusalError)
				&& /owning validation/iu.test(error.message),
		);
	}
});

test('an active unknown whole-mix fallback refuses instead of becoming silent compatible authority', () => {
	const source = unknownAudioFallbackProject();
	const compatibility = createSoundscaperProjectFeatureCompatibilityService().evaluate(source);
	assert.equal(compatibility?.items[0]?.availability, 'unknown');
	assert.equal(compatibility?.items[0]?.disposition, 'rendered-fallback');
	assertUnsupportedDestinationAuthority(
		source,
		'framescaper',
		'featureRequirements',
		/rendered-fallback|audible/iu,
	);
});

test('unknown bypass authority without a typed visual fallback refuses fail-closed', () => {
	const source = unknownUnclassifiedProject();
	const compatibility = createSoundscaperProjectFeatureCompatibilityService().evaluate(source);
	assert.equal(compatibility?.items[0]?.availability, 'unknown');
	assert.equal(compatibility?.items[0]?.fallback, null);
	assertUnsupportedDestinationAuthority(
		source,
		'framescaper',
		'featureRequirements',
		/unclassified|non-native/iu,
	);
});

test('a Framescaper unknown whole-mix fallback is refused symmetrically', () => {
	const source = unknownFramescaperAudioFallbackProject();
	const compatibility = createFramescaperProjectFeatureCompatibilityService(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	).evaluate(source);
	const requirement = compatibility?.items.find(({ requirementId }) => (
		requirementId === 'publisher-future-audio'
	));
	assert.equal(requirement?.availability, 'unknown');
	assert.equal(requirement?.disposition, 'rendered-fallback');
	assertUnsupportedDestinationAuthority(
		source,
		'soundscaper',
		'featureRequirements',
		/rendered-fallback|non-native/iu,
	);
});

test('constructed Framescaper compatibility refuses unsupported copied track-folder authority', () => {
	assertUnsupportedDestinationAuthority(
		trackFolderProject(),
		'framescaper',
		'featureRequirements',
		/intrinsically read-only|non-native/iu,
	);
});

function assertUnsupportedDestinationAuthority(
	source: ReturnType<typeof createSoundscaperProject> | ReturnType<typeof createFramescaperProject>,
	destinationFamily: 'framescaper' | 'soundscaper',
	refusedRoot: 'clips' | 'featureRequirements' | 'opaqueExtensions' | 'projectBin' | 'tracks',
	reasonPattern: RegExp,
): void {
	if (destinationFamily === 'framescaper') assert.equal(validateSoundscaperProject(source), true);
	else assert.equal(validateFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, source), true);
	const sourceFields = destinationFamily === 'framescaper'
		? SOUNDSCAPER_PROJECT_FIELDS : FRAMESCAPER_PROJECT_FIELDS;
	const before = structuredClone(source);
	const intent = createCrossProductHandoffLaunchIntent({
		sourceProject: source,
		destinationFamily,
		invocationId: `${String(source.id)}-invocation`,
		destinationProjectId: `${String(source.id)}-framescaper-copy`,
	});
	assert.throws(
		() => convertCrossProductEditableCopy({ intent, sourceProject: source }),
		(error: unknown) => {
			assert.ok(error instanceof CrossProductHandoffRefusalError);
			assert.match(error.message, reasonPattern);
			assert.equal(error.report.refused, true);
			assert.equal(error.report.destination, null);
			assert.equal(error.report.roots.length, sourceFields.length);
			assert.equal(new Set(error.report.roots.map(({ root }) => root)).size,
				sourceFields.length);
			const refusal = error.report.roots.find(({ root }) => root === refusedRoot);
			assert.equal(refusal?.disposition, 'refuse');
			assert.match(refusal?.reason ?? '', reasonPattern);
			return true;
		},
	);
	assert.deepEqual(source, before, 'preflight leaves source authority unchanged');
}

function audioWarpProject(projectBin = false): ReturnType<typeof createSoundscaperProject> {
	const source = createAudioSource({
		id: 'warp-source', storageKey: 'warp-source', name: 'Warp source',
		contentSha256: 'a1'.repeat(32), frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'warp-clip', sourceId: source.id, title: 'Warp clip',
		...(projectBin ? { binItemId: 'warp-clip' } : {}),
		timelineStartFrame: 0, durationFrames: 8,
		sourceStartFrame: 0, sourceDurationFrames: 8,
		warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' },
			{ outer: 4, source: 2, mode: 'forward' },
			{ outer: 8, source: 8, mode: 'forward' },
		] },
	});
	const track = createAudioTrack({
		id: 'warp-track', name: 'Warp', clipIds: projectBin ? [] : [clip.id],
	});
	return createSoundscaperProject({
		id: projectBin ? 'editable-copy-bin-warp' : 'editable-copy-warp',
		title: 'Editable copy warp', now: NOW,
		sources: [source], clips: projectBin ? [] : [clip], tracks: [track],
		projectBin: { clips: projectBin ? [clip] : [] },
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}

function audioFreezeProject(): ReturnType<typeof createSoundscaperProject> {
	const liveSource = createAudioSource({
		id: 'freeze-live-source', storageKey: 'freeze-live-source', name: 'Freeze input',
		contentSha256: 'b2'.repeat(32), frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const derivedSource = createAudioSource({
		id: 'freeze-derived-source', storageKey: 'freeze-derived-source', name: 'Freeze render',
		contentSha256: 'c3'.repeat(32), frameCount: 8, channelCount: 1,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	const clip = createAudioClip({
		id: 'freeze-clip', sourceId: liveSource.id, title: 'Freeze clip',
		timelineStartFrame: 0, durationFrames: 8,
		sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	const editableTrack = createAudioTrack({
		id: 'freeze-track', name: 'Freeze', clipIds: [clip.id],
	});
	const digests = computeAudioTrackFreezeDigestsV1({
		sampleRate: 48_000, renderStartFrame: 0, renderFrameCount: 8,
		track: editableTrack, clips: [clip],
		sourceContentIdentities: [{ sourceId: liveSource.id, contentSha256: 'b2'.repeat(32) }],
		automationLanes: [], tempoMap: null,
	});
	const track = createAudioTrack({
		id: 'freeze-track', name: 'Freeze', clipIds: [clip.id],
		audioFreeze: {
			schemaVersion: 1, derivedSourceId: derivedSource.id, ...digests,
			renderStartFrame: 0, renderFrameCount: 8,
			capturePosition: 'post-insert-pre-strip',
		},
	});
	return createSoundscaperProject({
		id: 'editable-copy-freeze', title: 'Editable copy freeze', now: NOW,
		sources: [liveSource, derivedSource], clips: [clip], tracks: [track],
		sequences: [{ id: 'main-sequence', trackIds: [track.id] }],
		primarySequenceId: 'main-sequence',
	});
}

function unknownAudioFallbackProject(): ReturnType<typeof createSoundscaperProject> {
	const digest = 'd4'.repeat(32);
	const source = createAudioSource({
		id: 'whole-mix-source', storageKey: 'whole-mix-source', name: 'Whole mix',
		contentSha256: digest, frameCount: 8, channelCount: 2,
		sampleRate: 48_000, originalSampleRate: 48_000,
	});
	return createSoundscaperProject({
		id: 'editable-copy-unknown-audio', title: 'Unknown audio fallback', now: NOW,
		sources: [source],
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-future-audio',
				featureId: 'org.example.future-audio-pipeline',
				displayName: 'Future audio pipeline',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'project-audio-mix-v1', kind: 'audio',
					sourceId: source.id, sha256: digest,
				},
			}],
		},
	});
}

function unknownFramescaperAudioFallbackProject(): ReturnType<typeof createFramescaperProject> {
	const source = unknownAudioFallbackProject();
	return createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'editable-copy-frame-unknown-audio', title: 'Framescaper unknown audio', now: NOW,
		sources: source.sources,
		featureRequirements: source.featureRequirements,
	} as never);
}

function unknownUnclassifiedProject(): ReturnType<typeof createSoundscaperProject> {
	return createSoundscaperProject({
		id: 'editable-copy-unknown-bypass', title: 'Unknown bypass', now: NOW,
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-future-processing',
				featureId: 'org.example.future-processing',
				displayName: 'Future processing',
				disposition: 'bypass',
				fallback: null,
			}],
		},
	});
}

function trackFolderProject(): ReturnType<typeof createSoundscaperProject> {
	return createSoundscaperProject({
		id: 'editable-copy-track-folder', title: 'Track folder copy', now: NOW,
		trackFolders: [{ id: 'stems', name: 'Stems' }],
		sequences: [{
			id: 'main-sequence', trackIds: [],
			trackNodes: [{ kind: 'folder', id: 'stems', parentFolderId: null }],
		}],
		primarySequenceId: 'main-sequence',
	});
}
