/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createLocalAssistanceResultAcceptance,
} from '../src/common/editor/controller/local-assistance-result-acceptance.ts';

const MODEL_SHA256 = '12'.repeat(32);
const FENCE = Object.freeze({
	projectId: 'project-1', schemaVersion: 30, revision: 4,
	sequenceId: 'main-sequence', occurrenceIds: Object.freeze(['voice-clip']),
	sourceId: 'voice-source', sourceSha256: 'ab'.repeat(32),
	sourceStartFrame: 0, sourceEndFrame: 96_000,
	linkMembershipSha256: 'cd'.repeat(32), timingAuthoritySha256: 'ef'.repeat(32),
});

function request() {
	return Object.freeze({
		selectionFence: FENCE,
		models: Object.freeze([Object.freeze({
			modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition',
			artifactSha256s: Object.freeze([MODEL_SHA256]),
		})]),
		review: Object.freeze({
			kind: 'transcript' as const, language: 'en',
			segments: Object.freeze([Object.freeze({
				startSeconds: 0, endSeconds: 2, text: 'um hello hello', speaker: null,
				words: Object.freeze([
					Object.freeze({ text: 'um', startSeconds: 0, endSeconds: 0.25, confidence: 0.9 }),
					Object.freeze({ text: 'hello', startSeconds: 0.5, endSeconds: 1, confidence: 0.9 }),
					Object.freeze({ text: 'hello', startSeconds: 1, endSeconds: 1.5, confidence: 0.9 }),
				]),
			})]),
		}),
		voiceActivity: null,
	});
}

test('result acceptance exposes explicit deterministic cleanup decisions without auto-apply', async () => {
	let commits = 0;
	const authority = Object.freeze({
		project: Object.freeze({
			id: 'project-1', schemaVersion: 30, revision: 4, sampleRate: 48_000,
			tracks: Object.freeze([Object.freeze({
				id: 'voice-track', type: 'audio', clipIds: Object.freeze(['voice-clip']),
			})]),
		}),
		track: Object.freeze({ id: 'voice-track', type: 'audio', clipIds: Object.freeze(['voice-clip']) }),
		startFrame: 0, endFrame: 96_000, sourceStartFrame: 0, sourceEndFrame: 96_000,
		fence: FENCE,
	});
	const acceptance = createLocalAssistanceResultAcceptance({
		currentAuthority: () => authority,
		captureProject: () => authority.project,
		assertProject: () => undefined,
		commit: () => { commits += 1; },
	});

	const snapshot = await acceptance.prepareTranscriptCleanup(request());
	assert.deepEqual(snapshot.proposals.map(({ kind, text }) => ({ kind, text })), [
		{ kind: 'filler', text: 'um' },
		{ kind: 'repetition', text: 'hello' },
	]);
	assert.equal(commits, 0);
	await acceptance.rejectTranscriptCleanup();
	assert.equal(commits, 0);
});
