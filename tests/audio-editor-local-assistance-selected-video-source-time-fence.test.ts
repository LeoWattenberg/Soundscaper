import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesLocalAssistanceSelectedVideoSourceTimeFenceV1 } from '../src/common/editor/controller/assistance/local-assistance-selected-video-source-time.ts';

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
