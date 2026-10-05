/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseRenderStrategy, createExportPlan } from '../src/common/editor/export.js';
import {
	createExportClipPlan,
	createExportClipProject,
} from '../src/common/editor/export-clips.ts';
import { exportClipCount, resolveExportClips } from '../src/common/editor/export-clip-boundaries.ts';
import { estimateExportSourceWorkingSetBytes } from '../src/common/editor/export-source-working-set.ts';
import { planExportOfflineRenderStrategyAdmission } from '../src/common/editor/export-render-admission.ts';
import { stemProject } from '../src/common/editor/controller/export/temporary-export.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectTrackFolderMediaStateV12, isTrackFolderMediaStateProjectionV12 } from '../src/common/editor/track-folder-media-runtime.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';

const SAMPLE_RATE = 48_000;
const NOW = '2026-10-05T00:00:00.000Z';

function clipProject() {
	return createCurrentAudioEditorProject({
		id: 'clip-delivery', title: 'Clip delivery', now: NOW, sampleRate: SAMPLE_RATE,
		master: { gain: 0.5, effects: [{ id: 'master-delay', type: 'delay', params: { delayTime: 1 } }] },
		sources: [
			{ id: 'one-source', storageKey: 'pcm/one', frameCount: 10 * SAMPLE_RATE, channelCount: 2 },
			{ id: 'two-source', storageKey: 'pcm/two', frameCount: 3 * SAMPLE_RATE, channelCount: 1 },
		],
		clips: [
			{ id: 'later', kind: 'audio', sourceId: 'one-source', title: 'Take / A', timelineStartFrame: 5 * SAMPLE_RATE, durationFrames: SAMPLE_RATE, sourceStartFrame: 2 * SAMPLE_RATE },
			{ id: 'first', kind: 'audio', sourceId: 'one-source', title: 'Take / A', timelineStartFrame: SAMPLE_RATE, durationFrames: 2 * SAMPLE_RATE, sourceStartFrame: SAMPLE_RATE },
			{ id: 'other', kind: 'audio', sourceId: 'two-source', title: '', timelineStartFrame: 0, durationFrames: 3 * SAMPLE_RATE },
		],
		tracks: [
			{ id: 'one', type: 'audio', name: 'One', mute: true, clipIds: ['first', 'later'], effects: [{ id: 'track-delay', type: 'delay', params: {} }] },
			{ id: 'two', type: 'audio', name: 'Two', solo: true, clipIds: ['other'] },
		],
	});
}

const RANGE = { startFrame: 0, endFrame: 6 * SAMPLE_RATE };

test('clip delivery follows track and clip order with each clip own timeline span', () => {
	const clips = resolveExportClips(clipProject(), RANGE);
	assert.deepEqual(clips.map(({ clipId, trackId, startFrame, endFrame }) => ({ clipId, trackId, startFrame, endFrame })), [
		{ clipId: 'first', trackId: 'one', startFrame: SAMPLE_RATE, endFrame: 3 * SAMPLE_RATE },
		{ clipId: 'later', trackId: 'one', startFrame: 5 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE },
		{ clipId: 'other', trackId: 'two', startFrame: 0, endFrame: 3 * SAMPLE_RATE },
	]);
	assert.equal(exportClipCount(clipProject()), 3);
});

test('legacy audio clips without a kind remain available and isolated for export', () => {
	const runtime = projectForRuntimeConsumers(clipProject());
	const legacy = { ...runtime, schemaVersion: 1, clips: runtime.clips.map((clip) => ({ ...clip, kind: undefined })) };
	const clips = resolveExportClips(legacy, RANGE);
	assert.equal(exportClipCount(legacy), 3);
	const snapshot = createExportClipProject(legacy, { ...clips[0] });
	assert.deepEqual(snapshot.clips.map(({ id }) => id), ['first']);
});

test('clips intersect the requested selection without adding gaps or clipped source handles', () => {
	const clips = resolveExportClips(clipProject(), { startFrame: 2 * SAMPLE_RATE, endFrame: 4 * SAMPLE_RATE });
	assert.deepEqual(clips.map(({ clipId, startFrame, durationFrames }) => ({ clipId, startFrame, durationFrames })), [
		{ clipId: 'first', startFrame: 2 * SAMPLE_RATE, durationFrames: SAMPLE_RATE },
		{ clipId: 'other', startFrame: 2 * SAMPLE_RATE, durationFrames: SAMPLE_RATE },
	]);
	assert.throws(() => resolveExportClips(clipProject(), { startFrame: 3 * SAMPLE_RATE, endFrame: 4 * SAMPLE_RATE }), /No audio clip.*range/u);
});

test('non-audio clips and label, video and folder tracks never become clip deliveries', () => {
	const project = projectForRuntimeConsumers(clipProject());
	const audio = project.clips[0];
	const excluded = {
		...project,
		tracks: [
			{ id: 'labels', type: 'label', clipIds: ['first'] },
			{ id: 'video', type: 'video', clipIds: ['first'] },
			{ id: 'folder', type: 'folder', clipIds: ['first'] },
			{ id: 'audio', type: 'audio', clipIds: ['picture'] },
		],
		clips: [{ ...audio, id: 'first' }, { ...audio, id: 'picture', kind: 'video' }],
	};
	assert.equal(exportClipCount(excluded), 0);
});

test('looping clips deliver their full audible duration rather than a single source repeat', () => {
	const project = clipProject();
	const looping = { ...project, clips: project.clips.map((clip) => clip.id === 'first' ? {
		...clip, durationFrames: 4 * SAMPLE_RATE, sourceDurationFrames: SAMPLE_RATE,
		opaqueExtensions: { 'org.soundscaper.clip-loop/v1': { periodFrames: SAMPLE_RATE, offsetFrames: 0 } },
	} : clip) };
	const clips = resolveExportClips(looping, RANGE);
	assert.equal(clips[0].durationFrames, 4 * SAMPLE_RATE);
});

test('a clips plan archives indexed sanitized names and sizes each file independently', () => {
	const plan = createExportPlan(clipProject(), { mode: 'clips', format: 'wav', bitDepth: 16, date: '2026-10-05', sampleRate: 24_000 });
	assert.equal(plan.mode, 'clips');
	assert.deepEqual(plan.outputs.map(({ kind, fileName, trackId, includeMaster, respectMuteSolo }) => ({ kind, fileName, trackId, includeMaster, respectMuteSolo })), [
		{ kind: 'clip', fileName: '01-Take-A.wav', trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ kind: 'clip', fileName: '02-Take-A.wav', trackId: 'one', includeMaster: false, respectMuteSolo: false },
		{ kind: 'clip', fileName: '03-Audio-clip.wav', trackId: 'two', includeMaster: false, respectMuteSolo: false },
	]);
	assert.deepEqual(plan.outputs.map(({ outputFrames }) => outputFrames), [24_000 * 2, 24_000, 24_000 * 3]);
	assert.equal(plan.tailFrames, 0);
	assert.equal(plan.outputFrames, 24_000 * 3);
	assert.equal(plan.outputFileBytesPerRender, null);
	assert.equal(plan.archive?.fileName, 'Clip-delivery-clips-2026-10-05.zip');
	assert.deepEqual(plan.archive?.entries.map(({ expectedByteLength }) => expectedByteLength), plan.outputs.map(({ outputFileBytes }) => outputFileBytes));
	assert.deepEqual(plan.markers, []);
});

test('each clip render isolates its own samples and preserves its track effects', () => {
	const project = clipProject();
	const plan = createExportPlan(project, { mode: 'clips', format: 'wav', date: '2026-10-05' });
	const output = plan.outputs[0];
	const snapshot = createExportClipProject(stemProject(project, 'one'), output);
	assert.deepEqual(snapshot.clips.map(({ id }) => id), ['first']);
	assert.deepEqual(snapshot.sources.map(({ id }) => id), ['one-source', 'two-source']);
	assert.deepEqual(snapshot.tracks.map(({ clipIds }) => clipIds), [['first'], []]);
	assert.equal(snapshot.master.gain, 1);
	assert.deepEqual(snapshot.master.effects, []);
	assert.deepEqual(snapshot.tracks[0].effects, project.tracks[0].effects);
	assert.equal(project.clips.length, 3);
	assert.equal(project.tracks[0].mute, true);
	assert.equal(projectForRuntimeConsumers(snapshot), snapshot);
});

test('one clip renders and conforms under a single-output plan of its own span and BWF position', () => {
	const plan = createExportPlan(clipProject(), { mode: 'clips', format: 'bwf', date: '2026-10-05' });
	const output = plan.outputs[1];
	const single = createExportClipPlan(plan, output);
	assert.equal(single.mode, 'mix');
	assert.equal(single.archive, null);
	assert.equal(single.outputFrames, SAMPLE_RATE);
	assert.equal(single.outputBytesPerRender, SAMPLE_RATE * 2 * 4);
	assert.deepEqual(single.range, { startFrame: 5 * SAMPLE_RATE, endFrame: 6 * SAMPLE_RATE, durationFrames: SAMPLE_RATE });
	assert.equal(single.bext?.timeReference, String(5 * SAMPLE_RATE));
	assert.deepEqual(single.outputs, [output]);
});

test('clips refuse mix-only containers and normalization and unavailable clips', () => {
	assert.throws(() => createExportPlan(clipProject(), { mode: 'clips', format: 'bw64' }), /mix-only/u);
	assert.throws(() => createExportPlan(clipProject(), { mode: 'clips', loudnessNormalization: 'ebu-r128' }), /mix-only.*clips/u);
	assert.equal(exportClipCount({}), 0);
	assert.throws(() => createExportClipProject(clipProject(), { trackId: 'one', clipId: 'missing' }), /clip.*missing/u);
});


test('overlapping clips render independently instead of charging every clip at once', () => {
	const clips = Array.from({ length: 100 }, (_, index) => ({
		id: `clip-${String(index)}`, kind: 'audio', sourceId: 'long', title: 'Layer',
		timelineStartFrame: SAMPLE_RATE, sourceStartFrame: 0,
		durationFrames: 10 * SAMPLE_RATE, sourceDurationFrames: 10 * SAMPLE_RATE,
	}));
	const project = {
		schemaVersion: 9, id: 'layers', title: 'Layers', sampleRate: SAMPLE_RATE, masterChannels: 2,
		sources: [{ id: 'long', frameCount: SAMPLE_RATE * 3_600, channelCount: 2, sampleRate: SAMPLE_RATE, chunkFrames: 65_536 }],
		clips, tracks: [{ id: 'track', type: 'audio', clipIds: clips.map(({ id }) => id), effects: [] }],
		metadata: {}, master: { effects: [] }, mixer: { groups: [], sends: [], routes: {} },
	};
	const plan = createExportPlan(project, { mode: 'clips', mobile: true, date: '2026-10-05' });
	const render = plan.render as ReturnType<typeof chooseRenderStrategy>;
	const firstSnapshot = createExportClipProject(project, plan.outputs[0]);
	assert.equal(render.strategy, 'offline');
	assert.equal(render.livePcmBytes, estimateExportSourceWorkingSetBytes(firstSnapshot, [plan.outputs[0].range!]));
	assert.equal(createExportPlan(project, { mobile: true, includeTail: false }).render.strategy, 'realtime-stream');
	const expectedAdmission = planExportOfflineRenderStrategyAdmission({
		project: firstSnapshot, rangeStartFrame: SAMPLE_RATE, requestedRenderFrames: 10 * SAMPLE_RATE,
		trackId: 'track', includeMaster: false,
	});
	assert.equal(render.offlineRenderAdmission?.peakUsefulBinaryBytes, expectedAdmission.peakUsefulBinaryBytes);
});


test('clip isolation transfers folder projection trust into the exact engine snapshot', () => {
	const audio = clipProject();
	const project = createSoundscaperProject({
		id: audio.id, title: audio.title, now: NOW, sampleRate: SAMPLE_RATE,
		tracks: audio.tracks, clips: audio.clips.map((clip) => ({ ...clip, sequenceId: 'main' })), sources: audio.sources, primarySequenceId: 'main',
		trackFolders: [{ id: 'folder', name: 'Muted folder', mute: true }],
		sequences: [{ id: 'main', trackNodes: [
			{ kind: 'folder', id: 'folder', parentFolderId: null },
			{ kind: 'track', id: 'one', parentFolderId: 'folder' },
			{ kind: 'track', id: 'two', parentFolderId: null },
		] }],
	});
	const delivered = projectTrackFolderMediaStateV12(project);
	const plan = createExportPlan(delivered, { mode: 'clips', date: '2026-10-05' });
	const snapshot = createExportClipProject(stemProject(delivered, 'one'), plan.outputs[0]);
	assert.equal(isTrackFolderMediaStateProjectionV12(snapshot), true);
	assert.equal(projectTrackFolderMediaStateV12(snapshot), snapshot);
	assert.equal(projectForRuntimeConsumers(snapshot), snapshot);
	assert.equal(snapshot.tracks[0].mute, false);
});


test('musical clip boundaries use resolved beats without changing persisted timing authority', () => {
	const project = createCurrentAudioEditorProject({
		id: 'musical-delivery', now: NOW, sampleRate: SAMPLE_RATE,
		sources: [{ id: 'source', storageKey: 'pcm/source', frameCount: 4 * SAMPLE_RATE, channelCount: 1 }],
		clips: [{
			id: 'musical', kind: 'audio', sourceId: 'source', sourceStartFrame: 0, sourceDurationFrames: SAMPLE_RATE,
			anchor: 'musical', musicalExtent: 'beat',
			musicalStartBeat: { num: 3, den: 1 }, musicalDurationBeats: { num: 2, den: 1 },
		}],
		tracks: [{ id: 'track', type: 'audio', clipIds: ['musical'] }],
	});
	const before = structuredClone(project);
	assert.equal(Object.hasOwn(project.clips[0], 'timelineStartFrame'), false);
	assert.equal(Object.hasOwn(project.clips[0], 'durationFrames'), false);
	const [clip] = resolveExportClips(project, { startFrame: 0, endFrame: 4 * SAMPLE_RATE });
	assert.deepEqual([clip.startFrame, clip.endFrame, clip.durationFrames], [72_000, 120_000, 48_000]);
	assert.equal(exportClipCount(project), 1);
	const snapshot = createExportClipProject(project, { trackId: 'track', clipId: 'musical' });
	assert.equal(snapshot.clips[0].timelineStartFrame, 72_000);
	assert.equal(snapshot.clips[0].durationFrames, 48_000);
	assert.deepEqual(project, before);
});


test('clip file names follow a renamed clip title instead of unrelated name metadata', () => {
	const project = clipProject();
	const renamed = { ...project, clips: project.clips.map((clip) => ({
		...clip, title: clip.id === 'first' ? 'Renamed / take' : clip.title, name: 'Unrelated metadata',
	})) };
	assert.equal(resolveExportClips(renamed, RANGE)[0].name, 'Renamed / take');
	const plan = createExportPlan(renamed, { mode: 'clips', format: 'wav', date: '2026-10-05' });
	assert.equal(plan.outputs[0].fileName, '01-Renamed-take.wav');
});


test('an empty clip title uses the clip filename fallback', () => {
	const project = clipProject();
	const emptyTitle = { ...project, clips: project.clips.map((clip) => ({
		...clip, title: clip.id === 'first' ? '' : clip.title,
	})) };
	const plan = createExportPlan(emptyTitle, { mode: 'clips', format: 'wav', date: '2026-10-05' });
	assert.equal(plan.outputs[0].fileName, '01-clip.wav');
});
