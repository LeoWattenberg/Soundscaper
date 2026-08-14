/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudioClipV9, createAudioSourceV9, createAudioTrackV9 } from '../src/common/editor/project-v9.ts';
import { createVideoSourceV10, createVideoTrackV10 } from '../src/common/editor/project-v10.ts';
import { createFramescaperPlaybackProjectServiceV19 } from '../src/framescaper/editor-project-playback-v19.ts';
import { FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v19.ts';
import { createFramescaperProjectV19 } from '../src/framescaper/editor-project-v19.ts';
import { createFramescaperVideoExportStrategyV19 } from '../src/framescaper/video-export-strategy-v19.ts';

const PROFILE = FRAMESCAPER_V19_PROJECT_RUNTIME_PROFILE;

test('V19 export owns a detached V17 delivery projection and retains legacy planning', () => {
	const project = videoProject();
	const playback = createFramescaperPlaybackProjectServiceV19(PROFILE);
	const delivery = playback.projectForVideoRenderedFallbackDelivery?.(project);
	assert.ok(delivery);
	const strategy = createFramescaperVideoExportStrategyV19(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject: project, delivery });

	assert.equal(exportProject.schemaVersion, 17);
	assert.notStrictEqual(exportProject, delivery.project);
	assert.deepEqual(exportProject, delivery.project);
	assert.equal(Object.isFrozen(exportProject), true);
	assert.equal(Object.isFrozen(exportProject.clips), true);
	assert.equal(strategy.createPlan({
		canonicalProject: project,
		exportProject,
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: undefined,
	}), null);
	assert.throws(() => strategy.createPlan({
		canonicalProject: project,
		exportProject: structuredClone(exportProject),
		format: 'mp4',
		range: 'project',
		includeAudio: false,
		canvas: undefined,
	}), /not owned/iu);
});

test('V19 export preserves the exact maintained rendered-fallback delivery', () => {
	const project = audioFallbackProject();
	const playback = createFramescaperPlaybackProjectServiceV19(PROFILE);
	const delivery = playback.projectForVideoRenderedFallbackDelivery?.(project);
	assert.ok(delivery);
	assert.equal(delivery.audioRenderedFallback?.sourceId, 'fallback-source');
	const strategy = createFramescaperVideoExportStrategyV19(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject: project, delivery });

	assert.equal(exportProject.schemaVersion, 17);
	assert.ok((exportProject.clips as readonly Readonly<Record<string, unknown>>[]).some(
		({ sourceId }) => sourceId === 'fallback-source',
	));
	assert.throws(() => strategy.createExportProject({
		canonicalProject: project,
		delivery: { ...delivery, requiredAudioSourceIds: [] },
	}), /diverges/iu);
});

function videoProject() {
	const rate = { num: 30, den: 1 };
	return createFramescaperProjectV19(PROFILE, {
		id: 'export-v19',
		title: 'Export V19',
		now: '2026-08-14T12:00:00.000Z',
		sources: [createVideoSourceV10({
			id: 'source', name: 'Source', storageKey: 'source', mimeType: 'video/mp4',
			contentSha256: '12'.repeat(32), sampleFrameCount: 48_000,
			sourceFrameCount: 30, frameRate: rate, width: 1920, height: 1080,
		})],
		clips: [{
			kind: 'video', id: 'clip', sourceId: 'source', title: 'Clip', sequenceId: 'main',
			sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0,
			sourceFrameCount: 30, retimeMap: null,
		}],
		tracks: [createVideoTrackV10({ id: 'track', name: 'Video', clipIds: ['clip'], locked: false })],
		sequences: [{ id: 'main', rate, trackIds: ['track'] }],
		primarySequenceId: 'main',
	});
}

function audioFallbackProject() {
	const original = {
		...createAudioSourceV9({
			id: 'original-source', storageKey: 'original-source', frameCount: 4,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '12'.repeat(32),
	};
	const fallback = {
		...createAudioSourceV9({
			id: 'fallback-source', storageKey: 'fallback-source', frameCount: 6,
			channelCount: 2, sampleRate: 48_000,
		}),
		contentSha256: '34'.repeat(32),
	};
	const clip = createAudioClipV9({
		id: 'original-clip', sourceId: original.id, durationFrames: original.frameCount,
	});
	return createFramescaperProjectV19(PROFILE, {
		id: 'fallback-export-v19',
		title: 'Fallback export V19',
		now: '2026-08-14T12:00:00.000Z',
		sources: [original, fallback],
		clips: [clip],
		tracks: [createAudioTrackV9({ id: 'track', name: 'Audio', clipIds: [clip.id] })],
		featureRequirements: { schemaVersion: 2, requirements: [{
			id: 'publisher-render',
			featureId: 'org.example.future-mixer',
			displayName: 'Future mixer',
			disposition: 'rendered-fallback',
			fallback: {
				role: 'project-audio-mix-v1', kind: 'audio',
				sourceId: fallback.id, sha256: fallback.contentSha256,
			},
		}] },
	});
}
