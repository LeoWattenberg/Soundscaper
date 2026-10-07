/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareGroupedLoopTrimCommand } from '../src/common/editor/controller/clip-video/internal/clip/grouped-loop-trim-command.ts';
import { createClipTransformService } from '../src/common/editor/controller/clip-video/internal/clip/clip-transform-service.ts';
import type { ClipTransformProject } from '../src/common/editor/controller/clip-video/internal/clip/clip-domain-types.ts';
import { clipLoopUpdateFields, readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';

function fixture(reversed = false, companionLoop = true) {
	const sources = [0, 1].map(index => createAudioSource({ id: `source-${String(index)}`, storageKey: `source-${String(index)}`,
		name: 'Recording', sampleRate: 48_000, frameCount: 96_000, channelCount: 1 }));
	const clips = sources.map((source, index) => {
		const clip = createAudioClip({ id: `clip-${String(index)}`, sourceId: source.id, groupId: 'recordings', timelineStartFrame: 0,
			durationFrames: 38_400, sourceStartFrame: 4800, sourceDurationFrames: 38_400, reversed });
		const frames = { ...clip, timelineStartFrame: 0, durationFrames: 38_400, sourceStartFrame: 4800, sourceDurationFrames: 38_400 };
		return index === 0 || companionLoop ? { ...frames, ...clipLoopUpdateFields(frames, { periodFrames: 38_400, durationFrames: 76_800 }) } : frames;
	});
	const document = createSoundscaperProject({ id: 'grouped-loops', title: 'Recording loops', now: '2026-10-07T00:00:00.000Z', sources, clips,
		tracks: clips.map((clip, index) => createAudioTrack({ id: `track-${String(index)}`, name: 'Recording', clipIds: [clip.id] })) });
	const runtime = createSoundscaperProjectRuntimeSelection();
	let history = runtime.createHistory(document);
	let commands = 0;
	const service = createClipTransformService({ lifetime: { assertActive() {} },
		copy: { audioClipNotFound: 'Missing clip', track: 'Track', timelineFramesFinite: 'Finite frames required' },
		getProject: () => runtime.projectForCommandConsumers(history.present) as ClipTransformProject,
		getSelectedClipId: () => 'clip-0', editingBlocked: () => false, createId: prefix => `${prefix}-new`, snapTimelineFrame: Number,
		activeSelection: () => null, commit: command => { history = runtime.executeCommand(history, command); commands += 1; } });
	return { service, present: () => history.present, commandCount: () => commands,
		undo: () => { history = runtime.undo(history); }, redo: () => { history = runtime.redo(history); } };
}

for (const edge of ['left', 'right'] as const) for (const reversed of [false, true]) test(`grouped loops share ${edge} source trims when reversed=${String(reversed)}`, () => {
	const edit = fixture(reversed);
	const original = edit.present().clips;
	edit.service.trimClips('clip-0', edge === 'left' ? { timelineStartFrame: 4800, durationFrames: 72_000 } : { durationFrames: 72_000 });
	const after = edit.present().clips;
	assert.deepEqual(after.map(clip => readClipLoop(clip)?.periodFrames), [33_600, 33_600]);
	assert.deepEqual(after.map(clip => 'sourceDurationFrames' in clip ? clip.sourceDurationFrames : null), [33_600, 33_600]);
	assert.deepEqual(after.map(clip => 'sourceStartFrame' in clip ? clip.sourceStartFrame : null), edge === 'left' !== reversed ? [9600, 9600] : [4800, 4800]);
	assert.deepEqual(after.map(clip => 'durationFrames' in clip ? [clip.timelineStartFrame, clip.durationFrames] : null), [[0, 76_800], [0, 76_800]]);
	assert.equal(edit.commandCount(), 1);
	edit.undo(); assert.deepEqual(edit.present().clips, original);
	edit.redo(); assert.deepEqual(edit.present().clips, after);
});

test('a mixed group retains ordinary clip trim semantics alongside loop-period editing', () => {
	const edit = fixture(false, false);
	edit.service.trimClips('clip-0', { durationFrames: 72_000 });
	assert.deepEqual(edit.present().clips.map(clip => 'sourceDurationFrames' in clip ? [clip.durationFrames, clip.sourceDurationFrames] : null),
		[[76_800, 33_600], [33_600, 33_600]]);
});

for (const [edge, delta, expected] of [
	['right', -90, [51, 1]], ['left', -50, [104, 54]],
] as const) test(`shared loop ${edge} trimming clamps to the companion source and period bounds`, () => {
	const clips = [100, 50].map((period, index) => {
		const clip = { kind: 'audio' as const, id: `clip-${String(index)}`, sourceId: `source-${String(index)}`,
			timelineStartFrame: 0, durationFrames: period, sourceStartFrame: index === 0 ? 20 : 4, sourceDurationFrames: period };
		return { ...clip, ...clipLoopUpdateFields(clip, { periodFrames: period, durationFrames: 200 }) };
	});
	const project = { schemaVersion: 17, id: 'project', title: 'Loops', sampleRate: 48_000, clips, tracks: [],
		sources: clips.map(clip => ({ id: clip.sourceId, frameCount: 1000 })) };
	const command = prepareGroupedLoopTrimCommand(project, clips, edge, delta);
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected shared trim.');
	const periods = command.commands.map(value => {
		if (value.type !== 'clip/update') assert.fail('Expected repeat update.');
		const changes = value.changes as Readonly<{ loop: Readonly<{ periodFrames: number; sourceStartFrame: number }> }>;
		return changes.loop.periodFrames;
	});
	assert.deepEqual(periods, expected);
	if (edge === 'left') assert.equal(clips[1]!.sourceStartFrame, 4, 'the authored sources remain untouched');
});
