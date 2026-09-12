/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareLocalAssistanceAlignmentContext } from
	'../src/common/editor/controller/assistance/internal/local-assistance-alignment-context.ts';

function input(overrides: Readonly<Record<string, unknown>> = {}) {
	const body = { schemaVersion: 1, sourceId: 'voice-source', sampleRate: 48_000,
		language: 'en', modelId: 'whisper-large-v3-turbo-ggml',
		segments: [{ startFrame: 24_000, endFrame: 72_000, text: 'First second',
			words: [{ text: 'First', startFrame: 24_000, endFrame: 48_000, confidence: null },
				{ text: 'second', startFrame: 48_000, endFrame: 72_000, confidence: null }],
			speaker: null }], ...overrides };
	return { bytes: new Blob([JSON.stringify(body)]), mediaType: 'application/vnd.soundscaper.transcript+json',
		fence: { projectId: 'project-1', schemaFamily: 'soundscaper' as const, schemaVersion: 1 as const,
			revision: 1, sequenceId: 'sequence-1', occurrenceIds: ['clip-1'], sourceId: 'voice-source',
			sourceSha256: 'a'.repeat(64), sourceStartFrame: 36_000, sourceEndFrame: 96_000,
			linkMembershipSha256: 'b'.repeat(64), timingAuthoritySha256: 'c'.repeat(64) } };
}

test('alignment clips by complete timed words and rebases to the selected audio', async () => {
	const selected = input();
	const originalBody = await selected.bytes.text();
	const projected = await prepareLocalAssistanceAlignmentContext(selected, 48_000);
	assert.ok(projected);
	assert.deepEqual(JSON.parse(await projected.bytes.text()), {
		language: 'en', segments: [{ startSeconds: 0.25, endSeconds: 0.75, text: 'second' }],
	});
	assert.equal(await selected.bytes.text(), originalBody);
});

test('alignment refuses non-English, empty, and untimed partial transcripts', async () => {
	assert.equal(await prepareLocalAssistanceAlignmentContext(input({ language: 'de' }), 48_000), null);
	assert.equal(await prepareLocalAssistanceAlignmentContext(input({ segments: [] }), 48_000), null);
	const partial = input({ segments: [{ startFrame: 24_000, endFrame: 72_000,
		text: 'First second', words: [], speaker: null }] });
	assert.equal(await prepareLocalAssistanceAlignmentContext(partial, 48_000), null);
});

test('alignment keeps source identity and sample-rate authentication', async () => {
	await assert.rejects(prepareLocalAssistanceAlignmentContext(input({ sourceId: 'other' }), 48_000),
		/authority/iu);
	await assert.rejects(prepareLocalAssistanceAlignmentContext(input(), 44_100), /authority/iu);
});
