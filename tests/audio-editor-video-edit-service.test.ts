/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { EditorControllerLifetime } from '../src/common/editor/controller/lifecycle.ts';
import { resolveSourceMonitorPoints } from '../src/common/editor/source-monitor-model.ts';
import { ThreePointEditError } from '../src/common/editor/three-point-edit.ts';
import { createVideoEditService } from '../src/common/editor/controller/video-edit-service.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 25, den: 1 });
const SECOND = SAMPLE_RATE;

/**
 * The command projection the service reads: resolved samples for every clip,
 * a video source with its own frame grid, and one bin item carrying audio.
 */
function projection(overrides: Record<string, unknown> = {}) {
	return {
		id: 'edit-project',
		sampleRate: SAMPLE_RATE,
		primarySequenceId: 'main',
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track', 'audio-track'] }],
		tracks: [
			{ id: 'video-track', type: 'video', laneGroupId: 'lane', clipIds: [] },
			{ id: 'audio-track', type: 'audio', laneGroupId: 'lane', clipIds: [] },
		],
		clips: [],
		sources: [
			{ id: 'bin-video-source', kind: 'video', frameRate: RATE, sourceFrameCount: 250 },
			{ id: 'bin-audio-source', kind: 'audio', frameCount: SECOND * 10, sampleRate: SAMPLE_RATE },
		],
		projectBin: {
			clips: [
				{ id: 'bin-video', kind: 'video', binItemId: 'item', sourceId: 'bin-video-source', title: 'Take 1' },
				{ id: 'bin-audio', kind: 'audio', binItemId: 'item', sourceId: 'bin-audio-source', title: 'Take 1 Audio' },
			],
		},
		selection: { startFrame: 0, endFrame: 0, clipIds: ['bin-video'], trackIds: [] },
		...overrides,
	};
}

function harness(overrides: Record<string, unknown> = {}) {
	const commands: AudioEditorCommand[] = [];
	const project = projection(overrides.project as Record<string, unknown> ?? {});
	let clipIndex = 0;
	const service = createVideoEditService({
		lifetime: new EditorControllerLifetime(),
		getProject: () => project,
		getSelectedTrackId: () => (overrides.selectedTrackId as string | null) ?? 'video-track',
		editingBlocked: () => Boolean(overrides.blocked),
		commit: (command: AudioEditorCommand) => {
			commands.push(command);
			return command;
		},
		publishProjectState: () => undefined,
		sourceMonitorPoints: (binItemId: string | null, sequencePointCount: number) => {
			const monitor = overrides.monitor as Record<string, unknown> | undefined;
			if (!monitor || monitor.binItemId !== binItemId) return null;
			return resolveSourceMonitorPoints(
				monitor.marks as { markIn: number | null; markOut: number | null },
				250,
				sequencePointCount,
			);
		},
		// The real preparer is exercised by the command tests; here the service's
		// own arithmetic and refusals are what is under test.
		prepareThreePointEditCommand: (_project, options) => ({
			type: options.mode === 'insert' ? 'edit/insert' : 'edit/overwrite',
			startFrame: options.startFrame,
			endFrame: options.endFrame,
			trackIds: (options.placements as { trackId: string }[]).map(({ trackId }) => trackId),
			placements: (options.placements as Record<string, unknown>[]).map((placement) => ({
				...placement,
				clipId: `clip-${String(clipIndex++)}`,
			})),
		}) as unknown as AudioEditorCommand,
	});
	return { commands, project, service };
}

function placements(command: AudioEditorCommand) {
	return (command as unknown as { placements: Record<string, unknown>[] }).placements;
}

test('with no selection width the whole source decides the sequence extent', () => {
	const { commands, service } = harness();
	const result = service.overwrite();

	assert.equal(result.mode, 'overwrite');
	assert.equal(result.edit.resolved, 'sequenceOut');
	// 250 source frames at 25 fps is ten seconds of a 25 fps sequence.
	assert.equal(result.edit.sequenceFrameCount, 250);
	assert.equal(commands.length, 1);
	const command = commands[0] as unknown as Record<string, unknown>;
	assert.equal(command.type, 'edit/overwrite');
	assert.equal(command.startFrame, 0);
	assert.equal(command.endFrame, SECOND * 10);
	assert.deepEqual(placements(commands[0]).map((placement) => [
		placement.trackId, placement.sourceId, placement.sourceIn, placement.sourceCount,
	]), [
		['video-track', 'bin-video-source', 0, 250],
		// The audio program was fitted to the video at ingest, so the same span
		// maps once into source samples.
		['audio-track', 'bin-audio-source', 0, SECOND * 10],
	]);
	assert.equal(result.audioDropped, false);
});

test('a selection with width fills exactly that programme from the source', () => {
	const { commands, service } = harness({
		project: { selection: { startFrame: SECOND, endFrame: SECOND * 3, clipIds: ['bin-video'], trackIds: [] } },
	});
	const result = service.insert();

	assert.equal(result.edit.resolved, 'sourceOut');
	assert.equal(result.edit.sequenceFrameCount, 50);
	assert.equal(result.edit.sourceFrameCount, 50);
	assert.equal((commands[0] as unknown as Record<string, unknown>).type, 'edit/insert');
	assert.equal(placements(commands[0])[0].sourceCount, 50);
});

test('an item with audio no lane can receive lands its video and says so', () => {
	const { commands, service } = harness({
		project: {
			tracks: [{ id: 'video-track', type: 'video', laneGroupId: null, clipIds: [] }],
			sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		},
	});
	const result = service.overwrite();

	assert.equal(result.audioDropped, true);
	assert.equal(result.audioClipId, null);
	assert.equal(placements(commands[0]).length, 1);
});

test('the edit refuses rather than guessing when nothing is chosen or targeted', () => {
	const untargeted = harness({
		project: {
			tracks: [{ id: 'audio-track', type: 'audio', laneGroupId: null, clipIds: [] }],
			sequences: [{ id: 'main', rate: RATE, trackIds: ['audio-track'] }],
		},
		selectedTrackId: 'audio-track',
	});
	assert.throws(() => untargeted.service.overwrite(), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'no-target');
		return true;
	});
	assert.equal(untargeted.commands.length, 0);

	const unselected = harness({
		project: { selection: { startFrame: 0, endFrame: 0, clipIds: [], trackIds: [] } },
	});
	assert.throws(() => unselected.service.insert(), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'no-source');
		return true;
	});
	assert.throws(() => unselected.service.insert({ binItemId: 'missing' }), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'no-source');
		return true;
	});
});

test('an edit longer than the source is refused before anything is committed', () => {
	const { commands, service } = harness({
		project: { selection: { startFrame: 0, endFrame: SECOND * 20, clipIds: ['bin-video'], trackIds: [] } },
	});
	assert.throws(() => service.overwrite(), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'source-out-of-bounds');
		return true;
	});
	assert.equal(commands.length, 0);
});

test('blocked editing refuses before any point is resolved', () => {
	const { commands, service } = harness({ blocked: true });
	assert.throws(() => service.insert(), /Editing is blocked/);
	assert.equal(commands.length, 0);
});

test('targeting is held by the service and toggles from what is resolved', () => {
	const { service } = harness();
	assert.deepEqual(service.targets(), {
		sequenceId: 'main',
		videoTrackId: 'video-track',
		audioTrackId: 'audio-track',
		explicit: false,
	});
	assert.deepEqual(service.toggleTarget('audio-track'), {
		sequenceId: 'main',
		videoTrackId: 'video-track',
		audioTrackId: null,
		explicit: true,
	});
	assert.deepEqual(service.clearTargets(), {
		sequenceId: 'main',
		videoTrackId: 'video-track',
		audioTrackId: 'audio-track',
		explicit: false,
	});
	assert.throws(() => service.toggleTarget('missing-track'), ReferenceError);
});

test('a marked source range decides what the edit places', () => {
	const { commands, service } = harness({
		monitor: { binItemId: 'item', marks: { markIn: 50, markOut: 100 } },
	});
	const result = service.overwrite();

	assert.equal(result.edit.sourceIn, 50);
	assert.equal(result.edit.sourceFrameCount, 50);
	assert.equal(result.edit.resolved, 'sequenceOut');
	assert.equal(result.edit.sequenceFrameCount, 50);
	assert.deepEqual(placements(commands[0]).map((placement) => [placement.sourceIn, placement.sourceCount]), [
		[50, 50],
		[SECOND * 2, SECOND * 2],
	]);
});

test('an out mark alone backtimes the edit from the end of the selection', () => {
	const { service } = harness({
		monitor: { binItemId: 'item', marks: { markIn: null, markOut: 100 } },
		project: { selection: { startFrame: SECOND, endFrame: SECOND * 2, clipIds: ['bin-video'], trackIds: [] } },
	});
	const result = service.overwrite();

	assert.equal(result.edit.resolved, 'sourceIn');
	assert.equal(result.edit.sourceIn, 75, 'the last 25 frames of the marked material fill the second');
	assert.equal(result.edit.sourceOut, 100);
});

test('a marked range and a selection of another length refuse rather than change speed', () => {
	const { commands, service } = harness({
		monitor: { binItemId: 'item', marks: { markIn: 50, markOut: 100 } },
		project: { selection: { startFrame: 0, endFrame: SECOND * 3, clipIds: ['bin-video'], trackIds: [] } },
	});
	assert.throws(() => service.insert(), (error: unknown) => {
		assert.ok(error instanceof ThreePointEditError);
		assert.equal(error.reason, 'over-specified');
		assert.match(error.message, /change speed/u);
		return true;
	});
	assert.equal(commands.length, 0);
});

test('four points that agree are an ordinary edit', () => {
	const { service } = harness({
		monitor: { binItemId: 'item', marks: { markIn: 50, markOut: 100 } },
		project: { selection: { startFrame: 0, endFrame: SECOND * 2, clipIds: ['bin-video'], trackIds: [] } },
	});
	const result = service.overwrite();
	assert.equal(result.edit.sourceIn, 50);
	assert.equal(result.edit.sequenceFrameCount, 50);
});

test('marks set on another item are not borrowed by this one', () => {
	const { service } = harness({
		monitor: { binItemId: 'another-item', marks: { markIn: 50, markOut: 100 } },
	});
	const result = service.overwrite();
	assert.equal(result.edit.sourceIn, 0);
	assert.equal(result.edit.sourceFrameCount, 250, 'the whole source, as before marking existed');
});

test('an untargeted audio lane keeps the edit off it', () => {
	const { commands, service } = harness();
	service.toggleTarget('audio-track');
	const result = service.overwrite();
	assert.equal(result.audioDropped, true);
	assert.equal(placements(commands[0]).length, 1);
});
