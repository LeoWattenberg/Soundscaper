/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createVideoKeyframeExportInventory,
} from '../src/common/editor/video-keyframe-export-inventory.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import {
	createAudioTrack,
	createVideoClip,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsRetime,
} from '../src/framescaper/editor-project-feature-requirements-retime.ts';
import { createFramescaperProjectRetime } from '../src/framescaper/editor-project-retime.ts';
import { FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE } from '../src/framescaper/editor-project-retime-profile.ts';
import { framescaperProjectForRuntimeConsumersRetime } from '../src/framescaper/editor-project-retime-runtime.ts';
import { opacityKeyframes } from './helpers/framescaper-model-fixture.ts';

const NOW = '2026-08-14T12:00:00.000Z';
const RATE = Object.freeze({ num: 10, den: 1 });

test('selects ordered active media after one exact folder and timing projection', () => {
	const project = folderFixture();
	const before = structuredClone(project);
	const inventory = createVideoKeyframeExportInventory({
		project,
		startFrame: 0,
		endFrame: 48_000,
	});

	assert.deepEqual(inventory.activeClipIds, ['visible-clip', 'shared-clip']);
	assert.deepEqual(inventory.activeSourceIds, ['visible-source']);
	assert.deepEqual((inventory.project.clips as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'visible-clip', 'shared-clip',
	]);
	assert.deepEqual((inventory.project.sources as readonly Record<string, unknown>[]).map(({ id }) => id), [
		'visible-source',
	]);
	assert.equal(Object.isFrozen(inventory), true);
	assert.equal(Object.isFrozen(inventory.activeClipIds), true);
	assert.equal(Object.isFrozen(inventory.activeSourceIds), true);
	assert.equal(Object.isFrozen(inventory.project), true);
	assert.equal(Object.isFrozen(inventory.project.clips), true);
	assert.equal(Object.isFrozen((inventory.project.clips as readonly object[])[0]), true);
	assert.notStrictEqual((inventory.project.clips as readonly object[])[0], project.clips[0]);
	assert.deepEqual(project, before);
});

test('orders clips and first-use sources by visible runtime track encounter rather than global arrays', () => {
	const project = structuredClone(folderFixture()) as unknown as Record<string, unknown>;
	const sources = project.sources as Record<string, unknown>[];
	const clips = project.clips as Record<string, unknown>[];
	const tracks = project.tracks as Record<string, unknown>[];
	const extraSource = {
		...structuredClone(sources.find(({ id }) => id === 'visible-source')!),
		id: 'encounter-source', name: 'Encounter', storageKey: 'encounter-source',
	};
	const extraClip = {
		...structuredClone(clips.find(({ id }) => id === 'visible-clip')!),
		id: 'encounter-clip', sourceId: 'encounter-source', title: 'Encounter',
	};
	sources.unshift(extraSource);
	clips.unshift(extraClip);
	tracks.find(({ id }) => id === 'empty-track')!.clipIds = ['encounter-clip'];

	const inventory = createVideoKeyframeExportInventory({ project, startFrame: 0, endFrame: 48_000 });
	assert.deepEqual(inventory.activeClipIds, ['visible-clip', 'shared-clip', 'encounter-clip']);
	assert.deepEqual(inventory.activeSourceIds, ['visible-source', 'encounter-source']);
});

test('ignores product visual clips carried by video tracks', () => {
	const project = folderFixture() as unknown as Record<string, unknown>;
	const clips = project.clips as Record<string, unknown>[];
	const sources = project.sources as Record<string, unknown>[];
	const visibleTrack = (project.tracks as Record<string, unknown>[])
		.find(({ id }) => id === 'visible-track')!;
	for (const kind of ['still', 'generator', 'image']) {
		const sourceId = `${kind}-source`;
		const clipId = `${kind}-clip`;
		sources.push({ id: sourceId, kind });
		clips.push({
			id: clipId, kind, sourceId, title: kind,
			timelineStartFrame: 0, durationFrames: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: 48_000,
		});
		(visibleTrack.clipIds as string[]).push(clipId);
	}

	const inventory = createVideoKeyframeExportInventory({ project, startFrame: 0, endFrame: 48_000 });
	assert.deepEqual(inventory.activeClipIds, ['visible-clip', 'shared-clip']);
	assert.deepEqual(inventory.activeSourceIds, ['visible-source']);
});

test('excludes hidden folders, hidden tracks, out-of-range clips, and Project Bin-only media', () => {
	const inventory = createVideoKeyframeExportInventory({
		project: folderFixture(),
		startFrame: 72_000,
		endFrame: 96_000,
	});
	assert.deepEqual(inventory.activeClipIds, ['late-clip']);
	assert.deepEqual(inventory.activeSourceIds, ['late-source']);
	assert.equal((inventory.project.clips as readonly unknown[]).length, 1);
	assert.equal((inventory.project.sources as readonly unknown[]).length, 1);

	assert.throws(() => createVideoKeyframeExportInventory({
		project: folderFixture(), startFrame: 96_000, endFrame: 144_000,
	}), /no visible video clip/iu);
});

test('applies folder media visibility to an already-branded timing projection without losing its runtime clips', () => {
	const runtime = resolveRuntimeProjectProjection(folderFixture());
	const hiddenTrack = runtime.tracks.find(({ id }) => id === 'folder-hidden-track');
	assert.equal(hiddenTrack?.hidden, false, 'the direct timing projection has not flattened folder visibility');
	const inventory = createVideoKeyframeExportInventory({
		project: runtime,
		startFrame: 0,
		endFrame: 48_000,
	});
	assert.deepEqual(inventory.activeClipIds, ['visible-clip', 'shared-clip']);
	assert.deepEqual(inventory.activeSourceIds, ['visible-source']);
});

test('rejects missing, wrong-kind, duplicate, and multiply-linked graph identities', () => {
	for (const [mutate, match] of [
		[(project: Record<string, unknown>) => {
			(project.tracks as Record<string, unknown>[])[0]!.clipIds = ['missing'];
		}, /missing clip/iu],
		[(project: Record<string, unknown>) => {
			(project.tracks as Record<string, unknown>[])[0]!.clipIds = ['audio-clip'];
		}, /non-video clip/iu],
		[(project: Record<string, unknown>) => {
			(project.clips as Record<string, unknown>[]).push(structuredClone(
				(project.clips as Record<string, unknown>[])[0]!,
			));
		}, /duplicate runtime clip ID/iu],
		[(project: Record<string, unknown>) => {
			(project.sources as Record<string, unknown>[]).push(structuredClone(
				(project.sources as Record<string, unknown>[])[0]!,
			));
		}, /duplicate source ID/iu],
		[(project: Record<string, unknown>) => {
			(project.clips as Record<string, unknown>[])[0]!.sourceId = 'audio-source';
		}, /non-video source/iu],
		[(project: Record<string, unknown>) => {
			(project.tracks as Record<string, unknown>[])[1]!.clipIds = ['visible-clip'];
		}, /more than one video track/iu],
	] as const) {
		const project = folderFixture() as unknown as Record<string, unknown>;
		mutate(project);
		assert.throws(() => createVideoKeyframeExportInventory({
			project, startFrame: 0, endFrame: 48_000,
		}), match);
	}
});

test('retains detached materialized nested occurrence IDs and their keyed runtime carriers', () => {
	const project = nestedBaselineProject();
	const runtime = framescaperProjectForRuntimeConsumersRetime(
		FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE,
		project,
	);
	const runtimeIds = runtime.clips.map(({ id }) => String(id));
	assert.equal(runtimeIds.length, 2);
	assert.ok(runtimeIds.every((id) => id !== 'leaf-clip'));

	const inventory = createVideoKeyframeExportInventory({
		project: runtime,
		startFrame: 0,
		endFrame: 96_000,
	});
	assert.deepEqual(inventory.activeClipIds, runtimeIds);
	assert.deepEqual(inventory.activeSourceIds, ['nested-source']);
	const captured = inventory.project.clips as readonly Record<string, unknown>[];
	assert.deepEqual(captured.map(({ id }) => id), runtimeIds);
	for (const [index, clip] of captured.entries()) {
		assert.deepEqual(clip.videoKeyframes, runtime.clips[index]!.videoKeyframes);
		assert.notStrictEqual(clip, runtime.clips[index]);
		assert.notStrictEqual(clip.videoKeyframes, runtime.clips[index]!.videoKeyframes);
	}
	const runtimeSources = runtime.sources as readonly unknown[];
	assert.notStrictEqual(inventory.project.sources[0], runtimeSources[0]);
});

function folderFixture(): ReturnType<typeof createCurrentAudioEditorProject> {
	const sampleRate = 48_000;
	const sequence = { id: 'main-sequence', rate: RATE };
	const source = (id: string, kind: 'video' | 'audio' = 'video') => kind === 'video'
		? createVideoSource({
			id, name: id, storageKey: id, mimeType: 'video/mp4', contentSha256: '12'.repeat(32),
			frameCount: 144_000, sampleFrameCount: 144_000, sourceFrameCount: 30,
			frameRate: RATE, width: 64, height: 32,
		}, sampleRate)
		: {
			kind: 'audio', id, name: id, storageKey: id, mimeType: 'audio/wav',
			frameCount: 144_000, channelCount: 1, sampleRate, originalSampleRate: sampleRate,
		};
	const video = (id: string, sourceId: string, start: number) => createVideoClip({
		id, sourceId, title: id, sequenceId: sequence.id, sequenceStartFrame: start,
		sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10, retimeMap: null,
	}, { projectSampleRate: sampleRate, sequence, source: source(sourceId) });
	const sources = [
		source('visible-source'), source('hidden-source'), source('late-source'),
		source('bin-source'), source('audio-source', 'audio'),
	];
	const clips = [
		video('shared-clip', 'visible-source', 5),
		video('visible-clip', 'visible-source', 0),
		video('hidden-clip', 'hidden-source', 0),
		video('track-hidden-clip', 'hidden-source', 0),
		video('late-clip', 'late-source', 10),
		{
			kind: 'audio', id: 'audio-clip', sourceId: 'audio-source', title: 'Audio',
			timelineStartFrame: 0, durationFrames: 48_000, sourceStartFrame: 0,
			sourceDurationFrames: 48_000,
		},
	];
	const tracks = [
		createVideoTrack({ id: 'visible-track', name: 'Visible', clipIds: ['visible-clip', 'shared-clip'] }),
		createVideoTrack({ id: 'empty-track', name: 'Empty', clipIds: [] }),
		createVideoTrack({ id: 'folder-hidden-track', name: 'Folder hidden', clipIds: ['hidden-clip'] }),
		createVideoTrack({ id: 'track-hidden-track', name: 'Track hidden', hidden: true, clipIds: ['track-hidden-clip'] }),
		createVideoTrack({ id: 'late-track', name: 'Late', clipIds: ['late-clip'] }),
		createAudioTrack({ id: 'audio-track', name: 'Audio', clipIds: ['audio-clip'] }, sampleRate),
	];
	return createCurrentAudioEditorProject({
		id: 'inventory-folders', now: NOW, sampleRate, sources, clips, tracks,
		projectBin: { clips: [{ ...video('bin-clip', 'bin-source', 0), binItemId: 'bin-clip' }] },
		trackFolders: [{ id: 'hidden-folder', name: 'Hidden', hidden: true }],
		sequences: [{
			...sequence,
			trackNodes: [
				{ kind: 'track', id: 'visible-track', parentFolderId: null },
				{ kind: 'track', id: 'empty-track', parentFolderId: null },
				{ kind: 'folder', id: 'hidden-folder', parentFolderId: null },
				{ kind: 'track', id: 'folder-hidden-track', parentFolderId: 'hidden-folder' },
				{ kind: 'track', id: 'track-hidden-track', parentFolderId: null },
				{ kind: 'track', id: 'late-track', parentFolderId: null },
				{ kind: 'track', id: 'audio-track', parentFolderId: null },
			],
		}],
		primarySequenceId: sequence.id,
	});
}

function nestedBaselineProject() {
	const project = createFramescaperProjectRetime(FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE, {
		id: 'inventory-nested', title: 'Nested', now: NOW,
		sources: [createVideoSource({
			id: 'nested-source', name: 'Nested source', storageKey: 'nested-source', mimeType: 'video/mp4',
			contentSha256: '34'.repeat(32), frameCount: 144_000, sampleFrameCount: 144_000,
			sourceFrameCount: 30, frameRate: RATE, width: 64, height: 32,
		})],
		clips: [{
			kind: 'video', id: 'leaf-clip', sourceId: 'nested-source', title: 'Leaf', sequenceId: 'leaf',
			sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10,
			retimeMap: null,
		}],
		tracks: [createVideoTrack({ id: 'leaf-track', name: 'Leaf', clipIds: ['leaf-clip'], locked: false })],
		sequences: [
			{ id: 'main', rate: RATE, trackIds: [] },
			{ id: 'leaf', rate: RATE, trackIds: ['leaf-track'] },
		],
		primarySequenceId: 'main',
		subsequences: [
			{ id: 'a', sequenceId: 'main', sourceSequenceId: 'leaf', sequenceStartFrame: 0, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 },
			{ id: 'b', sequenceId: 'main', sourceSequenceId: 'leaf', sequenceStartFrame: 10, sequenceFrameCount: 10, sourceInFrame: 0, sourceFrameCount: 10 },
		],
	});
	(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes(10);
	(project as unknown as Record<string, unknown>).featureRequirements =
		reconcileFramescaperProjectFeatureRequirementsRetime(FRAMESCAPER_RETIME_PROJECT_MODEL_PROFILE, project);
	return project;
}
