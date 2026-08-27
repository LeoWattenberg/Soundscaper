/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyLocalAssistanceGuidedReviewMediaAuthority } from
	'../src/common/editor/controller/local-assistance-guided-review-media-verification.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { assistanceWorkflowFixture } from './helpers/assistance-workflow-fixture.ts';

test('review media with its own valid digest cannot substitute for another staged input claim', async () => {
	const body = new Blob(['self-consistent replacement'], { type: 'audio/wav' });
	const workflow = assistanceWorkflowFixture();
	await assert.rejects(verifyLocalAssistanceGuidedReviewMediaAuthority(workflow, {
		reviewAuthorityVersion: 1, audioWave: null, editorialCandidateIds: null,
		highlightVideoSignals: null,
		media: { audio: {
			stageId: 'detect-speech', slotId: 'audio', claimId: '0'.repeat(39) + '2',
			mediaType: body.type, byteLength: body.size,
			sha256: await digestMediaContent(body), body,
		}, video: null },
	}, new AbortController().signal), /exact workflow input claim/iu);
});
