/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import type { LabelTrackLeaf } from '../src/common/editor/project-media-types.ts';

async function fixture(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `selected-label-clipboard-${context.name}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.25, channelCount: 1, durationSeconds: 0.2, frequency: 440 });
	return controller;
}

function labelTrack(controller: Awaited<ReturnType<typeof fixture>>, id?: string): LabelTrackLeaf {
	const tracks = controller.getSnapshot().project?.tracks;
	assert.ok(tracks);
	const track = tracks.find((track): track is LabelTrackLeaf => 'type' in track && track.type === 'label'
		&& 'labels' in track && Array.isArray(track.labels) && (id === undefined || track.id === id));
	assert.ok(track);
	return track;
}

test('selected labels precede a lingering media range and paste as one native edit with fresh identities', async context => {
	const controller = await fixture(context);
	const beforeLabels = controller.getSnapshot().project!;
	const pointId = controller.actions.labels.add(null, { title: 'Point', startFrame: 1200, endFrame: 1200 });
	const labelsTrack = labelTrack(controller);
	const regionId = controller.actions.labels.add(labelsTrack.id, { title: 'Region', startFrame: 2400, endFrame: 3600 });
	assert.ok(pointId && regionId);
	controller.actions.labels.select(labelsTrack.id, pointId);
	controller.actions.labels.select(labelsTrack.id, regionId, { additive: true });
	await controller.actions.edit.copy();
	assert.deepEqual(controller.getSnapshot().selectedLabels.map(ref => ref.labelId), [pointId, regionId]);
	controller.actions.transport.seek(4800);
	const beforePaste = controller.getSnapshot();
	await controller.actions.edit.paste();
	const pasted = controller.getSnapshot();
	const track = labelTrack(controller, labelsTrack.id);
	assert.deepEqual(track.labels.map(label => [label.title, label.startFrame, label.endFrame]), [
		['Point', 1200, 1200], ['Region', 2400, 3600], ['Point', 4800, 4800], ['Region', 6000, 7200],
	]);
	assert.deepEqual(pasted.project!.clips, beforeLabels.clips, 'label clipboard never duplicates or edits audio');
	assert.equal(pasted.history.undoEntries.length, beforePaste.history.undoEntries.length + 1);
	const pastedIds = pasted.selectedLabels.map(ref => ref.labelId);
	assert.equal(pastedIds.length, 2);
	assert.ok(pastedIds.every(id => id !== pointId && id !== regionId));
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, beforePaste.project!.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, pasted.project!.tracks);
});

test('media, range and track selections take clipboard ownership back from labels, and project changes clear them', async context => {
	const controller = await fixture(context);
	const mediaClipId = controller.getSnapshot().selectedClipId!;
	const mediaTrackId = controller.getSnapshot().selectedTrackId!;
	const labelId = controller.actions.labels.add(null, { title: 'Point', startFrame: 1200, endFrame: 1200 });
	const track = labelTrack(controller);
	assert.ok(labelId);
	controller.actions.labels.select(track.id, labelId);
	await controller.actions.edit.copy();
	controller.actions.timeline.selectClip(mediaClipId);
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
	await controller.actions.edit.copy();
	controller.actions.transport.seek(12_000);
	await controller.actions.edit.paste();
	assert.equal(controller.getSnapshot().project!.clips.length, 2, 'ordinary media clipboard remains authoritative');
	const clips = controller.getSnapshot().project!.clips;
	assert.ok(clips[0] && 'sourceId' in clips[0] && clips[1] && 'sourceId' in clips[1]);
	assert.equal(clips[0]?.sourceId, clips[1]?.sourceId, 'native media source identity is preserved');
	controller.actions.labels.select(track.id, labelId);
	controller.actions.timeline.setExactSelection(0, 2400);
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
	controller.actions.labels.select(track.id, labelId);
	controller.actions.timeline.selectTrack(mediaTrackId);
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
	controller.actions.labels.select(track.id, labelId);
	await controller.actions.project.create();
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
});

test('locked label Cut preserves the old media clipboard and a successful Cut publishes only after native admission', async context => {
	const controller = await fixture(context);
	await controller.actions.edit.copy();
	const labelId = controller.actions.labels.add(null, { title: 'Protected', startFrame: 1200, endFrame: 2400 });
	const track = labelTrack(controller);
	assert.ok(labelId);
	controller.actions.labels.select(track.id, labelId);
	controller.actions.edit.commit({ type: 'track/update', trackId: track.id, changes: { locked: true } });
	const beforeCut = controller.getSnapshot();
	await controller.actions.edit.cut();
	assert.equal(controller.getSnapshot().status.state, 'error');
	assert.deepEqual(controller.getSnapshot().project, beforeCut.project);
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeCut.history.undoEntries.length);
	const audioTrackId = beforeCut.project!.tracks!.find(track => 'type' in track && track.type === 'audio')!.id;
	controller.actions.timeline.selectTrack(audioTrackId);
	controller.actions.transport.seek(12_000);
	await controller.actions.edit.paste();
	assert.equal(controller.getSnapshot().project!.clips.length, 2, 'refused Cut did not replace the old media clipboard');
	controller.actions.edit.commit({ type: 'track/update', trackId: track.id, changes: { locked: false } });
	controller.actions.labels.select(track.id, labelId);
	const beforeSuccessfulCut = controller.getSnapshot();
	await controller.actions.edit.cut();
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeSuccessfulCut.history.undoEntries.length + 1);
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
	controller.actions.transport.seek(24_000);
	await controller.actions.edit.paste();
	const afterPaste = controller.getSnapshot();
	const labels = labelTrack(controller, track.id);
	assert.deepEqual(labels.labels.map(label => [label.title, label.startFrame, label.endFrame]), [['Protected', 24_000, 25_200]]);
	assert.equal(afterPaste.project!.clips.length, 2, 'successful label Cut replaced the clipboard without editing media');
});

test('a label clipboard crosses native project tabs and scales each boundary to the destination sample rate', async context => {
	const controller = await fixture(context);
	const pointId = controller.actions.labels.add(null, { title: 'Point', startFrame: 1201, endFrame: 1201 });
	const originTrack = labelTrack(controller);
	const regionId = controller.actions.labels.add(originTrack.id, { title: 'Range', color: 'red', startFrame: 2404, endFrame: 3608 });
	assert.ok(pointId && regionId);
	controller.actions.labels.select(originTrack.id, pointId);
	controller.actions.labels.select(originTrack.id, regionId, { additive: true });
	await controller.actions.edit.copy();
	await controller.actions.project.create({ sampleRate: 24_000 });
	assert.equal(controller.getSnapshot().project!.sampleRate, 24_000);
	assert.deepEqual(controller.getSnapshot().selectedLabels, []);
	const beforeNoTrack = controller.getSnapshot();
	await controller.actions.edit.paste();
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeNoTrack.history.undoEntries.length,
		'upstream does not synthesize a label track on Paste');
	const targetSeed = controller.actions.labels.add(null, { title: 'Destination', startFrame: 0, endFrame: 0 });
	assert.ok(targetSeed);
	const target = labelTrack(controller);
	controller.actions.transport.seek(12_000);
	await controller.actions.edit.paste();
	const pasted = labelTrack(controller);
	assert.deepEqual(pasted.labels.map(label => [label.title, label.startFrame, label.endFrame]), [
		['Destination', 0, 0], ['Point', 12_000, 12_000], ['Range', 12_602, 13_204],
	]);
	assert.equal(pasted.labels[2]?.color, 'red');
	assert.ok(controller.getSnapshot().selectedLabels.every(ref => ref.trackId === target.id));
	assert.equal(controller.getSnapshot().project!.clips.length, 0, 'label-only payload carries no media roots across tabs');
	controller.actions.edit.commit({ type: 'track/update', trackId: target.id, changes: { locked: true } });
	const beforeLockedPaste = controller.getSnapshot();
	assert.equal(beforeLockedPaste.history.pasteTargetLocked, true);
	await controller.actions.edit.paste();
	assert.equal(controller.getSnapshot().status.state, 'error');
	assert.deepEqual(controller.getSnapshot().project, beforeLockedPaste.project);
	assert.equal(controller.getSnapshot().history.undoEntries.length, beforeLockedPaste.history.undoEntries.length);
});
