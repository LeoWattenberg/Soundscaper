/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAssistanceEditorialGenerationPlanV1 } from
	'../src/common/editor/assistance/editorial-generation-v1.ts';
import { createAssistanceVisualFramePackV2 } from
	'../src/common/editor/assistance/visual-frame-pack-v2.ts';
import { deriveLocalAssistanceReviewAuthority } from
	'../src/common/editor/ui/local-assistance-review-authority.ts';

test('Advanced visual review authority is derived from exact frame-pack source geometry and VFR ticks', async () => {
	const chunks = createAssistanceVisualFramePackV2({ sourceWidth: 1_920, sourceHeight: 1_080,
		rasterWidth: 2, rasterHeight: 1, timescale: 90_000, frames: [
			{ sourceFrame: 7, presentationTick: '1001', rgba: new Uint8Array(8) },
			{ sourceFrame: 9, presentationTick: '4004', rgba: new Uint8Array(8) },
		] });
	const authority = await deriveLocalAssistanceReviewAuthority(prepared(
		'optical-character-recognition', 'frame-pack',
		'application/vnd.soundscaper.frame-pack', new Blob(
			chunks.map((chunk) => chunk.slice().buffer as ArrayBuffer),
		),
	));
	assert.deepEqual(authority, { visualFrames: { width: 1_920, height: 1_080, timescale: 90_000,
		frames: [{ sourceFrame: 7, presentationTick: '1001' },
			{ sourceFrame: 9, presentationTick: '4004' }] } });
});

test('Advanced editorial review binds output strictly to candidate IDs in the staged plan', async () => {
	const plan = createAssistanceEditorialGenerationPlanV1([{
		candidateId: 'candidate-a', evidenceMode: 'transcript',
		transcriptExcerpt: 'Evidence only.', visualSummary: null,
	}]);
	const authority = await deriveLocalAssistanceReviewAuthority(prepared(
		'editorial-generation', 'editorial-context',
		'application/vnd.soundscaper.editorial-context+json',
		new Blob([JSON.stringify(plan)]),
	));
	assert.deepEqual(authority, { editorialCandidateIds: ['candidate-a'] });
});

function prepared(
	operation: 'optical-character-recognition' | 'editorial-generation',
	role: 'frame-pack' | 'editorial-context', mediaType: string, bytes: Blob,
) {
	return { sourceId: 'source-a', operation, selectionFence: {
		projectId: 'project-a', schemaVersion: 30, revision: 1, sequenceId: 'main',
		occurrenceIds: ['clip-a'], sourceId: 'source-a', sourceSha256: '1a'.repeat(32),
		sourceStartFrame: 0, sourceEndFrame: 1, linkMembershipSha256: '2b'.repeat(32),
		timingAuthoritySha256: '3c'.repeat(32),
	}, inputs: [{ role, mediaType, bytes }], outputs: [] } as never;
}
