/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import type {
	LocalAssistanceOutputClaim,
	LocalAssistanceOutputRole,
} from '../src/common/editor/ui/local-assistance-bridge.ts';
import {
	reviewLocalAssistanceOutput,
	type LocalAssistanceOutputReview,
} from '../src/common/editor/ui/local-assistance-result-review.ts';
import { createAssistanceEmbeddingMatrixV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';
import LocalAssistanceOutputReviewList from
	'../src/common/editor/ui/dialogs/LocalAssistanceOutputReview.tsx';
import { encodeWav } from '../src/common/editor/wav.js';

const JOB_ID = 'a'.repeat(40);
const CLAIM_ID = 'b'.repeat(40);
const SHA256 = 'c'.repeat(64);

test('voice-activity review admits exact ordered disjoint 16 kHz ranges', async () => {
	const reviewed = await review('voice-activity', {
		sampleRate: 16_000,
		segments: [
			{ startSample: 0, sampleCount: 4_000 },
			{ startSample: 8_000, sampleCount: 8_000 },
		],
	});
	assert.deepEqual(reviewed, {
		kind: 'voice-activity', sampleRate: 16_000,
		segments: [
			{ startSample: 0, sampleCount: 4_000 },
			{ startSample: 8_000, sampleCount: 8_000 },
		],
	});
	const markup = render(reviewed, 'voice-activity');
	assert.match(markup, /0–4000 samples/u);
	assert.match(markup, /0–0\.25 s/u);
	assert.match(markup, /8000–16000 samples/u);
	assert.doesNotMatch(markup, /confidence|speaker id/iu);
});

test('speaker-turn review admits overlap in stable order and renders only exact speaker IDs', async () => {
	const reviewed = await review('speaker-turns', {
		sampleRate: 16_000,
		turns: [
			{ startSample: 4_000, sampleCount: 24_000, speakerId: 0 },
			{ startSample: 24_000, sampleCount: 20_000, speakerId: 1 },
		],
	});
	assert.deepEqual(reviewed, {
		kind: 'speaker-turns', sampleRate: 16_000,
		turns: [
			{ startSample: 4_000, sampleCount: 24_000, speakerId: 0 },
			{ startSample: 24_000, sampleCount: 20_000, speakerId: 1 },
		],
	});
	const markup = render(reviewed, 'speaker-turns');
	assert.match(markup, /Speaker ID 0/u);
	assert.match(markup, /4000–28000 samples/u);
	assert.match(markup, /0\.25–1\.75 s/u);
	assert.match(markup, /Speaker ID 1/u);
	assert.doesNotMatch(markup, /confidence|Speaker A/iu);
});

test('shot-boundary review admits exact source ordinals and renders detector evidence', async () => {
	const reviewed = await review('shot-boundaries', {
		schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 90_000,
		sourceFrameCount: 240,
		boundaries: [{ sourceFrame: 24, presentationTick: '90090', score: 0.425 }],
	});
	assert.deepEqual(reviewed, {
		kind: 'shot-boundaries', schemaVersion: 1, detector: 'ffmpeg-scdet', timescale: 90_000,
		sourceFrameCount: 240,
		boundaries: [{ sourceFrame: 24, presentationTick: '90090', score: 0.425 }],
	});
	const markup = render(reviewed, 'shot-boundaries');
	assert.match(markup, /Source frame 24/u);
	assert.match(markup, /42\.5%/u);
	assert.match(markup, /90090\/90000/u);
});

test('word alignment, excitement tags, and beats receive bounded semantic review', async () => {
	const alignment = await review('word-alignment', {
		schemaVersion: 1, sampleRate: 16_000,
		words: [{ segmentIndex: 0, wordIndex: 0, text: 'Aligned', startSample: 100,
			endSample: 1_600, confidence: 0.8 }],
	});
	assert.equal(alignment.kind, 'word-alignment');
	assert.match(render(alignment, 'word-alignment'), /Aligned.*100–1600 samples.*80%/su);

	const tags = await review('audio-tags', {
		schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: [{ startSample: 0, scores: { laughter: 0.75, applause: 0.2, cheering: 0 } }],
	});
	assert.equal(tags.kind, 'audio-tags');
	assert.match(render(tags, 'audio-tags'), /Laughter 75%.*Applause 20%.*Cheering 0%/su);

	const beats = await review('beat-grid', {
		schemaVersion: 1, sampleRate: 22_050,
		points: [{ sample: 0, kind: 'downbeat', confidence: 0.9 }],
		tempoProposal: { kind: 'constant', bpm: 120 },
	});
	assert.equal(beats.kind, 'beat-grid');
	assert.match(render(beats, 'beat-grid'), /Downbeat.*sample 0.*90%.*120 BPM/su);
});

test('binary embedding matrices receive normalized dimensional review', async () => {
	const bytes = createAssistanceEmbeddingMatrixV1({
		dimensions: 3,
		vectors: [[1, 0, 0], [0, 1, 0]],
	});
	const body = new Blob([bytes], { type: 'application/vnd.soundscaper.embedding-matrix-v1' });
	const reviewed = await reviewLocalAssistanceOutput(
		claim('embeddings', body.type, body), body,
	);
	assert.equal(reviewed.kind, 'embeddings');
	assert.match(render(reviewed, 'embeddings'), /2 normalized vectors.*3 dimensions/u);
});

test('enhancement and separation WAVs require exact authenticated Float32 geometry', async () => {
	const bytes = encodeWav([
		Float32Array.of(0.25, -0.25, 0.5),
		Float32Array.of(-0.5, 0.75, 0),
	], { sampleRate: 48_000, bitDepth: 32, float: true, dither: false });
	const body = new Blob([bytes], { type: 'audio/wav' });
	const authority = { audioWave: { sampleRate: 48_000, channelCount: 2, frameCount: 3 } };
	for (const role of ['enhanced-audio', 'separated-audio'] as const) {
		const reviewed = await reviewLocalAssistanceOutput(
			claim(role, body.type, body), body, authority,
		);
		assert.deepEqual(reviewed, {
			kind: 'audio-wave', role, sampleRate: 48_000, channelCount: 2,
			frameCount: 3, sampleFormat: 'float32',
		});
		const markup = render(reviewed, role);
		assert.match(markup, /Float32 WAV/u);
		assert.match(markup, /2 channels/u);
		assert.match(markup, /3 frames/u);
		assert.match(markup, /48000 Hz/u);
	}
});

test('audio WAV review is header-bounded and does not inherit the JSON body limit', async () => {
	const frames = 2_100_000;
	const bytes = encodeWav([new Float32Array(frames)], {
		sampleRate: 48_000, bitDepth: 32, float: true, dither: false,
	});
	assert.ok(bytes.byteLength > 8 * 1024 * 1024);
	const body = new Blob([bytes], { type: 'audio/wav' });
	const reviewed = await reviewLocalAssistanceOutput(
		claim('enhanced-audio', body.type, body), body,
		{ audioWave: { sampleRate: 48_000, channelCount: 1, frameCount: frames } },
	);
	assert.equal(reviewed.kind, 'audio-wave');
});

test('audio WAV review rejects missing authority, inexact geometry, integer PCM, and extra bytes', async () => {
	const floatBytes = encodeWav([Float32Array.of(0, 0)], {
		sampleRate: 48_000, bitDepth: 32, float: true, dither: false,
	});
	const floatBody = new Blob([floatBytes], { type: 'audio/wav' });
	const outputClaim = claim('enhanced-audio', floatBody.type, floatBody);
	await assert.rejects(
		reviewLocalAssistanceOutput(outputClaim, floatBody),
		/exact audio geometry authority/iu,
	);
	for (const audioWave of [
		{ sampleRate: 44_100, channelCount: 1, frameCount: 2 },
		{ sampleRate: 48_000, channelCount: 2, frameCount: 2 },
		{ sampleRate: 48_000, channelCount: 1, frameCount: 3 },
	] as const) {
		await assert.rejects(
			reviewLocalAssistanceOutput(outputClaim, floatBody, { audioWave }),
			/exact audio geometry/iu,
		);
	}

	const integerBytes = encodeWav([Float32Array.of(0, 0)], {
		sampleRate: 48_000, bitDepth: 32, dither: false,
	});
	const integerBody = new Blob([integerBytes], { type: 'audio/wav' });
	await assert.rejects(reviewLocalAssistanceOutput(
		claim('enhanced-audio', integerBody.type, integerBody), integerBody,
		{ audioWave: { sampleRate: 48_000, channelCount: 1, frameCount: 2 } },
	), /Float32/iu);

	const paddedBody = new Blob([floatBytes, Uint8Array.of(0)], { type: 'audio/wav' });
	await assert.rejects(reviewLocalAssistanceOutput(
		claim('enhanced-audio', paddedBody.type, paddedBody), paddedBody,
		{ audioWave: { sampleRate: 48_000, channelCount: 1, frameCount: 2 } },
	), /canonical|extra/iu);
});

test('editorial review admits known identities only and renders generated fields as text', async () => {
	const value = {
		schemaVersion: 1,
		candidates: [{
			candidateId: 'candidate-2', title: 'A compact title', hook: 'Start here',
			chapters: ['Opening', 'Payoff'], explanation: 'Known evidence supports this order.',
		}, {
			candidateId: 'candidate-1', title: null, hook: null, chapters: [], explanation: null,
		}],
	};
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const body = new Blob([bytes], { type: 'application/vnd.soundscaper.editorial-proposal+json' });
	const reviewed = await reviewLocalAssistanceOutput(
		claim('editorial-proposal', body.type, body), body,
		{ editorialCandidateIds: ['candidate-1', 'candidate-2'] },
	);
	assert.equal(reviewed.kind, 'editorial-proposal');
	const markup = render(reviewed, 'editorial-proposal');
	assert.match(markup, /A compact title/u);
	assert.match(markup, /Start here/u);
	assert.match(markup, /Opening/u);
	assert.match(markup, /Known evidence supports this order/u);

	await assert.rejects(reviewLocalAssistanceOutput(
		claim('editorial-proposal', body.type, body), body,
		{ editorialCandidateIds: ['candidate-1', 'candidate-3'] },
	), /unknown candidate/iu);
	await assert.rejects(reviewLocalAssistanceOutput(
		claim('editorial-proposal', body.type, body), body,
	), /candidate authority/iu);
});

test('voice-activity review rejects inexact JSON, rates, and unsafe or overlapping geometry', async () => {
	await assert.rejects(reviewBytes('voice-activity', new Uint8Array([0xc3, 0x28])),
		/valid UTF-8 JSON/u);
	for (const value of [
		{ sampleRate: 48_000, segments: [] },
		{ sampleRate: 16_000, segments: [], confidence: 1 },
		{ sampleRate: 16_000, segments: [{ startSample: 0, sampleCount: 1, confidence: 1 }] },
		{ sampleRate: 16_000, segments: [{ startSample: 0, sampleCount: 0 }] },
		{ sampleRate: 16_000, segments: [{ startSample: Number.MAX_SAFE_INTEGER, sampleCount: 1 }] },
		{ sampleRate: 16_000, segments: [
			{ startSample: 100, sampleCount: 100 },
			{ startSample: 199, sampleCount: 10 },
		] },
	] as const) {
		await assert.rejects(review('voice-activity', value));
	}
});

test('speaker-turn review rejects inexact JSON and unstable or unsafe identity geometry', async () => {
	for (const value of [
		{ sampleRate: 8_000, turns: [] },
		{ sampleRate: 16_000, turns: [], labels: [] },
		{ sampleRate: 16_000, turns: [{
			startSample: 0, sampleCount: 100, speakerId: 0, confidence: 0.9,
		}] },
		{ sampleRate: 16_000, turns: [{ startSample: 0, sampleCount: 100, speakerId: -1 }] },
		{ sampleRate: 16_000, turns: [{
			startSample: Number.MAX_SAFE_INTEGER, sampleCount: 1, speakerId: 0,
		}] },
		{ sampleRate: 16_000, turns: [
			{ startSample: 150, sampleCount: 100, speakerId: 1 },
			{ startSample: 100, sampleCount: 200, speakerId: 0 },
		] },
		{ sampleRate: 16_000, turns: [
			{ startSample: 100, sampleCount: 200, speakerId: 1 },
			{ startSample: 100, sampleCount: 200, speakerId: 0 },
		] },
	] as const) {
		await assert.rejects(review('speaker-turns', value));
	}
});

test('semantic review requires the output role-specific JSON media type', async () => {
	const value = { sampleRate: 16_000, segments: [] };
	const body = jsonBody(value);
	await assert.rejects(reviewLocalAssistanceOutput(
		claim('voice-activity', 'application/vnd.soundscaper.speaker-turns+json', body), body,
	), /no semantic reviewer/u);
});

async function review(
	role: 'voice-activity' | 'speaker-turns' | 'shot-boundaries'
		| 'word-alignment' | 'audio-tags' | 'beat-grid',
	value: unknown,
): Promise<LocalAssistanceOutputReview> {
	return reviewBytes(role, new TextEncoder().encode(JSON.stringify(value)));
}

async function reviewBytes(
	role: 'voice-activity' | 'speaker-turns' | 'shot-boundaries'
		| 'word-alignment' | 'audio-tags' | 'beat-grid',
	bytes: Uint8Array,
): Promise<LocalAssistanceOutputReview> {
	const buffer = new ArrayBuffer(bytes.byteLength);
	new Uint8Array(buffer).set(bytes);
	const body = new Blob([buffer], { type: `application/vnd.soundscaper.${role}+json` });
	return reviewLocalAssistanceOutput(claim(role, body.type, body), body);
}

function render(reviewed: LocalAssistanceOutputReview, role: LocalAssistanceOutputRole): string {
	const body = jsonBody({});
	return renderToStaticMarkup(<LocalAssistanceOutputReviewList
		copy={{}}
		outputs={[{ claim: claim(role, `application/vnd.soundscaper.${role}+json`, body), review: reviewed }]}
	/>);
}

function jsonBody(value: unknown): Blob {
	return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

function claim(role: LocalAssistanceOutputRole, mediaType: string, body: Blob): LocalAssistanceOutputClaim {
	return Object.freeze({
		claimVersion: 1, claimId: CLAIM_ID, jobId: JOB_ID, role, mediaType,
		byteLength: body.size, sha256: SHA256,
	});
}
