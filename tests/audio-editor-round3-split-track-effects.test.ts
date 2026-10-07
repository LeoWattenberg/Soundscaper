/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { copyDerivedTrackProcessors } from '../src/common/editor/derived-track-processors.ts';
import type { ControllerRackEffect } from '../src/common/editor/controller/effects/internal/rack-effect-service-types.ts';
import { findControllerTrack, type ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

for (const mode of ['clip', 'range'] as const) test(`Split into new track copies independent processors for ${mode} selection`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const projectRuntime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY,
		projectRuntime, sessionController: projectRuntime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: `round3-split-processors-${mode}` }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	await controller.actions.generators.generate('tone', { amplitude: 0.4, channelCount: 1, durationSeconds: 0.8, frequency: 440 });
	const sourceTrackId = controller.getSnapshot().selectedTrackId!;
	const clipId = controller.getSnapshot().selectedClipId!;
	controller.actions.effects.add({ scope: 'track', trackId: sourceTrackId, type: 'lowpass', options: { params: { frequency: 1200, q: 1.5 } } });
	controller.actions.effects.add({ scope: 'track', trackId: sourceTrackId, type: 'delay', options: { enabled: false, params: { time: 0.25, feedback: 0.4, mix: 0.3 } } });
	controller.actions.timeline.selectClip(clipId);
	if (mode === 'range') controller.actions.timeline.setSelection(10_000, 30_000, { trackIds: [sourceTrackId] });
	else controller.actions.transport.seek(20_000);
	const before = controller.getSnapshot();
	const original = findControllerTrack(projectRuntime.projectForCommandConsumers(before.project!) as ControllerProject, sourceTrackId)!;
	controller.actions.edit.splitIntoNewTrack();
	const after = controller.getSnapshot();
	const targetTrackId = after.selectedTrackId!;
	assert.notEqual(targetTrackId, sourceTrackId);
	const copied = findControllerTrack(projectRuntime.projectForCommandConsumers(after.project!) as ControllerProject, targetTrackId)!;
	assert.equal(copied.type, 'audio');
	assert.equal(original.type, 'audio');
	if (copied.type !== 'audio' || original.type !== 'audio') assert.fail('Expected audio tracks.');
	assert.ok(Array.isArray(copied.effects)); assert.ok(Array.isArray(original.effects));
	const copiedEffects = copied.effects as readonly ControllerRackEffect[], originalEffects = original.effects as readonly ControllerRackEffect[];
	assert.deepEqual(copiedEffects.map(({ type, enabled, params }) => ({ type, enabled, params })),
		originalEffects.map(({ type, enabled, params }) => ({ type, enabled, params })));
	assert.ok(copiedEffects.every(effect => !originalEffects.some(value => value.id === effect.id)));
	assert.equal(after.history.undoEntries.length, before.history.undoEntries.length + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, before.project!.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.getSnapshot().project!.tracks, after.project!.tracks);
});

test('copied processors retain nested state and remap their existing effect automation without aliases', () => {
	const sourceTrack = { id: 'source', effects: [{ id: 'processor', type: 'lowpass',
		params: { frequency: 1500 }, context: { control: { trackId: 'other' } }, state: { values: [1, 2] } }] };
	const lane = normalizeAutomationLaneV21({ id: 'curve', address: { kind: 'effect',
		strip: { kind: 'track', id: 'source' }, effectId: 'processor', parameterId: 'frequency' },
		timebase: 'absolute-samples', points: [{ id: 'point', position: 1234, value: 1000 }], segments: [] });
	let next = 0;
	const copied = copyDerivedTrackProcessors({ automationLanes: [lane] }, sourceTrack, 'copy', prefix => `${prefix}-${++next}`);
	assert.deepEqual(copied.effects[0], { ...sourceTrack.effects[0], id: 'effect-1' });
	assert.notEqual(copied.effects[0]!.params, sourceTrack.effects[0]!.params);
	assert.notEqual(copied.effects[0]!.context.control, sourceTrack.effects[0]!.context.control);
	assert.notEqual(copied.effects[0]!.state.values, sourceTrack.effects[0]!.state.values);
	const command = copied.commands[0];
	if (command?.type !== 'automation-lane/set') assert.fail('Expected copied processor curve.');
	const copiedLane = normalizeAutomationLaneV21(command.lane);
	assert.deepEqual(copiedLane.address, { ...lane.address, strip: { kind: 'track', id: 'copy' }, effectId: 'effect-1' });
	assert.equal(copiedLane.points[0]?.position, 1234);
	assert.notEqual(copiedLane.id, lane.id);
	assert.notEqual(copiedLane.points[0]?.id, lane.points[0]?.id);
	assert.equal(sourceTrack.effects[0]?.id, 'processor');
});
