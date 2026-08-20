/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	computeAudioTrackFreezeDigestsV1,
	type AudioTrackFreezeV1,
} from '../src/common/editor/audio-track-freeze-v21.ts';
import { createExportRenderProject } from '../src/common/editor/controller/export-render-project.ts';
import { stemProject } from '../src/common/editor/controller/temporary-export.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { normalizeProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
} from '../src/common/editor/project-media-factory.ts';
import { projectTrackFolderMediaStateV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import {
	createSoundscaperAudioTrackFreezePlaybackServiceV23,
} from '../src/soundscaper/editor-audio-track-freeze-playback-v23.ts';
import { createSoundscaperPlaybackProjectServiceV23 } from '../src/soundscaper/editor-project-playback-v23.ts';
import { cloneSoundscaperProjectV23, createSoundscaperProjectV23 } from '../src/soundscaper/editor-project-v23.ts';

/**
 * What an export renders is the projection playback renders, detached.
 *
 * Playback and export are the same render here, so the export document is a copy
 * of the delivery projection — and that projection is deliberately not canonical.
 * Folder media state is flattened onto the leaves under a marker the closed V23
 * record does not know, and a frozen track has had its render substituted and its
 * freeze record removed. Both export paths copied it with the product's canonical
 * clone, which validates, so exporting failed on exactly the documents that play:
 * a project with a folder, and a project with a fresh freeze. Worse, the throw
 * happened after the export flag was set and outside its cleanup, leaving the
 * editor stuck reporting an export in progress.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const CONTENT_SHA256 = 'a'.repeat(64);
const DERIVED_SHA256 = 'b'.repeat(64);

test('the export document keeps a folder projection the canonical clone refuses', () => {
	const delivered = projectTrackFolderMediaStateV12(folderedProject());
	// The reason this helper exists rather than the product's clone: the marker is
	// a field the canonical record does not know.
	assert.throws(() => cloneSoundscaperProjectV23(delivered as never), /unsupported field/iu);

	const exportProject = createExportRenderProject(delivered);
	assert.notEqual(exportProject, delivered, 'the export document must be detached');
	assert.doesNotThrow(() => projectTrackFolderMediaStateV12(exportProject));
	const track = (exportProject as unknown as {
		tracks: readonly Record<string, unknown>[];
	}).tracks.find(({ id }) => id === 'voice');
	assert.equal(track?.mute, true, 'the folder mute must still reach the leaf that inherits it');
});

test('the export document keeps a frozen track the canonical clone refuses', () => {
	const { project, freeze, derivedSource } = frozenFixture();
	const playback = createSoundscaperAudioTrackFreezePlaybackServiceV23(
		createSoundscaperPlaybackProjectServiceV23(), pcmStore(),
	);
	playback.admitVerifiedFreeze({
		project, trackId: 'voice', freeze, derivedSource,
		sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
	});
	const delivered = playback.projectForAudioRenderedFallbackDelivery(project).project;
	assert.throws(() => cloneSoundscaperProjectV23(delivered as never));

	const exportProject = createExportRenderProject(delivered);
	const clips = (exportProject as unknown as {
		clips: readonly Record<string, unknown>[];
	}).clips;
	assert.ok(
		clips.some((clip) => clip.sourceId === derivedSource.id),
		'the export must render the frozen substitution playback renders',
	);
});

test('a frozen native delivery stem consumes its already-realized freeze requirement', () => {
	const { project, freeze, derivedSource } = frozenFixture();
	const playback = createSoundscaperAudioTrackFreezePlaybackServiceV23(
		createSoundscaperPlaybackProjectServiceV23(), pcmStore(),
	);
	playback.admitVerifiedFreeze({
		project, trackId: 'voice', freeze, derivedSource,
		sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
	});
	const delivered = playback.projectForAudioRenderedFallbackDelivery(project).project;
	const exportProject = createExportRenderProject(delivered);
	assert.equal(exportProject.featureRequirements.requirements.some(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	)), true, 'the delivery projection still carries the declaration whose fallback it realized');

	const stem = stemProject(exportProject as never, 'voice') as unknown as typeof project;
	const track = stem.tracks.find(({ id }) => id === 'voice');
	assert.ok(track);
	assert.equal(Object.hasOwn(track, 'audioFreeze'), false);
	assert.ok(stem.clips.some(({ sourceId }) => sourceId === derivedSource.id));
	assert.equal(stem.featureRequirements.requirements.some(({ featureId }) => (
		featureId === PROJECT_FEATURE_CAPABILITY_IDS.audioTrackFreeze
	)), false, 'the stem must not redeclare a native freeze relationship already projected into PCM');
	assert.deepEqual(stem.featureRequirements, { schemaVersion: 2, requirements: [] });
	assert.deepEqual(normalizeProjectFeatureRequirements(stem.featureRequirements, {
		sources: stem.sources,
		clips: stem.clips,
		tracks: stem.tracks,
		schemaVersion: stem.schemaVersion,
		sampleRate: stem.sampleRate,
		sequences: stem.sequences,
		primarySequenceId: stem.primarySequenceId,
	}), stem.featureRequirements);
});

function pcmStore() {
	return {
		getSourceMetadata: () => null,
		readSourceChunks: () => { throw new Error('The projection must not read PCM.'); },
		openSourceReadSession: () => null,
	} as never;
}

function folderedProject() {
	return createSoundscaperProjectV23({
		...baseOptions(),
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'main-sequence',
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
			],
		}],
	});
}

function frozenFixture() {
	const options = baseOptions();
	const clip = options.clips[0]!;
	const bare = createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [] });
	const derivedSource = createAudioSource({
		id: 'voice-freeze', storageKey: 'derived:voice-freeze', contentSha256: DERIVED_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const freeze: AudioTrackFreezeV1 = {
		schemaVersion: 1,
		derivedSourceId: 'voice-freeze',
		...computeAudioTrackFreezeDigestsV1({
			sampleRate: 48_000, renderStartFrame: 0, renderFrameCount: 8,
			track: bare, clips: [clip],
			sourceContentIdentities: [{ sourceId: 'voice-source', contentSha256: CONTENT_SHA256 }],
			automationLanes: [], tempoMap: null,
		}),
		renderStartFrame: 0,
		renderFrameCount: 8,
		capturePosition: 'post-insert-pre-strip',
	};
	const project = createSoundscaperProjectV23({
		...options,
		sources: [...options.sources, derivedSource],
		tracks: [createAudioTrack({
			id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [], audioFreeze: freeze,
		})],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
	});
	return { project, freeze, derivedSource };
}

function baseOptions() {
	const source = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: CONTENT_SHA256,
		frameCount: 8, channelCount: 1, sampleRate: 48_000, originalSampleRate: 48_000,
		sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const clip = createAudioClip({
		id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
		durationFrames: 8, sourceStartFrame: 0, sourceDurationFrames: 8,
	});
	return {
		id: 'export-render-project', title: 'Export render', now: NOW,
		sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['voice-clip'], effects: [] })],
		sequences: [{ id: 'main-sequence', trackIds: ['voice'] }],
		primarySequenceId: 'main-sequence',
	};
}
