/* SPDX-License-Identifier: AGPL-3.0-only */

import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import type { ProjectFeatureRequirementsReport } from '../src/common/editor/project-feature-requirements.ts';
import { projectFeatureVideoRenderedFallbackPlayback } from '../src/common/editor/project-feature-video-rendered-fallback.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';

const VIDEO_EFFECTS = PROJECT_FEATURE_CAPABILITY_IDS.videoEffects;
const DIGEST = '9a'.repeat(32);

function fixture() {
	const audioSource = createAudioSource({
		id: 'audio-source', storageKey: 'audio-source', frameCount: 1_600,
		channelCount: 2, sampleRate: 48_000,
	});
	const canonicalVideo = createVideoSource({
		id: 'canonical-video', storageKey: 'canonical-video', frameCount: 200,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
	});
	const unaffectedVideo = createVideoSource({
		id: 'unaffected-video', storageKey: 'unaffected-video', frameCount: 40,
		sampleRate: 48_000, width: 1_280, height: 720, frameRate: 24,
	});
	const fallbackVideo = createVideoSource({
		id: 'fallback-video', storageKey: 'fallback-video', frameCount: 1_600,
		sampleRate: 48_000, width: 1_920, height: 1_080, frameRate: 30,
		hasAudio: false,
	});
	const linkedAudio = createAudioClip({
		id: 'linked-audio-clip', sourceId: audioSource.id, durationFrames: 1_600,
		sourceDurationFrames: 1_600, timelineStartFrame: 0,
		avLinkId: 'av-link-a', title: 'Linked production sound',
	});
	const target = createVideoClip({
		id: 'target-video-clip', sourceId: canonicalVideo.id, title: 'Hero shot',
		timelineStartFrame: 120, sourceStartFrame: 9, sourceDurationFrames: 40,
		durationFrames: 20, trimStartFrames: 3, trimEndFrames: 4,
		groupId: 'scene-a', color: '#123456', speedRatio: 2,
		avLinkId: 'av-link-a', opaqueExtensions: { compositorNode: 'hero-node' },
		videoEffects: [{
			id: 'pixelate-a', type: 'pixelate', enabled: true, params: { blockSize: 12 },
		}],
	});
	const unaffected = createVideoClip({
		id: 'unaffected-video-clip', sourceId: unaffectedVideo.id, title: 'Title card',
		timelineStartFrame: 4, sourceStartFrame: 2, sourceDurationFrames: 10,
		durationFrames: 10, color: '#abcdef', opaqueExtensions: { titleCard: true },
	});
	const project = createCurrentAudioEditorProject({
		id: 'clip-fallback-project', now: '2026-08-03T10:00:00.000Z', sampleRate: 48_000,
		sources: [audioSource, canonicalVideo, unaffectedVideo, fallbackVideo],
		clips: [unaffected, linkedAudio, target],
		tracks: [
			createVideoTrack({
				id: 'title-track', clipIds: [unaffected.id], name: 'Titles', hidden: true,
			}),
			createVideoTrack({
				id: 'hero-track', clipIds: [target.id], name: 'Hero', mute: true,
				laneGroupId: 'scene-lane', opaqueExtensions: { compositorTrack: 'hero-track-node' },
			}),
			createAudioTrack({
				id: 'production-sound', clipIds: [linkedAudio.id], laneGroupId: 'scene-lane',
			}),
		],
		projectBin: {
			clips: [{
				...unaffected, id: 'bin-title-card', binItemId: 'bin-title-card', avLinkId: null,
			}],
			tags: ['retained'],
		},
		featureRequirements: {
			schemaVersion: 2,
			requirements: [{
				id: 'publisher-video-effects-render',
				featureId: VIDEO_EFFECTS,
				displayName: 'Publisher video effects render',
				disposition: 'rendered-fallback',
				fallback: {
					role: 'video-clip-render-v1', kind: 'video', sourceId: fallbackVideo.id,
					sha256: DIGEST, targetClipId: target.id,
				},
			}],
		},
	});
	const report: ProjectFeatureRequirementsReport = {
		schemaVersion: 1,
		format: 'soundscaper-project',
		compatible: false,
		counts: { available: 0, unavailable: 1, unknown: 0 },
		items: [{
			requirementId: 'publisher-video-effects-render',
			featureId: VIDEO_EFFECTS,
			displayName: 'Publisher video effects render',
			availability: 'unavailable',
			declaredDisposition: 'rendered-fallback',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'video-clip-render-v1', kind: 'video', sourceId: fallbackVideo.id,
				sha256: DIGEST, targetClipId: 'target-video-clip',
			},
			message: 'Video effects are unavailable.',
		}],
	};
	return { project, report };
}

test('a clip-local video-effects render replaces only its target in a transient projection', () => {
	const { project, report } = fixture();
	const before = structuredClone(project);
	const result = projectFeatureVideoRenderedFallbackPlayback(project, report);
	const projected = result.project as typeof project;

	assert.notStrictEqual(projected, project);
	assert.deepEqual(project, before, 'the canonical project must remain unchanged');
	assert.strictEqual(projected.sources, project.sources);
	assert.strictEqual(projected.tracks, project.tracks);
	assert.strictEqual(projected.projectBin, project.projectBin);
	assert.strictEqual(projected.clips[0], project.clips[0]);
	assert.strictEqual(projected.clips[1], project.clips[1]);
	assert.notStrictEqual(projected.clips[2], project.clips[2]);
	assert.deepEqual(result.metadata, {
		schemaVersion: 1,
		role: 'video-clip-render-v1',
		featureId: VIDEO_EFFECTS,
		requirementId: 'publisher-video-effects-render',
		sourceId: 'fallback-video',
		targetClipId: 'target-video-clip',
	});

	assert.deepEqual(projected.clips[2], {
		...project.clips[2],
		sourceId: 'fallback-video',
		sourceInFrame: 0,
		sourceFrameCount: 1,
		retimeMap: null,
		trimStartFrames: 0,
		trimEndFrames: 0,
		speedRatio: 1,
		videoEffects: [],
	});
	for (const key of [
		'id', 'title', 'sequenceId', 'sequenceStartFrame', 'sequenceFrameCount', 'groupId', 'color',
		'avLinkId', 'binItemId', 'opaqueExtensions',
	]) assert.strictEqual(
		(projected.clips[2] as Readonly<Record<string, unknown>>)[key],
		(project.clips[2] as Readonly<Record<string, unknown>>)[key],
	);
	assert.equal(Object.isFrozen(result), true);
	assert.equal(Object.isFrozen(result.metadata), true);
	assert.equal(Object.isFrozen(projected), true);
	assert.equal(Object.isFrozen(projected.clips), true);
	assert.equal(Object.isFrozen(projected.clips[2]), true);
	assert.equal(Object.isFrozen(projected.clips[2]?.videoEffects), true);
});

test('clip-local projection rejects ambiguous video fallbacks and exact binding drift', () => {
	const { project, report } = fixture();
	const item = report.items[0]!;
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(project, {
			...report,
			items: [item, {
				...item,
				requirementId: 'publisher-full-video-render',
				fallback: {
					role: 'project-video-render-v1', kind: 'video', sourceId: 'fallback-video', sha256: DIGEST,
				},
			}],
		}),
		/ambiguous/iu,
	);
	for (const fallback of [
		{ ...item.fallback, role: 'project-video-render-v1' },
		{ ...item.fallback, targetClipId: 'other-clip' },
		{ ...item.fallback, sha256: '4d'.repeat(32) },
	]) {
		assert.throws(
			() => projectFeatureVideoRenderedFallbackPlayback(project, {
				...report,
				items: [{ ...item, fallback }],
			} as ProjectFeatureRequirementsReport),
			/does not match the project manifest/iu,
		);
	}
	const otherFeature = projectFeatureVideoRenderedFallbackPlayback(project, {
		...report,
		items: [{ ...item, featureId: PROJECT_FEATURE_CAPABILITY_IDS.videoCompositing }],
	});
	assert.strictEqual(otherFeature.project, project);
	assert.equal(otherFeature.metadata, null);
});

test('an unknown feature cannot activate the first-party clip-local video role', () => {
	const { project, report } = fixture();
	const item = report.items[0]!;
	const result = projectFeatureVideoRenderedFallbackPlayback(project, {
		...report,
		counts: { available: 0, unavailable: 0, unknown: 1 },
		items: [{
			...item,
			featureId: 'org.example.future-video-effect',
			availability: 'unknown',
		}],
	});

	assert.strictEqual(result.project, project);
	assert.equal(result.metadata, null);
});

test('clip-local projection rechecks fallback source and target geometry', () => {
	const { project, report } = fixture();
	const cases: ReadonlyArray<readonly [Readonly<Record<string, unknown>>, RegExp]> = [
		[{ sampleFrameCount: 21 }, /sample-frame count must equal the target duration/iu],
		[{ sampleRate: 44_100 }, /sample rate must match/iu],
		[{ width: 1_280 }, /width must match/iu],
		[{ height: 720 }, /height must match/iu],
		[{ frameRate: { num: 24, den: 1 } }, /frame rate must match/iu],
		[{ hasAudio: true }, /must not contain audio/iu],
	];
	for (const [changes, message] of cases) {
		const candidate = structuredClone(project) as Record<string, unknown>;
		const sources = candidate.sources as Array<Record<string, unknown>>;
		sources[3] = { ...sources[3], ...changes };
		assert.throws(
			() => projectFeatureVideoRenderedFallbackPlayback(candidate, report),
			message,
		);
	}

	const missingTarget = structuredClone(project) as Record<string, unknown>;
	missingTarget.clips = (missingTarget.clips as Array<Record<string, unknown>>)
		.filter((clip) => clip.id !== 'target-video-clip');
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(missingTarget, report),
		/exactly one target clip/iu,
	);

	const disabledTarget = structuredClone(project) as Record<string, unknown>;
	const clips = disabledTarget.clips as Array<Record<string, unknown>>;
	clips[2] = {
		...clips[2],
		videoEffects: [{
			id: 'pixelate-a', type: 'pixelate', enabled: false, params: { blockSize: 12 },
		}],
	};
	assert.throws(
		() => projectFeatureVideoRenderedFallbackPlayback(disabledTarget, report),
		/requires at least one enabled maintained video effect/iu,
	);
});
