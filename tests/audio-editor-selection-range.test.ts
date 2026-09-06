/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveSelectionRange } from '../src/common/editor/selection-range.ts';
import { prepareSplitRangeIntoNewTrackCommand } from '../src/common/editor/controller/split-into-new-track-plan.ts';
import { prepareLinkedSplitCommand } from '../src/common/editor/commands/clip-link-runtime.js';
import { createAddTrackCommand } from '../src/common/editor/commands/factories.ts';

interface Clip {
	readonly id: string;
	readonly kind?: string;
	readonly sourceId: string;
	readonly timelineStartFrame: number;
	readonly durationFrames: number;
	readonly sourceStartFrame: number;
	readonly sourceDurationFrames: number;
	readonly avLinkId?: string | null;
	readonly groupId?: string | null;
}

function project(overrides: Record<string, unknown> = {}) {
	return {
		id: 'project-a',
		schemaVersion: 12,
		sampleRate: 48_000,
		sources: [{ id: 'source-a', channelCount: 1, sampleRate: 48_000, sampleFormat: 'float32' }],
		tracks: [{ id: 'track-a', name: 'Audio', type: 'audio', clipIds: ['clip-a', 'clip-b'], effects: [] }],
		clips: [
			clip('clip-a', 0, 100),
			clip('clip-b', 200, 100),
		],
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: [] },
		...overrides,
	};
}

function clip(id: string, timelineStartFrame: number, durationFrames: number): Clip {
	return {
		id,
		kind: 'audio',
		sourceId: 'source-a',
		timelineStartFrame,
		durationFrames,
		sourceStartFrame: 0,
		sourceDurationFrames: durationFrames,
	};
}

test('a drawn time range answers for the selection', () => {
	const value = project({ selection: { startFrame: 10, endFrame: 40, trackIds: ['track-a'], clipIds: [] } });
	assert.deepEqual(resolveSelectionRange(value), value.selection);
});

test('selected clips answer for the selection when no range was drawn', () => {
	const value = project({ selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: ['clip-a'] } });
	assert.deepEqual(resolveSelectionRange(value), {
		startFrame: 0,
		endFrame: 100,
		trackIds: ['track-a'],
		clipIds: ['clip-a'],
	});
});

test('disjoint selected clips answer with the span that contains them all', () => {
	const value = project({
		selection: { startFrame: 0, endFrame: 0, trackIds: ['track-a'], clipIds: ['clip-a', 'clip-b'] },
	});
	const range = resolveSelectionRange(value);
	assert.equal(range?.startFrame, 0);
	assert.equal(range?.endFrame, 300);
});

test('the focused clip answers when the document records no selected clip', () => {
	const range = resolveSelectionRange(project(), { selectedClipId: 'clip-b' });
	assert.deepEqual(range, {
		startFrame: 200,
		endFrame: 300,
		trackIds: ['track-a'],
		clipIds: ['clip-b'],
	});
});

test('nothing selected resolves to no range at all', () => {
	assert.equal(resolveSelectionRange(project()), null);
	assert.equal(resolveSelectionRange(null), null);
});

test('a time range lifts its own pieces onto a copy of every track it covers', () => {
	const value = project();
	const plan = prepareSplitRangeIntoNewTrackCommand(runtime(value), {
		startFrame: 40,
		endFrame: 250,
		trackIds: ['track-a'],
	});
	assert.ok(plan);
	assert.equal(plan.command.type, 'batch');
	const commands = plan.command.commands as Array<Record<string, unknown>>;
	assert.deepEqual(commands.map(({ type }) => type), [
		'track/add', 'clip/split', 'clip/split', 'clip/move', 'clip/move',
	]);
	// clip-a is cut at the range start only and clip-b at the range end only,
	// and the pieces the range holds move to the track the plan added.
	assert.deepEqual(commands.slice(1, 3).map((command) => [command.clipId, command.atFrame]), [
		['clip-a', 40], ['clip-b', 250],
	]);
	const moves = commands.slice(3);
	assert.equal(new Set(moves.map((move) => move.trackId)).size, 1);
	assert.equal(moves[0]?.trackId, plan.selectTrackId);
	assert.deepEqual(moves.map((move) => move.timelineStartFrame), [40, 200]);
});

test('a range over nothing liftable plans nothing', () => {
	const value = project();
	assert.equal(
		prepareSplitRangeIntoNewTrackCommand(runtime(value), { startFrame: 400, endFrame: 500, trackIds: ['track-a'] }),
		null,
	);
	assert.equal(
		prepareSplitRangeIntoNewTrackCommand(runtime(value), { startFrame: 0, endFrame: 100, trackIds: ['track-missing'] }),
		null,
	);
	// An A/V linked clip is not something an audio edit lifts onto a track of
	// its own: its picture would stay behind.
	const linked = project({
		clips: [{ ...clip('clip-a', 0, 100), avLinkId: 'link-1' }, clip('clip-b', 200, 100)],
	});
	assert.equal(
		prepareSplitRangeIntoNewTrackCommand(runtime(linked), { startFrame: 0, endFrame: 100, trackIds: ['track-a'] }),
		null,
	);
});

function runtime(value: ReturnType<typeof project>) {
	let counter = 0;
	return {
		getProject: () => value,
		findClip: (target: typeof value, clipId: string) => target.clips.find(({ id }) => id === clipId) ?? null,
		createStableId: (prefix = 'id') => `${prefix}-${++counter}`,
		createAddTrackCommand,
		prepareLinkedSplitCommand,
	};
}
