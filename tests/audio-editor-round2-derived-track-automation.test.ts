/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import type { AutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { copyDerivedTrackStripAutomation } from '../src/common/editor/derived-track-strip-automation.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

for (const selection of ['clip', 'range', 'stereo']) test(`derived track splitting preserves independently editable strip automation for ${selection}`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round2-derived-automation-${selection}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: selection === 'stereo' ? 2 : 1, durationSeconds: 0.8, frequency: 440 });
	const originalTrackId = controller.getSnapshot().selectedTrackId!;
	const clipId = controller.getSnapshot().selectedClipId!;
	const lane: AutomationLaneV21 = {
		id: 'authored-gain', address: { kind: 'strip', strip: { kind: 'track', id: originalTrackId }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'first', position: 0, value: 0.5 }, { id: 'last', position: 48_000, value: 0.75 }],
		segments: [{ kind: 'linear' }],
	};
	controller.actions.edit.commit({ type: 'automation-lane/set', laneId: lane.id, expected: null, lane });
	controller.actions.timeline.selectClip(clipId);
	if (selection === 'range') controller.actions.timeline.setSelection(10_000, 30_000, { trackIds: [originalTrackId] });
	else controller.actions.transport.seek(20_000);
	let copyId: string;
	if (selection === 'stereo') {
		const split = await controller.actions.track.splitStereoLR(originalTrackId);
		assert.ok(split);
		copyId = split.rightTrackId;
	} else {
		controller.actions.edit.splitIntoNewTrack();
		copyId = controller.getSnapshot().selectedTrackId!;
	}
	const lanes = controller.getSnapshot().project!.automationLanes as readonly AutomationLaneV21[];
	const copied = lanes.find(value => value.address.kind === 'strip' && value.address.strip.kind === 'track' && value.address.strip.id === copyId);
	assert.ok(copied);
	assert.notEqual(copied.id, lane.id);
	assert.deepEqual(copied.points.map(point => [point.position, point.value]), lane.points.map(point => [point.position, point.value]));
	assert.equal(copied.points.some(point => lane.points.some(original => original.id === point.id)), false);
	assert.deepEqual(copied.segments, lane.segments);
	assert.deepEqual(lanes.find(value => value.id === lane.id), lane);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.automationLanes, [lane]);
	controller.actions.edit.redo();
	assert.equal((controller.getSnapshot().project!.automationLanes as readonly AutomationLaneV21[]).length, 2);
});

test('derived strip copying retains beat coordinates and mute while channel splitting resets pan', () => {
	const base = { timebase: 'musical-beats', points: [{ id: 'authored', position: { num: 3, den: 2 }, value: 1 }], segments: [] } as const;
	const lanes = ['gain', 'pan', 'mute'].map((parameterId, index) => normalizeAutomationLaneV21({
		...base, id: `lane-${index}`, address: { kind: 'strip', strip: { kind: 'track', id: 'source' }, parameterId },
	}));
	const unrelated = normalizeAutomationLaneV21({ ...base, id: 'master', address: { kind: 'strip', strip: { kind: 'master' }, parameterId: 'gain' } });
	let identity = 0;
	const project = { automationLanes: [...lanes, unrelated] };
	const before = structuredClone(project);
	const commands = copyDerivedTrackStripAutomation(project, 'source', 'copy', prefix => `${prefix}-${identity++}`);
	assert.equal(commands.length, 3);
	for (const command of commands) {
		assert.equal(command.type, 'automation-lane/set');
		if (command.type !== 'automation-lane/set') throw new Error('Unexpected command');
		const copied = normalizeAutomationLaneV21(command.lane);
		assert.equal(copied.timebase, 'musical-beats');
		assert.deepEqual(copied.points.map(point => [point.position, point.value]), [[{ num: 3, den: 2 }, 1]]);
	}
	const split = copyDerivedTrackStripAutomation(project, 'source', 'right', prefix => `${prefix}-${identity++}`, true);
	assert.equal(split.length, 2);
	assert.deepEqual(project, before);
});
