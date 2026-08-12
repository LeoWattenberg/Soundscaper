/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareTransformClipsCommand } from '../src/common/editor/commands.js';
import { applyCanonicalVideoTransformPlacement } from '../src/common/editor/commands/canonical-video-transform-placement.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { planFrameCanonicalEdgeTrim } from '../src/common/editor/frame-canonical-edge-trim-planner.ts';
import { planFrameCanonicalRollRippleTrim } from '../src/common/editor/frame-canonical-roll-ripple-trim-planner.ts';
import {
	createEditorHistory,
	executeEditorCommand,
	redoEditorCommand,
	undoEditorCommand,
} from '../src/common/editor/history.js';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { validateCurrentAudioEditorProject } from '../src/common/editor/project-current.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';

const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 40_000, den: 1 });
const NOW = '2026-08-11T21:00:00.000Z';

test('an edge plan round-trips canonical video placement when sample deltas alias frame deltas', () => {
	const project = highRateProject(false);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalEdgeTrim(runtime, {
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(3),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.deepEqual(
		plan.transforms[0]?.sequencePlacement,
		{ sequenceStartFrame: 0, sequenceFrameCount: 3 },
	);

	const command = serializableCommand(prepareTransformClipsCommand(runtime, plan.transforms));
	assert.equal(command.type, 'clip/transform-many');
	if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	assert.deepEqual(command.transforms[0]?.sequencePlacement, {
		sequenceStartFrame: 0,
		sequenceFrameCount: 3,
	});
	let history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	assertCanonicalPlacement(history.present, 'active-video', 0, 3);
	assertResolvedPreviews(history.present, plan.previews);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);

	const edited = canonicalCoordinates(history.present);
	history = undoEditorCommand(history, { now: '2026-08-11T21:01:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present), canonicalCoordinates(project));
	history = redoEditorCommand(history, { now: '2026-08-11T21:02:00.000Z' });
	assert.deepEqual(canonicalCoordinates(history.present), edited);
});

for (const row of [
	{
		mode: 'roll' as const,
		expected: [['active-video', 0, 3], ['suffix-video', 3, 1]] as const,
	},
	{
		mode: 'ripple' as const,
		expected: [['active-video', 0, 3], ['suffix-video', 3, 2]] as const,
	},
]) test(`a ${row.mode} plan round-trips every canonical video placement at 48k/40k`, () => {
	const project = highRateProject(true);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const plan = planFrameCanonicalRollRippleTrim(runtime, {
		mode: row.mode,
		activeClipId: 'active-video',
		edge: 'right',
		requestedBoundarySample: boundary(3),
	});
	assert.equal(plan.kind, 'transform');
	assert.equal(plan.sequenceFrameDelta, 1);
	assert.deepEqual(plan.transforms.map(({ sequencePlacement }) => sequencePlacement), row.expected.map(([
		, sequenceStartFrame, sequenceFrameCount,
	]) => ({
		sequenceStartFrame,
		sequenceFrameCount,
	})));

	const command = serializableCommand(prepareTransformClipsCommand(runtime, plan.transforms));
	const history = executeEditorCommand(createEditorHistory(project), command, { now: NOW });
	for (const [clipId, sequenceStartFrame, sequenceFrameCount] of row.expected) {
		assertCanonicalPlacement(history.present, clipId, sequenceStartFrame, sequenceFrameCount);
	}
	assertResolvedPreviews(history.present, plan.previews);
	assert.equal(validateCurrentAudioEditorProject(history.present), true);
});

test('canonical placement refuses an absolute sample alias mismatch during preparation', () => {
	const project = highRateProject(false);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	assert.throws(() => prepareTransformClipsCommand(runtime, [{
		clipId: 'active-video',
		trackId: 'video-track',
		changes: { durationFrames: boundary(3) },
		sequencePlacement: { sequenceStartFrame: 0, sequenceFrameCount: 2 },
	}]), /canonical|sequence placement|alias/iu);
});

test('canonical placement rejects malformed authority and ambiguous target sequence ownership', () => {
	const project = highRateProject(false);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const accessor = {} as Record<string, unknown>;
	Object.defineProperties(accessor, {
		sequenceStartFrame: { enumerable: true, get: () => 0 },
		sequenceFrameCount: { enumerable: true, value: 3 },
	});
	for (const sequencePlacement of [
		{ sequenceStartFrame: 0, sequenceFrameCount: 3, extra: true },
		accessor,
		{ sequenceStartFrame: '0', sequenceFrameCount: 3 },
	]) {
		assert.throws(() => prepareTransformClipsCommand(runtime, [{
			clipId: 'active-video',
			trackId: 'video-track',
			changes: { durationFrames: boundary(3) },
			sequencePlacement,
		}]), /canonical sequence|data propert|safe integer|only/iu);
	}

	const sequence = (runtime.sequences as readonly Readonly<Record<string, unknown>>[])[0];
	assert.ok(sequence);
	assert.throws(() => applyCanonicalVideoTransformPlacement(
		{ ...runtime, sequences: [sequence, { ...sequence, id: 'duplicate-main' }] },
		{ id: 'active-video', kind: 'video' },
		{ id: 'video-track' },
		{ timelineStartFrame: 0, durationFrames: boundary(3) },
		{ sequenceStartFrame: 0, sequenceFrameCount: 3 },
	), /multiple sequences/iu);
});

test('canonical placement is unavailable to non-video and pre-foundation transforms', () => {
	const project = {
		schemaVersion: 15,
		sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['track'] }],
	};
	const updated = { timelineStartFrame: 0, durationFrames: boundary(3) };
	const placement = { sequenceStartFrame: 0, sequenceFrameCount: 3 };
	assert.throws(() => applyCanonicalVideoTransformPlacement(
		project, { id: 'audio', kind: 'audio' }, { id: 'track' }, updated, placement,
	), /foundation video/iu);
	assert.throws(() => applyCanonicalVideoTransformPlacement(
		{ ...project, schemaVersion: 9 },
		{ id: 'video', kind: 'video' },
		{ id: 'track' },
		updated,
		placement,
	), /foundation video/iu);
});

test('generic and overwrite transform preparation retain the legacy transform shape', () => {
	const project = highRateProject(false);
	const runtime = projectV10ForCommand(project as unknown as Record<string, unknown>);
	const input = [{
		clipId: 'active-video',
		trackId: 'video-track',
		changes: { timelineStartFrame: boundary(0) },
	}];
	for (const overwrite of [false, true]) {
		const command = prepareTransformClipsCommand(runtime, input, { overwrite }) as AudioEditorCommand;
		assert.equal(command.type, 'clip/transform-many');
		if (command.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
		assert.deepEqual(command.transforms, input);
		assert.equal(Object.hasOwn(command.transforms[0]!, 'sequencePlacement'), false);
	}
});

function highRateProject(withSuffix: boolean) {
	const source = createVideoSourceV10({
		id: 'video-source',
		frameCount: 120,
		sampleRate: SAMPLE_RATE,
		width: 16,
		height: 16,
		frameRate: RATE,
		sourceFrameCount: 100,
	}, SAMPLE_RATE);
	const clip = (
		id: string,
		sequenceStartFrame: number,
		sequenceFrameCount: number,
		sourceInFrame: number,
	) => createVideoClipV10({
		id,
		sourceId: 'video-source',
		sequenceId: 'main',
		sequenceStartFrame,
		sequenceFrameCount,
		sourceInFrame,
		sourceFrameCount: sequenceFrameCount,
	}, {
		projectSampleRate: SAMPLE_RATE,
		sequence: { id: 'main', rate: RATE },
		source,
	});
	const clips = [
		clip('active-video', 0, 2, 0),
		...(withSuffix ? [clip('suffix-video', 2, 2, 10)] : []),
	];
	const track = createVideoTrackV10({
		id: 'video-track',
		clipIds: clips.map(({ id }) => String(id)),
		locked: false,
	});
	return createCurrentAudioEditorProject({
		id: `high-rate-${withSuffix ? 'pair' : 'edge'}`,
		now: NOW,
		sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
		sources: [source],
		clips,
		tracks: [track],
	});
}

function serializableCommand(value: unknown): AudioEditorCommand {
	return JSON.parse(JSON.stringify(value)) as AudioEditorCommand;
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}

function assertCanonicalPlacement(
	project: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>,
	clipId: string,
	sequenceStartFrame: number,
	sequenceFrameCount: number,
): void {
	const clip = project.clips.find(({ id }) => id === clipId);
	assert.ok(clip);
	assert.deepEqual([clip.sequenceStartFrame, clip.sequenceFrameCount], [
		sequenceStartFrame,
		sequenceFrameCount,
	]);
	assert.equal(Object.hasOwn(clip, 'sequencePlacement'), false);
}

function assertResolvedPreviews(
	project: Readonly<Record<string, unknown>>,
	previews: readonly Readonly<{
		clipId: string;
		timelineStartFrame: number;
		durationFrames: number;
		sourceStartFrame: number;
		sourceDurationFrames: number;
	}>[],
): void {
	const clips = resolveRuntimeProjectProjection(project).clips;
	for (const preview of previews) {
		const clip = clips.find(({ id }) => id === preview.clipId);
		assert.ok(clip);
		assert.deepEqual([
			clip.timelineStartFrame,
			clip.durationFrames,
			clip.sourceStartFrame,
			clip.sourceDurationFrames,
		], [
			preview.timelineStartFrame,
			preview.durationFrames,
			preview.sourceStartFrame,
			preview.sourceDurationFrames,
		], String(preview.clipId));
	}
}

function canonicalCoordinates(
	project: Readonly<{ clips: readonly Readonly<Record<string, unknown>>[] }>,
): readonly unknown[] {
	return project.clips.map((clip) => ({
		id: clip.id,
		sequenceStartFrame: clip.sequenceStartFrame,
		sequenceFrameCount: clip.sequenceFrameCount,
		sourceInFrame: clip.sourceInFrame,
		sourceFrameCount: clip.sourceFrameCount,
	}));
}
