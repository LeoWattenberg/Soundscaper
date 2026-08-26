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
import LocalAssistanceOutputReviewList from
	'../src/common/editor/ui/dialogs/LocalAssistanceOutputReview.tsx';

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
	role: 'voice-activity' | 'speaker-turns' | 'shot-boundaries',
	value: unknown,
): Promise<LocalAssistanceOutputReview> {
	return reviewBytes(role, new TextEncoder().encode(JSON.stringify(value)));
}

async function reviewBytes(
	role: 'voice-activity' | 'speaker-turns' | 'shot-boundaries',
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
