import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesLocalAssistanceSelectedVideoSourceTimeFenceV1 } from '../src/common/editor/controller/assistance/local-assistance-selected-video-source-time.ts';
import {
	correlateSelectedVideoDescriptor,
	UnavailableError,
} from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-admission.ts';
import { prepareLocalAssistanceGuidedHighlightInputsV1 } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-highlight-preparation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';

const fence = Object.freeze({
	projectId: 'project',
	schemaFamily: 'framescaper',
	schemaVersion: 12,
	revision: 7,
	sequenceId: 'sequence',
	occurrenceIds: Object.freeze(['video-clip', 'audio-clip']),
	sourceId: 'video-source',
	sourceSha256: 'ab'.repeat(32),
	sourceStartFrame: 12,
	sourceEndFrame: 48,
	timingAuthoritySha256: 'cd'.repeat(32),
});

const descriptor = Object.freeze({
	descriptorVersion: 1,
	kind: 'selected-video-source-time-authority',
	schemaFamily: fence.schemaFamily,
	schemaVersion: fence.schemaVersion,
	projectId: fence.projectId,
	projectRevision: fence.revision,
	sequenceId: fence.sequenceId,
	videoOccurrenceId: 'video-clip',
	sourceId: fence.sourceId,
	sourceSha256: fence.sourceSha256,
	timingAuthoritySha256: fence.timingAuthoritySha256,
	sourceStartFrame: fence.sourceStartFrame,
	sourceEndFrame: fence.sourceEndFrame,
});

test('selected-video source-time matching binds every fence field and occurrence', () => {
	assert.equal(matchesLocalAssistanceSelectedVideoSourceTimeFenceV1(descriptor, fence), true);
	for (const [field, value] of [
		['descriptorVersion', 2],
		['kind', 'other'],
		['schemaFamily', 'soundscaper'],
		['schemaVersion', 11],
		['projectId', 'other-project'],
		['projectRevision', 8],
		['sequenceId', 'other-sequence'],
		['sourceId', 'other-source'],
		['sourceSha256', 'ef'.repeat(32)],
		['timingAuthoritySha256', '01'.repeat(32)],
		['sourceStartFrame', 13],
		['sourceEndFrame', 49],
		['videoOccurrenceId', 'missing-clip'],
	] as const) {
		assert.equal(
			matchesLocalAssistanceSelectedVideoSourceTimeFenceV1({ ...descriptor, [field]: value }, fence),
			false,
			field,
		);
	}
});

test('selected-video source-time matching is a total pure predicate', () => {
	for (const value of [null, [], new Uint8Array(), 'descriptor', 1]) {
		assert.equal(matchesLocalAssistanceSelectedVideoSourceTimeFenceV1(value, fence), false);
	}
});

test('source-time fence callers retain their distinct failure contracts', async () => {
	const callerFence = Object.freeze({
		...fence,
		schemaVersion: 1 as const,
		linkMembershipSha256: 'ef'.repeat(32),
	});
	const callerDescriptor = Object.freeze({
		...descriptor,
		schemaVersion: 1 as const,
		sourceWidth: 1_920,
		sourceHeight: 1_080,
		sampleRate: 1_000,
		timescale: 1_000,
		selectionStartFrame: 0,
		selectionEndFrame: 1_000,
		frames: Object.freeze([
			Object.freeze({ sourceFrame: 12, presentationTick: '0', timelineFrame: 0 }),
			Object.freeze({ sourceFrame: 48, presentationTick: '1000', timelineFrame: 1_000 }),
		]),
	});
	const staleDescriptor = { ...callerDescriptor, projectId: 'stale-project' };
	assert.throws(
		() => correlateSelectedVideoDescriptor(staleDescriptor, callerFence),
		(error: unknown) => {
			assert.ok(error instanceof UnavailableError);
			assert.equal(error.reason, 'timing-authority-unavailable');
			assert.equal(error.message,
				'Guided preparation is unavailable: timing-authority-unavailable');
			return true;
		},
	);
	await assert.rejects(prepareLocalAssistanceGuidedHighlightInputsV1({
		project: {},
		inventory: [],
		settings: defaultAssistanceWorkflowSettingsV1('make-highlights'),
		signal: new AbortController().signal,
		describeSelectedVideoSourceTime: async () => ({
			selectionFence: callerFence,
			descriptor: staleDescriptor,
		}),
		prepareSelectedMedia: async () => assert.fail('a stale fence must fail before media preparation'),
	}), {
		name: 'Error',
		message: 'Highlight video timing authority changed during preparation.',
	});
});
