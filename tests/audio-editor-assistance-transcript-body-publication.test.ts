/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
} from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import {
	createAssistanceTranscriptBodyPublicationV1,
	type AssistanceTranscriptBodyPublicationRequestV1,
} from '../src/common/editor/assistance/transcript-body-publication-v1.ts';

const SOURCE_SHA256 = '1'.repeat(64);
const MODEL_SHA256_A = 'a'.repeat(64);
const MODEL_SHA256_B = 'b'.repeat(64);

function request(
	overrides: Partial<AssistanceTranscriptBodyPublicationRequestV1> = {},
): AssistanceTranscriptBodyPublicationRequestV1 {
	return {
		assetId: 'transcript-interview-selection',
		review: {
			kind: 'transcript',
			language: 'en',
			segments: [{
				startSeconds: 0.1,
				endSeconds: 1.25,
				text: 'Hello there',
				words: [{
					text: 'Hello', startSeconds: 0.1, endSeconds: 0.55, confidence: 0.9,
				}, {
					text: 'there', startSeconds: 0.6, endSeconds: 1.25, confidence: null,
				}],
				speaker: null,
			}],
		},
		selectedMedia: {
			selectionFence: {
				projectId: 'project-1', schemaVersion: 30, revision: 7,
				sequenceId: 'sequence-1', occurrenceIds: ['clip-1'],
				sourceId: 'source-1', sourceSha256: SOURCE_SHA256,
				sourceStartFrame: 4_800, sourceEndFrame: 100_800,
				linkMembershipSha256: '2'.repeat(64),
				timingAuthoritySha256: '3'.repeat(64),
			},
			sampleRate: 48_000,
			sourceVideoTimingSha256: null,
		},
		model: {
			modelId: 'parakeet-tdt-0.6b-v2',
			artifactSha256s: [MODEL_SHA256_B, MODEL_SHA256_A],
		},
		recipe: { id: 'speech-transcript', version: 1 },
		...overrides,
	};
}

test('publishes deterministic canonical transcript bytes and a strict content reference', () => {
	const first = createAssistanceTranscriptBodyPublicationV1(request());
	const second = createAssistanceTranscriptBodyPublicationV1(request({
		review: {
			segments: [{
				speaker: null,
				words: [{
					confidence: 0.9, endSeconds: 0.55, startSeconds: 0.1, text: 'Hello',
				}, {
					confidence: null, endSeconds: 1.25, startSeconds: 0.6, text: 'there',
				}],
				text: 'Hello there', endSeconds: 1.25, startSeconds: 0.1,
			}],
			language: 'en',
			kind: 'transcript',
		},
		model: {
			modelId: 'parakeet-tdt-0.6b-v2',
			artifactSha256s: [MODEL_SHA256_A, MODEL_SHA256_B],
		},
	}));

	assert.deepEqual(first, second, 'artifact input order does not change canonical publication');
	assert.equal(first.reference.kind, 'transcript-v1');
	assert.equal(first.reference.sourceStartFrame, 4_800);
	assert.equal(first.reference.sourceEndFrame, 100_800);
	assert.deepEqual(first.reference.modelArtifactSha256s, [MODEL_SHA256_A, MODEL_SHA256_B]);
	assert.equal(first.reference.body.mimeType, ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1);
	assert.equal(first.reference.body.byteLength, first.bytes.byteLength);
	assert.deepEqual(first.selectionFence, request().selectedMedia.selectionFence);
	assert.equal(first.reference.body.storageKey,
		`assistance-transcript-sha256:${first.reference.body.sha256}`);
	assert.equal(first.reference.body.sha256,
		'cbfadde5888917df8a4e6e22a5a3b7fcae0c81d2bde45657b8cc09a4d895f553');
});

test('normalizes reviewed seconds into absolute source frames and one canonical JSON field order', () => {
	const publication = createAssistanceTranscriptBodyPublicationV1(request());
	const json = new TextDecoder().decode(publication.bytes);

	assert.equal(json, '{"schemaVersion":1,"sourceId":"source-1","sampleRate":48000,'
		+ '"language":"en","modelId":"parakeet-tdt-0.6b-v2","segments":['
		+ '{"startFrame":9600,"endFrame":64800,"text":"Hello there","words":['
		+ '{"text":"Hello","startFrame":9600,"endFrame":31200,"confidence":0.9},'
		+ '{"text":"there","startFrame":33600,"endFrame":64800,"confidence":null}],'
		+ '"speaker":null}]}');
	assert.deepEqual(JSON.parse(json), publication.body);
	assert.equal(publication.body.segments[0]?.startFrame, 4_800 + Math.round(0.1 * 48_000));
});

test('refuses malformed review and exact publication metadata', () => {
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1(request({
		review: { kind: 'captions' } as never,
	})), /transcript review/iu);
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1(request({
		selectedMedia: { ...request().selectedMedia, sampleRate: 0 },
	})), /sample rate/iu);
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1(request({
		model: {
			modelId: 'parakeet-tdt-0.6b-v2',
			artifactSha256s: [MODEL_SHA256_A, MODEL_SHA256_A],
		},
	})), /sorted and unique|duplicate/iu);
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1(request({
		model: {
			modelId: 'parakeet-tdt-0.6b-v2', version: 'unrepresented',
			artifactSha256s: [MODEL_SHA256_A],
		} as never,
	})), /unsupported field/iu);
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1(request({
		recipe: { id: 'speech-transcript', version: 0 },
	})), /recipe version/iu);
	assert.throws(() => createAssistanceTranscriptBodyPublicationV1({
		...request(), unsupported: true,
	} as never), /unsupported field/iu);
});
