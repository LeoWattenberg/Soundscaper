/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createVideoSlipSlideService } from '../src/common/editor/controller/video-slip-slide-service.ts';
import type {
	FrameCanonicalSlipSlideRequest,
	VideoSourceTimingView,
} from '../src/common/editor/frame-canonical-slip-slide-domain.ts';
import { projectV10ForCommand } from '../src/common/editor/project-v10-command-projection.ts';
import {
	createVideoClipV10,
	createVideoSourceV10,
	createVideoTrackV10,
} from '../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV15 } from '../src/common/editor/project-v15.ts';
import { isRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';

const NOW = '2026-08-11T18:20:00.000Z';
const SAMPLE_RATE = 48_000;
const RATE = Object.freeze({ num: 24, den: 1 });

type PersistedProject = ReturnType<typeof createProject>;

test('step requests read fresh branded authority without consulting timing evidence', () => {
	const harness = createHarness();

	assert.deepEqual(harness.service.buildStepRequest({
		mode: 'slip', activeClipId: 'video', direction: 'earlier',
	}), {
		mode: 'slip', activeClipId: 'video', requestedSourceInFrame: 9,
	});
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 0);
});

test('pointer authority captures one fresh project and its exact timing-view identity', () => {
	const harness = createHarness();
	const view = harness.timing().get('video-source');
	const authority = harness.service.capturePointerAuthority({
		mode: 'slip', activeClipId: 'video', pointerDownSample: 12_345,
	});

	assert.deepEqual(authority, {
		mode: 'slip', activeClipId: 'video', pointerDownSample: 12_345,
		sourceInFrame: 10, sourceOutFrame: 14, programDurationSamples: 8_000,
		timingView: view,
	});
	assert.equal(authority.mode === 'slip' ? authority.timingView : null, view);
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 1);
	assert.deepEqual(harness.events, []);
});

test('every preview reads fresh branded V15 authority and timing evidence without mutation or reporting', () => {
	const harness = createHarness();
	const projectBefore = JSON.stringify(harness.project());
	const timingBefore = timingSnapshot(harness.timing());
	const first = harness.service.preview(slipRequest(12));

	assert.equal(first.kind, 'transform');
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 1);
	assert.deepEqual(harness.events, []);
	assert.deepEqual(harness.commands, []);
	assert.equal(JSON.stringify(harness.project()), projectBefore);
	assert.deepEqual(timingSnapshot(harness.timing()), timingBefore);

	harness.setLockedTracks(['video-track']);
	assert.throws(() => harness.service.preview(slipRequest(12)), /lock|video-track/iu);
	assert.equal(harness.projectReads(), 2);
	assert.equal(harness.timingReads(), 2);
	assert.deepEqual(harness.events, []);
});

test('commit replans with fresh timing and persisted locks instead of stale preview authority', () => {
	const harness = createHarness();
	const request = Object.freeze({
		...slipRequest(12),
		isTrackLocked: () => false,
	});
	assert.equal(harness.service.preview(request).kind, 'transform');
	harness.setLockedTracks(['video-track']);
	assert.throws(() => harness.service.commit(request), /lock|video-track/iu);
	assert.equal(harness.projectReads(), 2);
	assert.equal(harness.timingReads(), 2);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, []);

	const missingTiming = createHarness();
	assert.equal(missingTiming.service.preview(slipRequest(12)).kind, 'transform');
	missingTiming.setTimingViews(Object.freeze(new Map()));
	assert.throws(
		() => missingTiming.service.commit(slipRequest(12)),
		/timing|video-source|source/iu,
	);
	assert.equal(missingTiming.timingReads(), 2);
	assert.deepEqual(missingTiming.commands, []);
	assert.deepEqual(missingTiming.events, []);
});

test('one successful commit prepares one transform-many and reports only after mutation succeeds', () => {
	const harness = createHarness();
	const result = harness.service.commit(slipRequest(12));

	assert.equal(result.kind, 'transform');
	assert.equal(harness.projectReads(), 1);
	assert.equal(harness.timingReads(), 1);
	assert.deepEqual(harness.events, ['commit:clip/transform-many', 'report:transform']);
	assert.equal(harness.commands.length, 1);
	const command = requireTransformCommand(harness.commands[0]);
	assert.deepEqual(command.transforms, result.transforms);
	assert.equal(command.overwrite, false);

	const failedEvents: string[] = [];
	const failed = createVideoSlipSlideService({
		lifetime: { assertActive: () => undefined },
		getProject: harness.project,
		getTimingViews: harness.timing,
		editingBlocked: () => false,
		commit: () => { throw new Error('commit failed'); },
		reportResult: (plan) => failedEvents.push(`report:${plan.kind}`),
	});
	assert.throws(() => failed.commit(slipRequest(12)), /commit failed/u);
	assert.deepEqual(failedEvents, []);
});

test('a no-op reports without a command while planner refusal reports nothing', () => {
	const harness = createHarness();
	const noop = harness.service.commit(slipRequest(10));
	assert.equal(noop.kind, 'noop');
	assert.deepEqual(noop.transforms, []);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, ['report:noop']);

	harness.events.length = 0;
	assert.throws(() => harness.service.commit({
		mode: 'slip', activeClipId: 'missing', requestedSourceInFrame: 12,
	}), /active|clip|missing|unknown/iu);
	assert.deepEqual(harness.commands, []);
	assert.deepEqual(harness.events, []);
});

test('editing blocks before live reads and capability or timing-provider errors propagate unchanged', () => {
	const blocked = createHarness({ blocked: true });
	assert.throws(() => blocked.service.commit(slipRequest(12)), /editing.*blocked/iu);
	assert.equal(blocked.projectReads(), 0);
	assert.equal(blocked.timingReads(), 0);
	assert.deepEqual(blocked.events, []);

	const capabilityError = new RangeError('Framescaper video capability unavailable.');
	const capabilityEvents: string[] = [];
	const unavailable = createVideoSlipSlideService({
		lifetime: { assertActive: () => undefined },
		getProject: () => { throw capabilityError; },
		getTimingViews: () => { throw new Error('must not read timing'); },
		editingBlocked: () => false,
		commit: () => capabilityEvents.push('commit'),
		reportResult: () => capabilityEvents.push('report'),
	});
	assert.throws(() => unavailable.preview(slipRequest(12)), (error) => error === capabilityError);
	assert.throws(() => unavailable.commit(slipRequest(12)), (error) => error === capabilityError);
	assert.deepEqual(capabilityEvents, []);

	const timingError = new Error('verified timing registry unavailable');
	const timingEvents: string[] = [];
	const timingFailure = createVideoSlipSlideService({
		lifetime: { assertActive: () => undefined },
		getProject: createHarness().project,
		getTimingViews: () => { throw timingError; },
		editingBlocked: () => false,
		commit: () => timingEvents.push('commit'),
		reportResult: () => timingEvents.push('report'),
	});
	assert.throws(() => timingFailure.preview(slipRequest(12)), (error) => error === timingError);
	assert.deepEqual(timingEvents, []);
});

function createHarness(options: Readonly<{ blocked?: boolean }> = {}) {
	const persisted = createProject();
	let lockedTrackIds = new Set<string>();
	let projection = lockedProjection(persisted, lockedTrackIds);
	let views = cfrTimingViews();
	let projectReadCount = 0;
	let timingReadCount = 0;
	const commands: AudioEditorCommand[] = [];
	const events: string[] = [];
	const service = createVideoSlipSlideService({
		lifetime: { assertActive: () => undefined },
		getProject: () => {
			projectReadCount += 1;
			assert.equal(isRuntimeProjectProjection(projection), true);
			return projection;
		},
		getTimingViews: (planningProject) => {
			timingReadCount += 1;
			assert.equal(
				planningProject,
				projection,
				'timing evidence must resolve from the exact projection used by this plan',
			);
			return views;
		},
		editingBlocked: () => options.blocked === true,
		commit: (command) => {
			commands.push(command);
			events.push(`commit:${command.type}`);
			return command;
		},
		reportResult: (plan) => events.push(`report:${plan.kind}`),
	});
	return {
		commands,
		events,
		service,
		project: () => projection,
		timing: () => views,
		projectReads: () => projectReadCount,
		timingReads: () => timingReadCount,
		setLockedTracks(trackIds: readonly string[]) {
			lockedTrackIds = new Set(trackIds);
			projection = lockedProjection(persisted, lockedTrackIds);
		},
		setTimingViews(value: ReadonlyMap<string, VideoSourceTimingView>) {
			views = value;
		},
	};
}

function createProject() {
	const source = createVideoSourceV10({
		id: 'video-source', sampleFrameCount: 200_000, sampleRate: SAMPLE_RATE,
		width: 16, height: 16, frameRate: RATE, sourceFrameCount: 100,
		timingDecision: { mode: 'conform-cfr-at-ingest', rate: RATE },
	}, SAMPLE_RATE);
	const clip = createVideoClipV10({
		id: 'video', sourceId: 'video-source', sequenceId: 'main',
		sequenceStartFrame: 10, sequenceFrameCount: 4,
		sourceInFrame: 10, sourceFrameCount: 4,
	}, { projectSampleRate: SAMPLE_RATE, sequence: { id: 'main', rate: RATE }, source });
	const track = createVideoTrackV10({
		id: 'video-track', clipIds: ['video'], locked: false,
	});
	return createAudioEditorProjectV15({
		id: 'slip-slide-service', now: NOW, sampleRate: SAMPLE_RATE,
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main', sources: [source], clips: [clip], tracks: [track],
	});
}

function lockedProjection(project: PersistedProject, lockedTrackIds: ReadonlySet<string>) {
	return projectV10ForCommand({
		...project,
		tracks: project.tracks.map((track) => ({
			...track, locked: lockedTrackIds.has(String(track.id)),
		})),
	} as unknown as Record<string, unknown>);
}

function cfrTimingViews(): ReadonlyMap<string, VideoSourceTimingView> {
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: Object.freeze({ ...RATE }), frameCount: 100,
	});
	return Object.freeze(new Map([['video-source', view]]));
}

function slipRequest(requestedSourceInFrame: number): FrameCanonicalSlipSlideRequest {
	return Object.freeze({ mode: 'slip', activeClipId: 'video', requestedSourceInFrame });
}

function requireTransformCommand(command: AudioEditorCommand | undefined): Extract<
	AudioEditorCommand,
	{ readonly type: 'clip/transform-many' }
> {
	assert.equal(command?.type, 'clip/transform-many');
	if (command?.type !== 'clip/transform-many') assert.fail('Expected one transform-many command.');
	return command;
}

function timingSnapshot(views: ReadonlyMap<string, VideoSourceTimingView>): unknown {
	return [...views].map(([sourceId, view]) => view.kind === 'cfr'
		? [sourceId, view.kind, view.rate.num, view.rate.den, view.frameCount]
		: [sourceId, view.kind, view.index.presentationTicks.map(String)]);
}
