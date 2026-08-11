/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createVideoRateStretchService } from '../src/common/editor/controller/video-rate-stretch-service.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV15 } from '../src/common/editor/project-v15.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { videoFrameToSampleFrame } from '../src/common/editor/timeline-time.ts';
import type { VideoSourceTimingView } from '../src/common/editor/video-source-timing-view.ts';

const NOW = '2026-08-11T20:30:00.000Z';
const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 24, den: 1 });

type PersistedProject = ReturnType<typeof createProject>;

test('preview reads one fresh project and timing view from that exact planning identity', () => {
	const harness = createHarness();
	const before = JSON.stringify(harness.project());
	const result = harness.service.preview(stretchRequest(25));

	assert.equal(result.kind, 'transform');
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 1);
	assert.deepEqual(harness.timingProjectReads(), [harness.project()]);
	assert.equal(JSON.stringify(harness.project()), before);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, []);

	harness.setTimingViews(cfrTimingViews());
	assert.equal(harness.service.preview(stretchRequest(24)).kind, 'transform');
	assert.equal(harness.projectReads(), 2);
	assert.equal(harness.timingReads(), 2);
	assert.equal(harness.timingProjectReads()[1], harness.project());
});

test('commit replans with persisted V15 locks and ignores caller lock authority', () => {
	const harness = createHarness();
	const request = Object.freeze({
		...stretchRequest(25),
		isTrackLocked: () => false,
	});
	assert.equal(harness.service.preview(request).kind, 'transform');
	harness.setLockedTracks(['video-track']);

	assert.throws(() => harness.service.commit(request), /lock|video-track/iu);
	assert.equal(harness.projectReads(), 2);
	assert.equal(harness.timingReads(), 2);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, []);

	const unlocked = createHarness();
	assert.equal(unlocked.service.preview(Object.freeze({
		...stretchRequest(25),
		isTrackLocked: () => true,
	})).kind, 'transform');
});

test('one successful commit prepares one transform-many and reports after mutation', () => {
	const harness = createHarness();
	const result = harness.service.commit(stretchRequest(25));

	assert.equal(result.kind, 'transform');
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 1);
	assert.deepEqual(harness.events, ['commit:clip/transform-many', 'report:transform']);
	assert.equal(harness.commands.length, 1);
	const command = requireTransformCommand(harness.commands[0]);
	assert.deepEqual(command.transforms, result.transforms);
	assert.equal(command.overwrite, false);
});

test('a no-op reports without a command while planner refusal reports nothing', () => {
	const harness = createHarness();
	const noop = harness.service.commit(stretchRequest(20));

	assert.equal(noop.kind, 'noop');
	assert.deepEqual(noop.transforms, []);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, ['report:noop']);

	harness.events.length = 0;
	assert.throws(() => harness.service.commit({
		activeClipId: 'missing', edge: 'right', requestedBoundarySample: boundary(25),
	}), /active|clip|missing|unknown/iu);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, []);
});

test('blocked, provider, and failed-commit errors propagate without reads or feedback', () => {
	const blocked = createHarness({ blocked: true });
	assert.throws(() => blocked.service.commit(stretchRequest(25)), /editing.*blocked/iu);
	assert.equal(blocked.projectReads(), 0);
	assert.equal(blocked.timingReads(), 0);
	assert.deepEqual(blocked.events, []);

	const projectError = new RangeError('Framescaper video capability unavailable.');
	const projectEvents: string[] = [];
	const unavailable = createVideoRateStretchService({
		lifetime: { assertActive: () => undefined },
		getProject: () => { throw projectError; },
		getTimingViews: () => { throw new Error('must not read timing'); },
		editingBlocked: () => false,
		commit: () => projectEvents.push('commit'),
		reportResult: () => projectEvents.push('report'),
	});
	assert.throws(() => unavailable.preview(stretchRequest(25)), (error) => error === projectError);
	assert.throws(() => unavailable.commit(stretchRequest(25)), (error) => error === projectError);
	assert.deepEqual(projectEvents, []);

	const base = createHarness();
	const timingError = new Error('verified timing registry unavailable');
	const timingEvents: string[] = [];
	const timingFailure = createVideoRateStretchService({
		lifetime: { assertActive: () => undefined },
		getProject: base.project,
		getTimingViews: () => { throw timingError; },
		editingBlocked: () => false,
		commit: () => timingEvents.push('commit'),
		reportResult: () => timingEvents.push('report'),
	});
	assert.throws(() => timingFailure.preview(stretchRequest(25)), (error) => error === timingError);
	assert.deepEqual(timingEvents, []);

	const commitEvents: string[] = [];
	const failedCommit = createVideoRateStretchService({
		lifetime: { assertActive: () => undefined },
		getProject: base.project,
		getTimingViews: base.timing,
		editingBlocked: () => false,
		commit: () => { throw new Error('commit failed'); },
		reportResult: () => commitEvents.push('report'),
	});
	assert.throws(() => failedCommit.commit(stretchRequest(25)), /commit failed/u);
	assert.deepEqual(commitEvents, []);
});

function createHarness(options: Readonly<{ blocked?: boolean }> = {}) {
	const persisted = createProject();
	let projection = lockedProjection(persisted, new Set());
	let views = cfrTimingViews();
	let projectReadCount = 0;
	let timingReadCount = 0;
	const timingProjects: unknown[] = [];
	const commands: AudioEditorCommand[] = [];
	const events: string[] = [];
	const service = createVideoRateStretchService({
		lifetime: { assertActive: () => undefined },
		getProject: () => {
			projectReadCount += 1;
			assert.equal(isRuntimeProjectProjection(projection), true);
			return projection;
		},
		getTimingViews: (planningProject: unknown) => {
			timingReadCount += 1;
			timingProjects.push(planningProject);
			assert.equal(planningProject, projection);
			return views;
		},
		editingBlocked: () => options.blocked === true,
		commit: (command: AudioEditorCommand) => {
			commands.push(command);
			events.push(`commit:${command.type}`);
			return command;
		},
		reportResult: (plan: Readonly<{ readonly kind: string }>) => (
			events.push(`report:${plan.kind}`)
		),
	});
	return {
		commands,
		events,
		service,
		project: () => projection,
		timing: () => views,
		projectReads: () => projectReadCount,
		timingReads: () => timingReadCount,
		timingProjectReads: () => timingProjects,
		setTimingViews(value: ReadonlyMap<string, VideoSourceTimingView>) {
			views = value;
		},
		setLockedTracks(trackIds: readonly string[]) {
			projection = lockedProjection(persisted, new Set(trackIds));
		},
	};
}

function createProject() {
	const source = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 2_000_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 1_000,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: RATE },
	}, SAMPLE_RATE);
	const clip = createVideoClipV10({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 10, sequenceFrameCount: 10,
		sourceInFrame: 100, sourceFrameCount: 10,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source });
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: ['video'], locked: false,
	});
	return createAudioEditorProjectV15({
		id: 'rate-stretch-service', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips: [clip], tracks: [track],
	});
}

function lockedProjection(project: PersistedProject, lockedTrackIds: ReadonlySet<string>) {
	return projectV10ForCommand({
		...project,
		tracks: project.tracks.map((track) => ({
			...track,
			locked: lockedTrackIds.has(String(track.id)),
		})),
	} as unknown as Record<string, unknown>);
}

function cfrTimingViews(): ReadonlyMap<string, VideoSourceTimingView> {
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: Object.freeze({ ...RATE }), frameCount: 1_000,
	});
	return Object.freeze(new Map([['video-source', view]]));
}

function stretchRequest(requestedSequenceFrame: number) {
	return Object.freeze({
		activeClipId: 'video', edge: 'right' as const,
		requestedBoundarySample: boundary(requestedSequenceFrame),
	});
}

function boundary(frame: number): number {
	return videoFrameToSampleFrame(frame, RATE, SAMPLE_RATE, 'point');
}

function requireTransformCommand(command: AudioEditorCommand | undefined): Extract<
	AudioEditorCommand,
	{ readonly type: 'clip/transform-many' }
> {
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	return command;
}
