/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION,
	createCurrentAudioEditorProject,
} from '../src/common/editor/project-current.ts';
import { SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION } from '../src/common/editor/project-schema-version.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_FEATURE_CAPABILITY_IDS,
	PROJECT_FEATURE_VIDEO_CAPABILITY_IDS,
} from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import {
	PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS,
	projectFeatureVideoRenderedFallbackPlayback,
} from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createLabelTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';

const VIDEO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
const DIGEST = 'bc'.repeat(32);

function report(overrides: Record<string, unknown> = {}): ProjectFeatureRequirementsReport {
	return {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'publisher-video-render',
			featureId: VIDEO_EFFECTS,
			displayName: 'Publisher video render',
			availability: 'unavailable',
			declaredDisposition: 'rendered-fallback',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-video-render-v1',
				kind: 'video',
				sourceId: 'fallback-video',
				sha256: DIGEST,
			},
			message: 'Video effects are unavailable.',
			...overrides,
		}],
	};
}

function project(featureId: string = VIDEO_EFFECTS) {
	const audioSource = createAudioSource({
		id: 'audio-source', storageKey: 'audio-source', frameCount: 12,
		channelCount: 2, sampleRate: 48_000,
	});
	const originalVideo = createVideoSource({
		id: 'original-video', storageKey: 'original-video', frameCount: 18,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const fallbackVideo = createVideoSource({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 24,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const audioClip = createAudioClip({
		id: 'audio-clip', sourceId: audioSource.id, durationFrames: 12,
	});
	const videoClip = createVideoClip({
		id: 'video-clip', sourceId: originalVideo.id, durationFrames: 18,
		videoEffects: [{ id: 'pixelate-a', type: 'pixelate', enabled: true, params: { blockSize: 12 } }],
	});
	const audioTrack = createAudioTrack({ id: 'audio-track', clipIds: [audioClip.id] });
	const videoTrack = createVideoTrack({ id: 'video-track', clipIds: [videoClip.id], mute: true });
	const labelTrack = createLabelTrack({ id: 'label-track', labels: [] });
	return createCurrentAudioEditorProject({
		id: 'project-a', now: '2026-08-01T12:00:00.000Z', sampleRate: 48_000,
		sources: [audioSource, originalVideo, fallbackVideo],
		clips: [audioClip, videoClip], tracks: [audioTrack, videoTrack, labelTrack],
		projectBin: { clips: [{ ...videoClip, id: 'bin-video-clip', binItemId: 'bin-video-clip' }] },
		featureRequirements: { schemaVersion: 1, requirements: [{
			id: 'publisher-video-render', featureId,
			displayName: 'Publisher video render', disposition: 'rendered-fallback',
			fallback: { kind: 'video', sourceId: fallbackVideo.id, sha256: DIGEST },
		}] },
	});
}

test('every registered first-party video capability can bind one full-render fallback', () => {
	assert.equal(Object.isFrozen(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS), true);
	assert.deepEqual(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS, [
		PROJECT_FEATURE_CAPABILITY_IDS.videoImport,
		PROJECT_FEATURE_CAPABILITY_IDS.videoPlayback,
		PROJECT_FEATURE_CAPABILITY_IDS.videoTimelineEditing,
		PROJECT_FEATURE_CAPABILITY_IDS.videoExport,
		PROJECT_FEATURE_CAPABILITY_IDS.videoEffects,
		PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
		PROJECT_FEATURE_CAPABILITY_IDS.sequenceTiming,
		PROJECT_FEATURE_CAPABILITY_IDS.timelineImages,
		PROJECT_FEATURE_CAPABILITY_IDS.videoRetime,
		PROJECT_FEATURE_CAPABILITY_IDS.videoTimingAssets,
	]);
	for (const featureId of PROJECT_FEATURE_VIDEO_CAPABILITY_IDS) {
		const input = project(featureId);
		const projected = projectFeatureVideoRenderedFallbackPlayback(input, report({ featureId }));
		assert.equal(projected.metadata?.featureId, featureId);
		assert.equal(projected.metadata?.requirementId, 'publisher-video-render');
		assert.equal(projected.metadata?.sourceId, 'fallback-video');
		assert.equal((projected.project as typeof input).clips[1]?.sourceId, 'fallback-video');
	}
	assert.equal(PROJECT_FEATURE_VIDEO_CAPABILITY_IDS.includes(
		PROJECT_FEATURE_CAPABILITY_IDS.videoGeometry as never,
	), false, 'geometry has no rendered-fallback publication contract');
});

test('an admitted first-party video-effects render becomes one neutral full-length preview clip', () => {
	const input = project();
	const before = structuredClone(input);
	const projected = projectFeatureVideoRenderedFallbackPlayback(input, report());

	assert.notStrictEqual(projected.project, input);
	assert.deepEqual(input, before, 'the canonical project must remain unchanged');
	assert.strictEqual(projected.project.sources, input.sources);
	assert.strictEqual(projected.project.projectBin, input.projectBin);
	assert.deepEqual(projected.metadata, {
		schemaVersion: 1,
		role: 'project-video-render-v1',
		featureId: VIDEO_EFFECTS,
		requirementId: 'publisher-video-render',
		sourceId: 'fallback-video',
		trackId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
		clipId: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
	});

	const playback = projected.project as typeof input;
	assert.deepEqual(playback.clips, [input.clips[0], {
		id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip,
		kind: 'video',
		sourceId: 'fallback-video',
		title: 'Rendered video fallback',
		sequenceId: 'main-sequence',
		sequenceStartFrame: 0,
		sequenceFrameCount: 1,
		sourceInFrame: 0,
		sourceFrameCount: 1,
		retimeMap: null,
		trimStartFrames: 0,
		trimEndFrames: 0,
		groupId: null,
		color: 'auto',
		speedRatio: 1,
		avLinkId: null,
		binItemId: null,
		opaqueExtensions: {},
		videoEffects: [],
	}]);
	assert.deepEqual(playback.tracks, [input.tracks[0], {
		type: 'video',
		id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
		name: 'Rendered video fallback',
		clipIds: [PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.clip],
		mute: false,
		hidden: false,
		collapsed: false,
		height: 120,
		laneGroupId: null,
		opaqueExtensions: {},
	}, input.tracks[2]]);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.metadata), true);
});

test('an unknown feature can bind the closed whole-project video role', () => {
	const featureId = 'org.example.future-video-pipeline';
	const input = project(featureId);
	const before = structuredClone(input);
	const projected = projectFeatureVideoRenderedFallbackPlayback(input, report({
		featureId,
		availability: 'unknown',
	}));

	assert.equal(projected.metadata?.role, 'project-video-render-v1');
	assert.equal(projected.metadata?.featureId, featureId);
	assert.equal(projected.metadata?.requirementId, 'publisher-video-render');
	assert.equal(projected.metadata?.sourceId, 'fallback-video');
	assert.equal((projected.project as typeof input).clips[1]?.sourceId, 'fallback-video');
	assert.deepEqual(input, before, 'the canonical project must remain unchanged');
});

test('selected Soundscaper V21 can project the maintained whole-project video fallback contract', () => {
	const input = { ...project(), schemaVersion: SOUNDSCAPER_PROJECT_V21_SCHEMA_VERSION };
	const projected = projectFeatureVideoRenderedFallbackPlayback(input, report());

	assert.equal(projected.metadata?.role, 'project-video-render-v1');
	assert.equal((projected.project as typeof input).clips[1]?.sourceId, 'fallback-video');
});

test('a known non-video feature cannot bind the closed whole-project video role', () => {
	assert.throws(
		() => project(PROJECT_FEATURE_CAPABILITY_IDS.audioAnalysis),
		/not eligible for a video rendered fallback/iu,
	);
});

test('the video fallback projector ignores unrelated reports and never traverses future projects', () => {
	const input = project();
	for (const candidate of [
		report({ availability: 'available' }),
		report({ declaredDisposition: 'bypass', disposition: 'bypassed', fallback: null }),
		report({ fallback: { kind: 'audio', sourceId: 'fallback-video', sha256: DIGEST } }),
		null,
	]) {
		const result = projectFeatureVideoRenderedFallbackPlayback(
			input,
			candidate as ProjectFeatureRequirementsReport | null,
		);
		assert.strictEqual(result.project, input);
		assert.equal(result.metadata, null);
	}

	const future = {
		...input,
		schemaVersion: AUDIO_EDITOR_PROJECT_CURRENT_SCHEMA_VERSION + 1,
		get featureRequirements(): never { throw new Error('future manifest was traversed'); },
		get clips(): never { throw new Error('future clips were traversed'); },
	};
	const result = projectFeatureVideoRenderedFallbackPlayback(future, report());
	assert.strictEqual(result.project, future);
	assert.equal(result.metadata, null);
});

test('video fallback playback requires one exact manifest binding and valid geometry', () => {
	const input = project();
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(input, {
			...report(), items: [...report().items, ...report().items],
		}),
		/ambiguous/iu,
	);
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(input, {
			...report(), items: [...report().items, {
				...report().items[0]!,
				requirementId: 'publisher-video-compositing-render',
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
			}],
		}),
		/ambiguous/iu,
	);
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(
			project(PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing),
			report({
				featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
				fallback: {
					role: 'project-video-render-v1', kind: 'video',
					sourceId: 'fallback-video', sha256: 'de'.repeat(32),
				},
			}),
		),
		/does not match the project manifest/iu,
	);
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(input, report({
			featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing,
		})),
		/does not match the project manifest/iu,
	);

	const wrongRate = structuredClone(input) as Record<string, unknown>;
	const sources = wrongRate.sources as Array<Record<string, unknown>>;
	sources[2] = { ...sources[2], sampleRate: 44_100 };
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(wrongRate, report()),
		/sample rate must match/iu,
	);

	const collision = structuredClone(input) as Record<string, unknown>;
	(collision.tracks as Array<Record<string, unknown>>).push({
		...input.tracks[1], id: PROJECT_FEATURE_VIDEO_RENDERED_FALLBACK_IDS.track,
	});
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(collision, report()),
		/reserved rendered-fallback track ID collides/iu,
	);
});
