/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import {
	createVideoEdgeTrimResultReporter,
	type VideoEdgeTrimFeedbackCopy,
} from '../src/common/editor/controller/video-edge-trim-feedback.ts';
import { createVideoEdgeTrimService } from '../src/common/editor/controller/video-edge-trim-service.ts';
import type {
	FrameCanonicalEdgeTrimPlan,
	FrameCanonicalEdgeTrimRequest,
} from '../src/common/editor/frame-canonical-edge-trim-domain.ts';
import { projectForCommand } from '../src/common/editor/project-command-projection.ts';
import { createPersistedVideoProject } from './helpers/persisted-video-project-fixture.ts';

const COPY: VideoEdgeTrimFeedbackCopy = Object.freeze({
	trimLeftEdgeApplied: 'Left edge trimmed to {timecode}',
	trimRightEdgeApplied: 'Right edge trimmed to {timecode}',
	trimBoundaryClamped: '(clamped)',
	noTrimAvailable: 'No trim was available',
});

test('changed feedback formats the actual left boundary as sequence timecode and succeeds', () => {
	const labels: unknown[][] = [];
	const statuses: unknown[][] = [];
	const report = createVideoEdgeTrimResultReporter({
		copy: COPY,
		label: (sample, sequenceId) => {
			labels.push([sample, sequenceId]);
			return '01:00:00:06';
		},
		setStatus: (...args) => statuses.push(args),
	});

	report(plan({
		kind: 'transform', edge: 'left', requestedBoundarySample: 9_601,
		boundarySample: 9_600, clamped: false,
	}));

	assert.deepEqual(labels, [[9_600, 'sequence-main']]);
	assert.deepEqual(statuses, [['Left edge trimmed to 01:00:00:06', 'success']]);
});

test('changed feedback identifies a clamped right edge without formatting the request', () => {
	const labels: unknown[][] = [];
	const statuses: unknown[][] = [];
	const report = createVideoEdgeTrimResultReporter({
		copy: COPY,
		label: (sample, sequenceId) => {
			labels.push([sample, sequenceId]);
			return '01:00:00:24';
		},
		setStatus: (...args) => statuses.push(args),
	});

	report(plan({
		kind: 'transform', edge: 'right', requestedBoundarySample: 99_999,
		boundarySample: 38_400, clamped: true,
	}));

	assert.deepEqual(labels, [[38_400, 'sequence-main']]);
	assert.deepEqual(statuses, [[
		'Right edge trimmed to 01:00:00:24 (clamped)', 'success',
	]]);
});

test('no-op feedback reports localized information without claiming success or reading timecode', () => {
	const statuses: unknown[][] = [];
	const report = createVideoEdgeTrimResultReporter({
		copy: COPY,
		label: () => assert.fail('A no-op has no applied timecode to format.'),
		setStatus: (...args) => statuses.push(args),
	});

	report(plan({ kind: 'noop', edge: 'right', boundarySample: 48_000 }));

	assert.deepEqual(statuses, [['No trim was available', 'info']]);
});

test('the service reports only commit outcomes, after a successful mutation or a no-op', () => {
	const events: string[] = [];
	const service = serviceHarness(events);
	const changed = request('right', 38_400);

	service.preview(changed);
	assert.deepEqual(events, []);
	assert.equal(service.commit(changed).kind, 'transform');
	assert.deepEqual(events, ['commit:clip/transform-many', 'report:transform']);

	events.length = 0;
	assert.equal(service.commit(request('right', 48_000)).kind, 'noop');
	assert.deepEqual(events, ['report:noop']);
});

test('blocked, refused, and failed commits never publish trim-result feedback', () => {
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = projectForCommand(fixture.project as unknown as Record<string, unknown>);
	const events: string[] = [];
	const common = {
		lifetime: { assertActive: () => undefined },
		getProject: () => project,
		reportResult: (result: FrameCanonicalEdgeTrimPlan) => events.push(`report:${result.kind}`),
	};
	const blocked = createVideoEdgeTrimService({
		...common, editingBlocked: () => true,
		commit: () => assert.fail('Blocked editing must not commit.'),
	});
	assert.throws(() => blocked.commit(request('right', 38_400)), /editing.*blocked/iu);
	assert.deepEqual(events, []);

	const refused = createVideoEdgeTrimService({
		...common, editingBlocked: () => false,
		commit: () => assert.fail('A refused plan must not commit.'),
	});
	assert.throws(() => refused.commit({
		activeClipId: 'missing', edge: 'right', requestedBoundarySample: 38_400,
	}), /clip|unknown/iu);
	assert.deepEqual(events, []);

	const failed = createVideoEdgeTrimService({
		...common, editingBlocked: () => false,
		commit: () => { throw new Error('commit failed'); },
	});
	assert.throws(() => failed.commit(request('right', 38_400)), /commit failed/u);
	assert.deepEqual(events, []);
});

function serviceHarness(events: string[]) {
	const fixture = createPersistedVideoProject({ timeline: true });
	const project = projectForCommand(fixture.project as unknown as Record<string, unknown>);
	return createVideoEdgeTrimService({
		lifetime: { assertActive: () => undefined },
		getProject: () => project,
		editingBlocked: () => false,
		commit: (command: AudioEditorCommand) => events.push(`commit:${command.type}`),
		reportResult: (result) => events.push(`report:${result.kind}`),
	});
}

function request(edge: 'left' | 'right', requestedBoundarySample: number): FrameCanonicalEdgeTrimRequest {
	return Object.freeze({
		activeClipId: 'persisted-timeline-video', edge, requestedBoundarySample,
	});
}

function plan(overrides: Readonly<{
	kind: 'noop' | 'transform';
	edge: 'left' | 'right';
	requestedBoundarySample?: number;
	boundarySample: number;
	clamped?: boolean;
}>): FrameCanonicalEdgeTrimPlan {
	const diagnostics = {
		activeClipId: 'video-clip',
		edge: overrides.edge,
		sequenceId: 'sequence-main',
		requestedBoundarySample: overrides.requestedBoundarySample ?? overrides.boundarySample,
		requestedSequenceFrame: 24,
		appliedSequenceFrame: 24,
		sequenceFrameDelta: 1,
		resolvedSampleDelta: 1_600,
		boundarySample: overrides.boundarySample,
		clamped: overrides.clamped ?? false,
		participantClipIds: Object.freeze(['video-clip']),
	};
	return overrides.kind === 'noop'
		? Object.freeze({
			...diagnostics, kind: 'noop', transforms: [] as const, previews: [] as const,
		})
		: Object.freeze({
			...diagnostics,
			kind: 'transform',
			transforms: Object.freeze([Object.freeze({
				clipId: 'video-clip', trackId: 'video-track', changes: Object.freeze({}),
			})]),
			previews: Object.freeze([Object.freeze({
				clipId: 'video-clip', trackId: 'video-track',
				timelineStartFrame: 0, durationFrames: 1_600,
				sourceStartFrame: 0, sourceDurationFrames: 1_600,
				trimStartFrames: 0, trimEndFrames: 0,
				fadeInFrames: 0, fadeOutFrames: 0,
			})]),
		});
}
