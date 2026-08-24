/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import type { ProductNativeRenderInputOperation } from '../src/common/editor/controller/product-native-render-input-authority.ts';
import { createFramescaperNativeAudioCarrierV28 } from '../src/framescaper/editor-native-render-audio-carrier-v28.ts';
import { createFramescaperNativeRenderPlanAuthorityV28 } from '../src/framescaper/editor-native-render-plan-authority-v28.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV28 } from '../src/framescaper/editor-project-unified-render-plan-v28.ts';
import { FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v28.ts';
import { createFramescaperProjectV28 } from '../src/framescaper/editor-project-v28.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V28_PROJECT_RUNTIME_PROFILE;

test('selected V28 renders the immutable audio range into an exact float32 WAV carrier', async () => {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	assert.equal(plan.output.includeAudio, true);
	assert.deepEqual(plan.codecs, {
		video: 'prores', videoEncoder: 'prores_ks', audio: 'pcm_s16le',
		audioEncoder: 'pcm_s16le', pixelFormat: 'yuv422p10le',
	});
	let range: Readonly<Record<string, unknown>> | null = null;
	const operation = operationFixture(async (_project, value, sink) => {
		range = value;
		const split = Math.floor(plan.timebase.sampleDuration / 2);
		await sink([
			new Float32Array(split).fill(0.25), new Float32Array(split).fill(-0.25),
		], { frameOffset: 0, sampleRate: plan.timebase.sampleRate, frames: split });
		await sink([
			new Float32Array(plan.timebase.sampleDuration - split).fill(0.25),
			new Float32Array(plan.timebase.sampleDuration - split).fill(-0.25),
		], { frameOffset: split, sampleRate: plan.timebase.sampleRate,
			frames: plan.timebase.sampleDuration - split });
		return { sampleRate: plan.timebase.sampleRate, channelCount: 2,
			frameCount: plan.timebase.sampleDuration, chunkCount: 2 };
	});
	const spool = spoolFixture();
	const carrier = await createFramescaperNativeAudioCarrierV28(plan, project, operation, {
		createSpool: spool.create,
	});
	assert.ok(carrier);
	assert.equal(carrier.role, 'staged-audio-mix');
	assert.equal(carrier.byteLength, 44 + plan.timebase.sampleDuration * 2 * 4);
	assert.deepEqual(range, {
		startFrame: 0, endFrame: plan.timebase.sampleDuration, includeTail: false,
		outputFrames: plan.timebase.sampleDuration, preRollFrames: 0,
		sampleRate: plan.timebase.sampleRate, chunkFrames: 4_096,
	});
	const bytes = new Uint8Array(await carrier.bytes.arrayBuffer());
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 4)), 'RIFF');
	assert.equal(carrier.sha256, createHash('sha256').update(bytes).digest('hex'));
	assert.equal(spool.maximumConcurrentWrites(), 1);
	assert.equal(spool.aborted(), false);
});

test('selected V28 audio carrier refuses changed streaming geometry and removes its partial spool', async () => {
	const project = createFramescaperProjectV28(PROFILE, framescaperV20Options());
	const plan = createFramescaperProjectUnifiedExactRenderPlanV28(
		PROFILE, project, createFramescaperNativeRenderPlanAuthorityV28(project),
	);
	const spool = spoolFixture();
	await assert.rejects(() => createFramescaperNativeAudioCarrierV28(
		plan, project, operationFixture(async (_project, _range, sink) => {
			await sink([new Float32Array(2), new Float32Array(2)], {
				frameOffset: 1, sampleRate: plan.timebase.sampleRate, frames: 2,
			});
			return { sampleRate: plan.timebase.sampleRate, channelCount: 2, frameCount: 2, chunkCount: 1 };
		}), { createSpool: spool.create },
	), /non-dense PCM chunk/iu);
	assert.equal(spool.aborted(), true);
});

function operationFixture(
	renderAudioToSink: NonNullable<ProductNativeRenderInputOperation['renderAudioToSink']>,
): ProductNativeRenderInputOperation {
	return Object.freeze({
		project: Object.freeze({}), signal: new AbortController().signal,
		assertCurrent() {}, async renderAudio() { throw new Error('whole render reached'); },
		renderAudioToSink, finish() {},
	});
}

function spoolFixture() {
	const chunks: Uint8Array<ArrayBuffer>[] = [];
	let active = 0;
	let maximum = 0;
	let didAbort = false;
	const create = async (_maximum: number, expected: number) => ({
		get byteLength() { return chunks.reduce((total, chunk) => total + chunk.byteLength, 0); },
		async write(bytes: Uint8Array) {
			active += 1; maximum = Math.max(maximum, active);
			await Promise.resolve(); chunks.push(Uint8Array.from(bytes)); active -= 1;
		},
		async complete(type: string) {
			const blob = new Blob(chunks, { type });
			assert.equal(blob.size, expected);
			return Object.freeze({ bytes: blob, byteLength: blob.size,
				sha256: createHash('sha256').update(new Uint8Array(await blob.arrayBuffer())).digest('hex'),
				chunkCount: chunks.length });
		},
		async abort() { didAbort = true; chunks.length = 0; },
	});
	return Object.freeze({ create, maximumConcurrentWrites: () => maximum, aborted: () => didAbort });
}
