/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { selectLabeledAudioEditTrackIds } from '../src/common/editor/labeled-audio-regions.ts';

import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { createMemoryStore } from './helpers/audio-editor-memory-store-baseline.js';
import { COPY, createAudioEditorController, createMemoryEngine } from './helpers/audio-editor-controller-harness.js';

interface FixtureTrack {
	readonly id: string;
	readonly type: string;
	readonly name: string;
	readonly clipIds: readonly string[];
	readonly gain: number;
	readonly pan: number;
	readonly mute: boolean;
	readonly solo: boolean;
	readonly effectsActive: boolean;
	readonly displayMode: string;
	readonly color: string;
	readonly envelope: readonly Readonly<{ frame: number; value: number }>[];
	readonly effects: readonly (Readonly<Record<string, unknown>> & { readonly id: string })[];
	readonly labels: readonly Readonly<{ id: string; title: string; startFrame: number; endFrame: number }>[];
}

interface FixtureProject {
	readonly tracks: readonly FixtureTrack[];
	readonly clips: readonly Readonly<{ id: string; timelineStartFrame: number; sourceStartFrame: number; durationFrames: number }>[];
	readonly selection: Readonly<{ startFrame: number; endFrame: number; trackIds: readonly string[]; clipIds: readonly string[]; frequencyRange?: unknown }>;
}

/** These fixtures seed resolved audio and labels behind the controller's opaque snapshot port. */
function snapshot(controller: ReturnType<typeof createAudioEditorController>) {
	const value = controller.getSnapshot();
	assert.ok(value.project);
	return { ...value, project: value.project as unknown as FixtureProject };
}

async function fixture() {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const controller = createAudioEditorController(null, {
		headless: true, copy: COPY, locale: 'en',
		store: createMemoryStore() as unknown as Options['store'],
		engine: createMemoryEngine() as unknown as Options['engine'],
		ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'],
	});
	await controller.ready;
	const first = snapshot(controller).project.tracks[0]!.id;
	const second = controller.actions.track.add({ name: 'Second' })!;
	const unrelated = controller.actions.track.add({ name: 'Unrelated' })!;
	controller.actions.edit.commit({ type: 'batch', commands: [
		{ type: 'source/add', source: {
			id: 'duplicate-source', storageKey: 'duplicate-source', name: 'loop.wav',
			mimeType: 'audio/wav', frameCount: 4_000, channelCount: 1,
		} },
		{ type: 'clip/add', trackId: first, clip: {
			id: 'first-clip', sourceId: 'duplicate-source', title: 'First',
			timelineStartFrame: 500, sourceStartFrame: 100, durationFrames: 1_000,
		} },
		{ type: 'clip/add', trackId: second, clip: {
			id: 'second-clip', sourceId: 'duplicate-source', title: 'Second',
			timelineStartFrame: 1_000, sourceStartFrame: 1_500, durationFrames: 1_000,
		} },
	] });
	return { controller, first, second, unrelated };
}

void test('Duplicate puts the selected clip on a new track at its original position with atomic undo', async (context) => {
	const { controller, first, second, unrelated } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.selectClip('first-clip');
	const before = snapshot(controller).project;
	controller.actions.edit.duplicate();
	const duplicated = snapshot(controller);
	assert.equal(duplicated.project.tracks.length, 4, JSON.stringify(duplicated.status));
	assert.deepEqual(duplicated.project.tracks.slice(0, 3).map((track) => track.id), [first, second, unrelated]);
	const copy = duplicated.project.clips.find((clip) => clip.id !== 'first-clip' && clip.id !== 'second-clip');
	assert.ok(copy);
	assert.equal(copy.timelineStartFrame, 500);
	assert.equal(copy.sourceStartFrame, 100);
	assert.equal(copy.durationFrames, 1_000);
	assert.deepEqual(duplicated.project.tracks[3]!.clipIds, [copy.id]);
	assert.equal(duplicated.selectedTrackId, duplicated.project.tracks[3]!.id);
	assert.deepEqual(duplicated.project.selection.clipIds, ['first-clip', copy.id]);
	assert.deepEqual(duplicated.project.clips.find((clip) => clip.id === 'first-clip'), before.clips[0]);
	controller.actions.edit.undo();
	assert.deepEqual(snapshot(controller).project.clips, before.clips);
	assert.deepEqual(snapshot(controller).project.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(snapshot(controller).project.clips, duplicated.project.clips);
});

void test('Duplicate copies a drawn range despite empty clip IDs and preserves its timeline position', async (context) => {
	const { controller, first } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.setSelection(750, 1_250, { trackIds: [first] });
	const frequencyRange = { minimumFrequency: 300, maximumFrequency: 3_000 };
	controller.actions.edit.commit({ type: 'selection/set', startFrame: 750, endFrame: 1_250, trackIds: [first], clipIds: [], frequencyRange });
	assert.deepEqual(snapshot(controller).project.selection.clipIds, []);
	controller.actions.edit.duplicate();
	const project = snapshot(controller).project;
	assert.equal(project.tracks.length, 4, JSON.stringify(snapshot(controller).status));
	const copied = project.clips.find((clip) => clip.id !== 'first-clip' && clip.id !== 'second-clip');
	assert.ok(copied);
	assert.deepEqual([copied.timelineStartFrame, copied.sourceStartFrame, copied.durationFrames], [750, 350, 500]);
	assert.deepEqual([project.selection.startFrame, project.selection.endFrame], [750, 1_250]);
	assert.deepEqual(project.selection.trackIds, [first, project.tracks[3]!.id]);
	assert.deepEqual(project.selection.clipIds, []);
	assert.deepEqual(project.selection.frequencyRange, frequencyRange);
});

void test('Duplicate creates one new track per selected source in project order, leaving the clipboard intact', async (context) => {
	const { controller, first, second } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.timeline.setSelection(500, 750, { trackIds: [first] });
	controller.actions.edit.copy();
	const clipboard = snapshot(controller).history.hasClipboard;
	controller.actions.timeline.setSelection(750, 1_750, { trackIds: [second, first] });
	controller.actions.edit.duplicate();
	const project = snapshot(controller).project;
	assert.equal(project.tracks.length, 5);
	assert.equal(snapshot(controller).history.hasClipboard, clipboard);
	const firstCopy = project.clips.find((clip) => project.tracks[3]!.clipIds.includes(clip.id));
	const secondCopy = project.clips.find((clip) => project.tracks[4]!.clipIds.includes(clip.id));
	assert.ok(firstCopy);
	assert.ok(secondCopy);
	assert.deepEqual([firstCopy.timelineStartFrame, firstCopy.durationFrames], [750, 750]);
	assert.deepEqual([secondCopy.timelineStartFrame, secondCopy.durationFrames], [1_000, 750]);
	assert.deepEqual(project.selection.trackIds, [first, second, ...project.tracks.slice(3).map((track) => track.id)]);
	controller.actions.timeline.selectTrack(first);
	controller.actions.timeline.setSelection(2_500, 2_500, { trackIds: [first] });
	controller.actions.transport.seek(2_500);
	controller.actions.edit.pasteOverlap();
	const pasted = snapshot(controller).project.clips.find((clip) => clip.timelineStartFrame === 2_500);
	assert.ok(pasted);
	assert.equal(pasted.durationFrames, 250, 'Duplicate must retain the earlier copied passage');
});

void test('Duplicate retains the source track mixer, envelope and independent effects settings', async (context) => {
	const { controller, first } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.edit.commit({ type: 'track/update', trackId: first, changes: {
		gain: 0.4, pan: -0.25, mute: true, solo: true, effectsActive: false,
		displayMode: 'multiview', color: '#113355',
		envelope: [{ frame: 0, value: 0.5 }, { frame: 2_000, value: 1 }],
	} });
	controller.actions.edit.commit({ type: 'effect/add', scope: 'track', trackId: first, effect: createEffect('highpass', { id: 'source-effect' }) });
	controller.actions.timeline.selectClip('first-clip');
	const source = snapshot(controller).project.tracks.find((track) => track.id === first)!;
	controller.actions.edit.duplicate();
	const copied = snapshot(controller).project.tracks[3]!;
	assert.deepEqual(
		[copied.name, copied.gain, copied.pan, copied.mute, copied.solo, copied.effectsActive, copied.displayMode, copied.color, copied.envelope],
		[source.name, source.gain, source.pan, source.mute, source.solo, source.effectsActive, source.displayMode, source.color, source.envelope],
	);
	assert.equal(copied.effects.length, 1);
	assert.notEqual(copied.effects[0]!.id, source.effects[0]!.id);
	assert.deepEqual({ ...copied.effects[0], id: source.effects[0]!.id }, source.effects[0]);
	assert.deepEqual(snapshot(controller).project.tracks.find((track) => track.id === first), source);
});

void test('Duplicate includes selected label tracks and clips region labels to the time range', async (context) => {
	const { controller, first, second, unrelated } = await fixture();
	context.after(async () => { await controller.dispose(); });
	const labels = controller.actions.track.addLabel({ name: 'Annotations' })!;
	for (const [id, startFrame, endFrame] of [
		['crossing', 500, 1_500], ['inside', 900, 1_000], ['start-point', 750, 750],
		['end-point', 1_250, 1_250], ['outside', 100, 200], ['touch-start', 500, 750], ['touch-end', 1_250, 1_500],
	] as const) controller.actions.labels.add(labels, { id, startFrame, endFrame, title: id });
	const before = snapshot(controller).project.tracks.find((track) => track.id === labels)!;
	controller.actions.timeline.setSelection(750, 1_250, { trackIds: [first, labels] });
	controller.actions.edit.duplicate();
	const project = snapshot(controller).project;
	assert.equal(project.tracks.length, 6);
	const copied = project.tracks[5]!;
	assert.equal(copied.type, 'label');
	for (const field of ['clipIds', 'effects', 'armed']) {
		assert.equal(Object.hasOwn(copied, field), false, `Label copies must omit the audio-only ${field} field`);
	}
	assert.deepEqual(copied.labels.map((label) => [label.title, label.startFrame, label.endFrame]), [
		['crossing', 750, 1_250], ['start-point', 750, 750], ['inside', 900, 1_000], ['end-point', 1_250, 1_250],
	]);
	assert.equal(copied.labels.some((label) => before.labels.some((original) => original.id === label.id)), false);
	assert.deepEqual(project.tracks.find((track) => track.id === labels), before);
	assert.deepEqual(project.selection.trackIds, [first, labels, project.tracks[4]!.id, copied.id]);
	assert.deepEqual(selectLabeledAudioEditTrackIds(project, [copied.id]), [first, second, unrelated, project.tracks[4]!.id],
		'Labeled audio edits from a duplicated label track still target every audio track');
});

void test('Duplicate preserves overlapping clips on one source track without altering the originals', async (context) => {
	const { controller, first } = await fixture();
	context.after(async () => { await controller.dispose(); });
	controller.actions.edit.commit({ type: 'clip/add', trackId: first, clip: {
		id: 'overlapping-clip', sourceId: 'duplicate-source', title: 'Overlap',
		timelineStartFrame: 900, sourceStartFrame: 2_500, durationFrames: 300,
	} });
	controller.actions.timeline.setSelection(500, 1_500, { trackIds: [first] });
	const before = snapshot(controller).project;
	controller.actions.edit.duplicate();
	const project = snapshot(controller).project;
	assert.equal(project.tracks.length, 4, JSON.stringify(snapshot(controller).status));
	const copiedIds = project.tracks[3]!.clipIds;
	assert.equal(copiedIds.length, 2);
	assert.deepEqual(project.clips.filter((clip) => copiedIds.includes(clip.id)).map((clip) => [clip.timelineStartFrame, clip.durationFrames]), [[500, 1_000], [900, 300]]);
	assert.deepEqual(project.clips.filter((clip) => !copiedIds.includes(clip.id)), before.clips);
});
