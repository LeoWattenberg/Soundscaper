/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAup4ExportPlan } from '../src/common/editor/aup4-export.js';
import { prepareRangeDeleteCommand } from '../src/common/editor/commands.js';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

import { createExportRenderProject } from '../src/common/editor/controller/export-render-project.ts';
import {
	createIsolatedTrackRenderProjectV21,
} from '../src/common/editor/controller/isolated-track-render-project-v21.ts';
import { exportProjectEdl, exportProjectOtio } from '../src/common/editor/controller/interchange-export-action.ts';
import { createMixRenderSnapshot } from '../src/common/editor/controller/mix-render-model.ts';
import type { ControllerProject, ControllerTrack } from '../src/common/editor/controller/track-domain-types.ts';
import { createAudioEditorEngine } from '../src/common/editor/engine.js';
import {
	createAudioClip,
	createAudioSource,
	createAudioTrack,
	createVideoSource,
	createVideoTrack,
} from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import {
	applySoundscaperProjectCommand,
	soundscaperProjectForCommandConsumers,
} from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';

/**
 * One document, carrying what several slices added, through every path that reads it.
 *
 * Each slice was tested on its own, and the seams between them were where the
 * defects lived: a folder that broke the freeze projection, an effect render, a
 * mix render, and two exports; annotations that a ripple moved and an insert did
 * not; interchange profiles that threw on the coordinates every current document
 * states. This is the shape of document those failures needed — a folder with a
 * muted parent, musical automation, markers, a label track, and picture — put
 * through playback, the render snapshots, the interchange profiles, and AUP4 in
 * one test, so a future slice that reads a document one way and writes it
 * another fails here rather than in someone's export.
 */

const NOW = '2026-08-19T12:00:00.000Z';
const SAMPLE_RATE = 48_000;
const PAL = Object.freeze({ num: 25, den: 1 });

test('a foldered, annotated, automated document survives every path that reads it', async () => {
	const project = crossSliceProject();

	// Playback: the folder's mute reaches the leaf that inherits it.
	const playback = createSoundscaperPlaybackProjectService();
	const projection = playback.projectForPlayback(project);
	assert.equal(trackOf(projection.project, 'voice')?.mute, true);
	assert.equal(trackOf(projection.project, 'music')?.mute, false);

	// Export: the same projection, detached, without re-validating it as canonical.
	const exportProject = createExportRenderProject(projection.project);
	assert.notEqual(exportProject, projection.project);
	assert.equal(trackOf(exportProject, 'voice')?.mute, true);

	// Both render snapshots load: they narrow the tracks, so they must carry the
	// folder projection with them or the engine refuses the hierarchy.
	const engine = createAudioEditorEngine({ audioContextFactory: null, offlineAudioContextFactory: null });
	try {
		const mix = createMixRenderSnapshot(
			project as unknown as ControllerProject,
			[trackOf(project, 'voice') as unknown as ControllerTrack],
		);
		assert.doesNotThrow(() => { engine.loadProject(mix as never, new Map()); });
		const isolated = createIsolatedTrackRenderProjectV21(project as never, {
			trackId: 'voice', effects: [], clipIds: null,
		});
		assert.doesNotThrow(() => { engine.loadProject(isolated as never, new Map()); });
	} finally {
		await engine.dispose();
	}

	// Interchange: the profiles read resolved coordinates, and say what they drop.
	const runtime = { getProject: () => project, state: {} as Record<string, unknown>, sequenceId: 'seq' };
	const edl = await exportProjectEdl(runtime);
	assert.match(edl?.text ?? '', /^TITLE: /u);
	const otio = await exportProjectOtio(runtime);
	assert.ok(otio?.report.items.some(({ code }) => code === 'otio.annotations-omitted'));
	// The muted folder's track is not in the file, because it is not in the render.
	const otioDocument = JSON.parse(otio?.text ?? '{}') as {
		tracks: { children: { name: string }[] };
	};
	assert.equal(otioDocument.tracks.children.some(({ name }) => name === 'Voice'), false);
	assert.equal(otioDocument.tracks.children.some(({ name }) => name === 'Music'), true);

	// AUP4: the file states the track state the folder gives it.
	const plan = createAup4ExportPlan(project);
	assert.equal(plan.project.tracks.find(({ id }: { id: string }) => id === 'voice')?.mute, true);
});

test('a whole-sequence ripple moves every authority by one PAL-conformed span', () => {
	const project = crossSliceProject();
	const command = preparedRipple(project, ['voice', 'music', 'picture']);
	assert.deepEqual(command.annotationRippleOperations, [{
		sequenceId: 'seq',
		sampleRange: { startFrame: 0, endFrame: 24_960 },
		musicalRange: { startBeat: { num: 0, den: 1 }, endBeat: { num: 26, den: 25 } },
	}]);

	const rippled = applySoundscaperProjectCommand(project, command, { now: NOW });
	const marker = rippled.timelineAnnotations.find(({ id }) => id === 'marker-after');
	assert.ok(marker?.kind === 'marker' && marker.anchor === 'sample');
	assert.equal(marker.positionFrame, 23_040);
	assert.equal(rippled.takeGroups[0]?.startSample, 71_040);

	const picture = rippled.clips.find(({ id }) => id === 'v-clip');
	assert.ok(picture?.kind === 'video');
	assert.equal(picture.sourceInFrame, 13);
	assert.equal(picture.sequenceFrameCount, 12);

	const voiceAutomation = rippled.automationLanes.find(({ id }) => id === 'voice-gain');
	assert.ok(voiceAutomation?.timebase === 'musical-beats');
	assert.deepEqual(voiceAutomation.points.map(({ position }) => position), [
		{ num: 0, den: 1 },
		{ num: 74, den: 25 },
	]);
});

test('a partial-sequence ripple leaves sequence annotations and picture fixed', () => {
	const project = crossSliceProject();
	const command = preparedRipple(project, ['voice', 'music']);
	assert.deepEqual(command.annotationRippleOperations, []);

	const rippled = applySoundscaperProjectCommand(project, command, { now: NOW });
	const marker = rippled.timelineAnnotations.find(({ id }) => id === 'marker-after');
	assert.ok(marker?.kind === 'marker' && marker.anchor === 'sample');
	assert.equal(marker.positionFrame, 48_000);
	assert.equal(rippled.takeGroups[0]?.startSample, 72_000);

	const picture = rippled.clips.find(({ id }) => id === 'v-clip');
	assert.ok(picture?.kind === 'video');
	assert.equal(picture.sourceInFrame, 0);
	assert.equal(picture.sequenceFrameCount, 25);
});

function preparedRipple(
	project: ReturnType<typeof crossSliceProject>,
	trackIds: readonly string[],
): Extract<AudioEditorCommand, { readonly type: 'range/ripple-delete' }> {
	const projection = soundscaperProjectForCommandConsumers(project);
	const command = prepareRangeDeleteCommand(projection, {
		startFrame: 0,
		endFrame: 24_000,
		trackIds,
		rippleMode: 'track',
	});
	if (command.type !== 'range/ripple-delete') throw new TypeError('Expected a ripple-delete command.');
	return command as unknown as Extract<AudioEditorCommand, { readonly type: 'range/ripple-delete' }>;
}

function trackOf(project: unknown, id: string): Record<string, unknown> | undefined {
	const tracks = (project as { tracks?: readonly Record<string, unknown>[] }).tracks ?? [];
	return tracks.find((track) => track.id === id);
}

function crossSliceProject() {
	const voiceSource = createAudioSource({
		id: 'voice-source', storageKey: 'pcm:voice', contentSha256: 'a'.repeat(64),
		frameCount: SAMPLE_RATE * 10, channelCount: 1, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const musicSource = createAudioSource({
		id: 'music-source', storageKey: 'pcm:music', contentSha256: 'b'.repeat(64),
		frameCount: SAMPLE_RATE * 10, channelCount: 1, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const takeSource = createAudioSource({
		id: 'take-source', storageKey: 'pcm:take', contentSha256: 'c'.repeat(64),
		frameCount: SAMPLE_RATE * 10, channelCount: 1, sampleRate: SAMPLE_RATE,
		originalSampleRate: SAMPLE_RATE, sampleFormat: 'float32', chunkFrames: 65_536,
	});
	const camera = createVideoSource({
		id: 'cam', name: 'CAM', storageKey: 'media/cam.mp4', mimeType: 'video/mp4',
		frameCount: SAMPLE_RATE * 10, sampleRate: SAMPLE_RATE, channelCount: 2,
		frameRate: PAL, width: 1_920, height: 1_080,
	});
	return createSoundscaperProject({
		id: 'cross-slice', title: 'Cross slice', now: NOW,
		sources: [voiceSource, musicSource, takeSource, camera],
		clips: [
			createAudioClip({
				id: 'voice-clip', sourceId: 'voice-source', title: 'Voice', timelineStartFrame: 0,
				durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
			}),
			createAudioClip({
				id: 'music-clip', sourceId: 'music-source', title: 'Music', timelineStartFrame: 0,
				durationFrames: SAMPLE_RATE, sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
			}),
			{
				kind: 'video', id: 'v-clip', sourceId: 'cam', title: 'Wide', sequenceId: 'seq',
				sequenceStartFrame: 0, sequenceFrameCount: 25, sourceInFrame: 0, sourceFrameCount: 25,
			},
		],
		tracks: [
			createAudioTrack({
				id: 'voice', name: 'Voice', clipIds: ['voice-clip'],
				effects: [{
					id: 'voice-fx', type: 'limiter', enabled: true,
					params: { ceiling: -1, lookahead: 0.005, release: 0.1 },
				}],
			}),
			createAudioTrack({ id: 'music', name: 'Music', clipIds: ['music-clip'] }),
			createVideoTrack({ id: 'picture', name: 'Picture', clipIds: ['v-clip'] }),
			{
				type: 'label', id: 'labels', name: 'Labels',
				labels: [{
					id: 'label-a', title: 'Cue', startFrame: 0, endFrame: 0,
					color: 'auto', opaqueExtensions: {},
				}],
			},
		],
		trackFolders: [{ id: 'stems', name: 'Stems', mute: true }],
		sequences: [{
			id: 'seq', name: 'Sequence', rate: PAL,
			trackNodes: [
				{ kind: 'folder', id: 'stems', parentFolderId: null },
				{ kind: 'track', id: 'voice', parentFolderId: 'stems' },
				{ kind: 'track', id: 'music', parentFolderId: null },
				{ kind: 'track', id: 'picture', parentFolderId: null },
				{ kind: 'track', id: 'labels', parentFolderId: null },
			],
		}],
		primarySequenceId: 'seq',
		automationLanes: [{
			id: 'voice-gain',
			address: { kind: 'strip', strip: { kind: 'track', id: 'voice' }, parameterId: 'gain' },
			timebase: 'musical-beats',
			points: [
				{ id: 'start', position: { num: 0, den: 1 }, value: 0.25 },
				{ id: 'end', position: { num: 4, den: 1 }, value: 1 },
			],
			segments: [{ kind: 'linear' }],
		}],
		timelineAnnotations: [
			{
				id: 'marker-before', sequenceId: 'seq', kind: 'marker', anchor: 'sample',
				name: 'Head', positionFrame: 0, color: 'auto', batchId: null, opaqueExtensions: {},
			},
			{
				id: 'marker-after', sequenceId: 'seq', kind: 'marker', anchor: 'sample',
				name: 'Tail', positionFrame: 48_000, color: 'auto', batchId: null, opaqueExtensions: {},
			},
		],
		takeGroups: [{
			id: 'take-group', sequenceId: 'seq', trackId: 'music',
			startSample: 96_000, endSample: 96_008,
			laneOrder: ['take-lane'],
			lanes: [{ id: 'take-lane' }],
			takes: [{
				id: 'take-a', laneId: 'take-lane', sourceId: 'take-source',
				startSample: 96_000, endSample: 96_008, sourceStartSample: 0,
			}],
			compRegions: [{ id: 'comp-a', takeId: 'take-a', startSample: 96_000, endSample: 96_008 }],
		}],
	});
}
