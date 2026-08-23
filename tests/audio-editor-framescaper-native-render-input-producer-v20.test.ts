/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	connectProductNativeRenderInputAuthority,
	createProductNativeRenderInputAuthorityBinding,
} from '../src/common/editor/controller/product-native-render-input-authority.ts';
import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../src/common/editor/native-media-plan-canonical-form.ts';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { createVideoExportPlan } from '../src/common/editor/video-export.js';
import {
	bindVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../src/common/editor/video-source-timing-view.ts';
import type { VideoKeyframeExportFrame } from '../src/common/editor/video-keyframe-export-frame-source.ts';
import {
	createFramescaperNativeRenderInputProducerV20,
} from '../src/framescaper/editor-native-render-input-producer-v20.ts';
import {
	createFramescaperNativeRgbaFramePackV1,
} from '../src/framescaper/native-render-frame-pack-v1.ts';
import {
	reconcileFramescaperProjectFeatureRequirementsV20,
} from '../src/framescaper/editor-project-feature-requirements-v20.ts';
import { FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v20.ts';
import { createFramescaperProjectV20 } from '../src/framescaper/editor-project-v20.ts';
import { framescaperProjectForRuntimeConsumersV20 } from '../src/framescaper/editor-project-v20-runtime.ts';
import {
	createFramescaperVideoKeyframeExportPlanV20,
} from '../src/framescaper/video-export-plan-v20.ts';
import {
	framescaperV20Options,
	opacityKeyframes,
} from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V20_PROJECT_RUNTIME_PROFILE;

test('exact V1 carrier emits bounded canonical ordinal/timestamp/duration records', async () => {
	const current: number[] = [];
	const result = await createFramescaperNativeRgbaFramePackV1({
		width: 2,
		height: 2,
		frameCount: 2,
		frameRate: { num: 30_000, den: 1_001 },
		maximumChunkBytes: 64,
		signal: new AbortController().signal,
		assertCurrent: () => { current.push(current.length); },
		async renderFrame(ordinal, output) { output.fill(ordinal === 0 ? 0x11 : 0x22); },
	});
	assert.equal(result.byteLength, 59 + 2 * (32 + 16));
	assert.ok(result.chunkCount > 1, 'the fixture crosses its deliberately small chunk bound');
	assert.equal(result.sha256, await digestMediaContent(result.bytes));

	const bytes = new Uint8Array(await result.bytes.arrayBuffer());
	const view = new DataView(bytes.buffer);
	assert.equal(new TextDecoder().decode(bytes.subarray(0, 31)), 'framescaper-rgba-frame-pack-v1\n');
	assert.equal(view.getUint32(31, true), 1);
	assert.equal(view.getUint32(35, true), 2);
	assert.equal(view.getUint32(39, true), 2);
	assert.equal(view.getBigUint64(43, true), 2n);
	assert.equal(view.getUint32(51, true), 1_001);
	assert.equal(view.getUint32(55, true), 30_000);
	for (let ordinal = 0; ordinal < 2; ordinal += 1) {
		const offset = 59 + ordinal * 48;
		assert.equal(view.getBigUint64(offset, true), BigInt(ordinal));
		assert.equal(view.getBigInt64(offset + 8, true), BigInt(ordinal));
		assert.equal(view.getBigInt64(offset + 16, true), 1n);
		assert.equal(view.getBigUint64(offset + 24, true), 16n);
		assert.deepEqual([...bytes.subarray(offset + 32, offset + 48)], new Array(16).fill(
			ordinal === 0 ? 0x11 : 0x22,
		));
	}
	assert.ok(current.length >= 5, 'currentness is checked around frame production and publication');
});

test('exact V1 carrier cancels between pictures and refuses unstageable byte domains up front', async () => {
	const abort = new AbortController();
	let renders = 0;
	await assert.rejects(createFramescaperNativeRgbaFramePackV1({
		width: 2, height: 2, frameCount: 3, frameRate: { num: 1, den: 1 },
		signal: abort.signal, assertCurrent() {},
		async renderFrame(_ordinal, output) {
			renders += 1;
			output.fill(0x55);
			abort.abort(new Error('cancelled carrier'));
		},
	}), /cancelled carrier/u);
	assert.equal(renders, 1);
	await assert.rejects(createFramescaperNativeRgbaFramePackV1({
		width: 2_048, height: 1_024, frameCount: 2_048, frameRate: { num: 1, den: 1 },
		signal: new AbortController().signal, assertCurrent() {},
		async renderFrame() { throw new Error('must not render'); },
	}), /stage|16 GiB|byte domain/iu);
});

test('selected V20 producer authenticates one snapshot and stages active RGBA plus exact float WAV', async () => {
	const fixture = await producerFixture();
	const outputs = await fixture.producer(fixture.request);
	assert.deepEqual(outputs.map(({ role }) => role), [
		'evaluated-rgba-frame-pack', 'staged-audio-mix',
	]);
	assert.deepEqual(fixture.loads, ['video-source']);
	assert.deepEqual(fixture.requiredTimingSources, [['video-source']]);
	assert.deepEqual(fixture.events, [
		'authority:begin', 'timing:acquire', 'resolver:create', 'renderer:create',
		...Array.from({ length: fixture.plan.outputFrameCount }, (_, ordinal) => `frame:${String(ordinal)}`),
		'renderer:dispose', 'resolver:dispose', 'audio:render', 'timing:release', 'authority:finish',
	]);
	for (const output of outputs) {
		assert.equal(output.byteLength, output.bytes.size);
		assert.equal(output.sha256, await digestMediaContent(output.bytes));
	}

	const carrier = new DataView(await outputs[0]!.bytes.arrayBuffer());
	assert.equal(carrier.getUint32(35, true), fixture.plan.canvas.width);
	assert.equal(carrier.getUint32(39, true), fixture.plan.canvas.height);
	assert.equal(carrier.getBigUint64(43, true), BigInt(fixture.plan.outputFrameCount));
	const wav = new DataView(await outputs[1]!.bytes.arrayBuffer());
	assert.equal(ascii(wav, 0, 4), 'RIFF');
	assert.equal(ascii(wav, 8, 12), 'WAVE');
	assert.equal(wav.getUint16(20, true), 3, 'IEEE float');
	assert.equal(wav.getUint16(22, true), 2);
	assert.equal(wav.getUint32(24, true), fixture.sampleRate);
	assert.equal(wav.getUint32(40, true) / 8, fixture.plan.range.durationFrames);
});

test('selected V20 producer keeps V7 cleanup and makes V8 carrierless with optional audio only', async () => {
	const fixture = await producerFixture({ failCurrentAfterFrame: 0 });
	await assert.rejects(fixture.producer(fixture.request), /project changed during production/u);
	assert.deepEqual(fixture.events.slice(-4), [
		'renderer:dispose', 'resolver:dispose', 'timing:release', 'authority:finish',
	]);
	assert.equal(fixture.audioRenders(), 0);

	const v8Fixture = await producerFixture({ staticPlan: true });
	const outputs = await v8Fixture.producer(v8Fixture.request);
	assert.equal(v8Fixture.plan.version, 8);
	assert.deepEqual(outputs.map(({ role }) => role), ['staged-audio-mix']);
	assert.deepEqual(v8Fixture.requiredTimingSources, []);
	assert.deepEqual(v8Fixture.loads, []);
	assert.deepEqual(v8Fixture.events, [
		'authority:begin', 'audio:render', 'authority:finish',
	]);
	assert.equal(v8Fixture.audioRenders(), 1);

});

interface FixturePlan {
	readonly version: 7 | 8;
	readonly outputFrameCount: number;
	readonly range: Readonly<{ startFrame: number; endFrame: number; durationFrames: number }>;
	readonly canvas: Readonly<{ width: number; height: number }>;
	readonly sampleRate?: number;
	readonly inputs: readonly Readonly<{ kind: string; sampleRate?: number }>[];
}

async function producerFixture(options: Readonly<{
	readonly failCurrentAfterFrame?: number;
	readonly staticPlan?: boolean;
}> = {}) {
	const sourceBlob = new Blob([Uint8Array.of(1, 2, 3, 4)], { type: 'video/mp4' });
	const sourceDigest = await digestMediaContent(sourceBlob);
	const projectOptions = framescaperV20Options();
	const source = (projectOptions.sources as Array<Record<string, unknown>>)[0]!;
	source.contentSha256 = sourceDigest;
	source.width = 2;
	source.height = 2;
	const project = createFramescaperProjectV20(PROFILE, projectOptions);
	if (!options.staticPlan) {
		(project.clips[0] as unknown as Record<string, unknown>).videoKeyframes = opacityKeyframes();
		(project as unknown as Record<string, unknown>).featureRequirements =
			reconcileFramescaperProjectFeatureRequirementsV20(PROFILE, project);
	}
	const plan = (options.staticPlan
		? createVideoExportPlan(framescaperProjectForRuntimeConsumersV20(PROFILE, project), {
			format: 'mp4', range: 'project', includeAudio: true,
		})
		: createFramescaperVideoKeyframeExportPlanV20(PROFILE, project, {
			format: 'mp4', range: 'project', includeAudio: true,
		})) as unknown as FixturePlan;
	const sampleRate = plan.sampleRate
		?? plan.inputs.find(({ kind }) => kind === 'staged-audio-mix')?.sampleRate;
	if (typeof sampleRate !== 'number') throw new Error('Fixture plan has no audio sample rate.');
	const planPayload = canonicalizeNativeMediaPlan(plan);
	const events: string[] = [];
	const loads: string[] = [];
	const requiredTimingSources: string[][] = [];
	let audioRenderCount = 0;
	let producedFrames = 0;
	const timingView: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: { num: 10, den: 1 }, frameCount: 10,
	});
	const timingBySourceId = new Map([[
		'video-source', bindVideoSourceTimingView(new Map([['video-source', timingView]]), project.sources[0]!),
	]]);
	const authority = createProductNativeRenderInputAuthorityBinding();
	connectProductNativeRenderInputAuthority(authority, () => {
		events.push('authority:begin');
		return Object.freeze({
			project: structuredClone(project),
			signal: new AbortController().signal,
			assertCurrent() {
				if (options.failCurrentAfterFrame !== undefined
					&& producedFrames > options.failCurrentAfterFrame) {
					throw new Error('project changed during production');
				}
			},
			async renderAudio(renderProject: Readonly<Record<string, unknown>>, range: Readonly<Record<string, unknown>>) {
				events.push('audio:render');
				audioRenderCount += 1;
				assert.equal(renderProject.id, project.id);
				assert.equal(range.outputFrames, plan.range.durationFrames);
				return Object.freeze({
					sampleRate,
					channels: [new Float32Array(plan.range.durationFrames), new Float32Array(plan.range.durationFrames)],
				});
			},
			finish() { events.push('authority:finish'); },
		});
	});
	const producer = createFramescaperNativeRenderInputProducerV20(PROFILE, {
		authority,
		store: {
			async loadMediaAsset(storageKey: string) {
				loads.push(storageKey);
				return storageKey === 'video-source' ? sourceBlob : null;
			},
		},
	}, {
		async acquireTiming(_project, _store, _lookups, timingOptions) {
			events.push('timing:acquire');
			requiredTimingSources.push([...(timingOptions.requiredSourceIds ?? [])]);
			return Object.freeze({
				timingBySourceId,
				timingViewsBySourceId: timingBySourceId,
				release() { events.push('timing:release'); return true; },
			});
		},
		createCanvas: () => ({ getContext() { return {}; }, width: 0, height: 0 }) as never,
		createResolver(resolverOptions) {
			events.push('resolver:create');
			assert.deepEqual(resolverOptions.sources.map(({ sourceId }) => sourceId), ['video-source']);
			return Object.freeze({
				resolveSource: async () => { throw new Error('fake renderer does not resolve media'); },
				dispose() { events.push('resolver:dispose'); },
			});
		},
		createRenderer(_rendererOptions) {
			events.push('renderer:create');
			return Object.freeze({
				width: plan.canvas.width,
				height: plan.canvas.height,
				byteLength: plan.canvas.width * plan.canvas.height * 4,
				async produce(frame: VideoKeyframeExportFrame, output: Uint8Array) {
					events.push(`frame:${String(frame.index)}`);
					output.fill(frame.index + 1);
					producedFrames += 1;
				},
				async dispose() { events.push('renderer:dispose'); },
			});
		},
	});
	return {
		producer,
		request: Object.freeze({
			planPayload,
			planFingerprint: fingerprintNativeMediaPlan(plan).sha256,
			projectId: project.id,
			projectRevision: project.revision,
		}),
		plan,
		sampleRate,
		events,
		loads,
		requiredTimingSources,
		audioRenders: () => audioRenderCount,
	};
}

function ascii(view: DataView, start: number, end: number): string {
	return new TextDecoder().decode(new Uint8Array(view.buffer, start, end - start));
}
