/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { materializeAssistanceSelectedVideoAuthorityV1 } from
	'../desktop/assistance-selected-video-authority.ts';
import {
	createAssistanceSourceTimeRowChunksV1,
	reviewAssistanceSourceTimeRowsV1,
} from
	'../src/common/editor/assistance/source-time-rows-v1.ts';
import type { AssistanceWorkflowV1 } from '../src/common/editor/assistance/workflow.ts';

test('desktop materializes compact authority beyond 100,000 rows without losing exact ticks', () => {
	const sourceEndFrame = 100_001;
	const sourceSha256 = '12'.repeat(32);
	const timingAuthoritySha256 = '34'.repeat(32);
	const frames = createAssistanceSourceTimeRowChunksV1((function* () {
		for (let sourceFrame = 0; sourceFrame <= sourceEndFrame; sourceFrame += 1) {
			yield { sourceFrame, presentationTick: String(sourceFrame * 3 + 1),
				timelineFrame: sourceFrame * 2_000 };
		}
	})());
	const value = { descriptorVersion: 1, kind: 'selected-video-source-time-authority',
		schemaFamily: 'framescaper', schemaVersion: 1,
		projectId: 'project-a', projectRevision: 7, sequenceId: 'sequence-a',
		videoOccurrenceId: 'video-occurrence', sourceId: 'video-source', sourceSha256,
		timingAuthoritySha256, sourceWidth: 1_920, sourceHeight: 1_080,
		sourceStartFrame: 0, sourceEndFrame, sampleRate: 48_000, timescale: 90_000,
		selectionStartFrame: 0, selectionEndFrame: sourceEndFrame * 2_000, frames };
	const request = { fence: { projectId: 'project-a', schemaFamily: 'framescaper',
		schemaVersion: 1, revision: 7, sequenceId: 'sequence-a',
		sourceRanges: [{ mediaKind: 'video', sourceId: 'video-source', sourceSha256,
			timingAuthoritySha256, sourceStartFrame: 0, sourceEndFrame,
			occurrenceIds: ['video-occurrence'] }] } } as unknown as AssistanceWorkflowV1;
	const authority = materializeAssistanceSelectedVideoAuthorityV1({ value, request,
		videoClaim: { role: 'video', sha256: sourceSha256 } });
	assert.ok(authority.frames.length < 4, 'compact input must not expand into one object per frame');
	assert.equal((authority.frames[0] as { kind?: string }).kind, 'source-time-rows');
	assert.equal((authority.frames[0] as { bodyBase64?: string }).bodyBase64,
		frames[0]!.bodyBase64, 'complete chunks must be retained without re-encoding');
	assert.equal((authority.frames.at(-1) as { rowCount?: number }).rowCount,
		frames.at(-1)!.rowCount - 1, 'only the endpoint-bearing final chunk is rewritten');
	const reviewed = reviewAssistanceSourceTimeRowsV1(authority.frames);
	assert.equal(reviewed.rowCount, sourceEndFrame);
	assert.deepEqual(reviewed.last, { sourceFrame: 100_000,
		presentationTick: '300001', timelineFrame: 200_000_000 });
	assert.equal(authority.presentationEndTick, '300004');
	assert.ok(JSON.stringify(value).length < 4 * 1024 * 1024);
});

test('desktop refuses reordered compact source-time chunk custody', () => {
	const chunks = createAssistanceSourceTimeRowChunksV1([
		{ sourceFrame: 0, presentationTick: '1', timelineFrame: 0 },
		{ sourceFrame: 1, presentationTick: '2', timelineFrame: 2_000 },
	]);
	const damaged = [{ ...chunks[0]!, firstSourceFrame: 1 }];
	assert.throws(() => materializeAssistanceSelectedVideoAuthorityV1({
		value: { descriptorVersion: 1, kind: 'selected-video-source-time-authority',
			schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', projectRevision: 7, sequenceId: 'sequence-a',
			videoOccurrenceId: 'video-occurrence', sourceId: 'video-source',
			sourceSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
			sourceWidth: 1, sourceHeight: 1, sourceStartFrame: 0, sourceEndFrame: 1,
			sampleRate: 48_000, timescale: 1, selectionStartFrame: 0,
			selectionEndFrame: 2_000, frames: damaged },
		request: { fence: { projectId: 'project-a', schemaFamily: 'framescaper',
			schemaVersion: 1, revision: 7, sequenceId: 'sequence-a',
			sourceRanges: [{ mediaKind: 'video', sourceId: 'video-source',
				sourceSha256: '12'.repeat(32), timingAuthoritySha256: '34'.repeat(32),
				sourceStartFrame: 0, sourceEndFrame: 1,
				occurrenceIds: ['video-occurrence'] }] } } as unknown as AssistanceWorkflowV1,
		videoClaim: { role: 'video', sha256: '12'.repeat(32) },
	}), /summary|source-time|chunk/iu);
});
