/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperOpenFxLiveFrameTransformFactory,
	isFramescaperOpenFxLiveFrameTransformAudit,
	isFramescaperOpenFxLiveFrameTransformFactory,
} from '../desktop/framescaper-openfx-live-frame-transform.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { framescaperOpenFxPluginProjectionV1 } from '../src/common/editor/native-ofx-service-contract.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { streamFramescaperNativeRgbaFramePackV1 } from '../src/framescaper/native-render-frame-pack-v1.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

const SHA_A = 'a1'.repeat(32);
const SHA_B = 'b2'.repeat(32);
const SHA_C = 'c3'.repeat(32);
const SHA_D = 'd4'.repeat(32);
const HANDLE = '12'.repeat(20);

test('one exact V14 identity filter transforms arbitrary frame-pack splits under sink backpressure', async () => {
	const fixture = await transformFixture();
	const output: Uint8Array[] = [];
	const calls: Array<Readonly<{ ordinal: number; pixels: number[] }>> = [];
	const factory = createFramescaperOpenFxLiveFrameTransformFactory({
		inventory: () => [plugin()],
		execute: async (request) => {
			assert.equal(request.pluginHandle, HANDLE);
			assert.equal(request.instanceId, 'ofx-instance');
			assert.equal(request.requestedBackend, 'cpu');
			assert.deepEqual(request.inputs.map(({ name, sourceRef }) => [name, sourceRef]), [
				['Source', 'video-source'],
			]);
			const rgba = Uint8Array.from(request.inputs[0]!.rgba, (value) => 255 - value);
			calls.push({ ordinal: request.outputOrdinal, pixels: [...request.inputs[0]!.rgba] });
			return renderResult(rgba);
		},
	});
	assert.equal(isFramescaperOpenFxLiveFrameTransformFactory(factory), true);
	const session = factory({
		plan: fixture.plan, signal: new AbortController().signal,
		sink: { write: async (bytes) => {
			await new Promise((resolve) => setImmediate(resolve));
			output.push(new Uint8Array(bytes));
		} },
	});
	if (!session) throw new Error('The exact OpenFX plan did not create a transform session.');
	for (const [start, end] of splitRanges(fixture.input.byteLength, [1, 30, 2, 19, 7, 13])) {
		await session.write(fixture.input.subarray(start, end));
	}
	const audit = await session.complete(descriptor(fixture.input));
	assert.equal(isFramescaperOpenFxLiveFrameTransformAudit(audit), true);
	assert.equal(isFramescaperOpenFxLiveFrameTransformAudit(structuredClone(audit)), false);
	assert.deepEqual(audit.rendererInput, descriptor(fixture.input));
	const transformed = concat(output);
	assert.deepEqual(audit.transformedOutput, descriptor(transformed));
	assert.equal(audit.frameCount, 1);
	assert.equal(audit.reportsDegradation, false);
	assert.deepEqual(calls, [{ ordinal: 0, pixels: Array.from({ length: 16 }, (_, index) => index + 1) }]);
	assert.deepEqual([...transformed.subarray(transformed.length - 16)],
		Array.from({ length: 16 }, (_, index) => 254 - index));
});

test('plans without OpenFX relay directly, while unsupported contexts and non-identity graphs fail closed', async () => {
	const fixture = await transformFixture();
	const factory = createFramescaperOpenFxLiveFrameTransformFactory({
		inventory: () => [plugin()], execute: async () => { throw new Error('must not execute'); },
	});
	const without = structuredClone(fixture.plan) as Record<string, unknown>;
	without.nodes = fixture.plan.nodes.filter(({ kind }) => kind !== 'openfx');
	assert.equal(factory({
		plan: createUnifiedExactRenderPlan(without), signal: new AbortController().signal,
		sink: { write: () => undefined },
	}), null);
	const unsupported = structuredClone(fixture.plan) as Record<string, unknown>;
	const nodes = unsupported.nodes as Array<Record<string, unknown>>;
	const state = nodes.find(({ kind }) => kind === 'openfx')!.state as Record<string, unknown>;
	state.context = 'general'; state.attachment = { kind: 'general', targetId: 'video-source' };
	assert.throws(() => factory({
		plan: createUnifiedExactRenderPlan(unsupported), signal: new AbortController().signal,
		sink: { write: () => undefined },
	}), /supported|filter|identity/iu);
	const nonIdentity = structuredClone(fixture.plan) as Record<string, unknown>;
	const clip = (nonIdentity.nodes as Array<Record<string, unknown>>)
		.find(({ kind }) => kind === 'clip')!;
	((clip.pictureState as Record<string, unknown>).composition as Record<string, unknown>).opacity = 0.5;
	assert.throws(() => factory({
		plan: createUnifiedExactRenderPlan(nonIdentity), signal: new AbortController().signal,
		sink: { write: () => undefined },
	}), /identity|foundation|family/iu);
});

test('malformed streams, renderer trailer forgery, unavailable plug-ins, and caller races are refused', async () => {
	const fixture = await transformFixture();
	const make = (overrides: Readonly<Record<string, unknown>> = {}) => (
		createFramescaperOpenFxLiveFrameTransformFactory({
			inventory: () => [plugin(overrides)], execute: async (request) => renderResult(request.inputs[0]!.rgba),
		})
	);
	assert.throws(() => make({ state: 'revoked' })({
		plan: fixture.plan, signal: new AbortController().signal, sink: { write: () => undefined },
	}), /enabled|available/iu);
	const corrupt = new Uint8Array(fixture.input); corrupt[0] ^= 0xff;
	const malformed = make()({
		plan: fixture.plan, signal: new AbortController().signal, sink: { write: () => undefined },
	})!;
	await assert.rejects(malformed.write(corrupt), /header|magic/iu);

	const mismatch = make()({
		plan: fixture.plan, signal: new AbortController().signal, sink: { write: () => undefined },
	})!;
	await mismatch.write(fixture.input);
	await assert.rejects(mismatch.complete({
		byteLength: fixture.input.byteLength, sha256: SHA_D,
	}), /trailer|digest|disagree/iu);

	let release = (): void => undefined;
	const blocked = new Promise<void>((resolve) => { release = resolve; });
	const raced = make()({
		plan: fixture.plan, signal: new AbortController().signal,
		sink: { write: () => blocked },
	})!;
	const first = raced.write(fixture.input);
	await new Promise((resolve) => setImmediate(resolve));
	await assert.rejects(raced.write(new Uint8Array([1])), /concurrent|progress|active/iu);
	release();
	await assert.rejects(first, /concurrent|failed|active/iu);
});

async function transformFixture() {
	const options = framescaperV20Options();
	options.sources = (options.sources as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((source) => ({
			...source, width: 2, height: 2, sourceFrameCount: 1, frameRate: { num: 1, den: 1 },
			timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 1, den: 1 } },
		}));
	options.clips = (options.clips as Array<Record<string, unknown>>).filter(({ kind }) => kind === 'video')
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 }));
	options.projectBin = { clips: ((options.projectBin as { clips: Array<Record<string, unknown>> }).clips)
		.map((clip) => ({ ...clip, sequenceFrameCount: 1, sourceFrameCount: 1 })) };
	options.tracks = (options.tracks as Array<Record<string, unknown>>).filter(({ type }) => type === 'video');
	options.sequences = [{ id: 'main-sequence', rate: { num: 1, den: 1 }, trackIds: ['video-track'] }];
	options.ofxEffects = [effect()];
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const original = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project,
		createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const raw = structuredClone(original) as unknown as Record<string, unknown>;
	const output = raw.output as Record<string, unknown>;
	output.canvas = { ...(output.canvas as Record<string, unknown>), width: 2, height: 2 };
	const finishing = (raw.nodes as Array<Record<string, unknown>>)
		.find(({ kind }) => kind === 'finishing')!;
	Object.assign((finishing.sourceInterpretations as Array<Record<string, unknown>>)[0]!, {
		primaries: 'bt709', transfer: 'bt709', matrix: 'rgb', range: 'full',
		provenance: 'user-override',
	});
	const plan = createUnifiedExactRenderPlan(raw);
	if (plan.version !== 14) throw new Error('Fixture plan is not V14.');
	const chunks: Uint8Array[] = [];
	await streamFramescaperNativeRgbaFramePackV1({
		width: 2, height: 2, frameCount: 1, frameRate: { num: 1, den: 1 },
		signal: new AbortController().signal, assertCurrent: () => undefined,
		renderFrame: (_ordinal, pixels) => pixels.set(Array.from({ length: 16 }, (_, index) => index + 1)),
	}, { write: (bytes) => { chunks.push(new Uint8Array(bytes)); } });
	return { plan, input: concat(chunks) };
}

function effect() {
	return {
		schemaVersion: 1, instanceId: 'ofx-instance', pluginId: 'net.example.Filter',
		binarySha256: SHA_A, context: 'filter',
		attachment: { kind: 'filter', targetId: 'video-clip' },
		inputs: [{ name: 'Source', sourceRef: 'video-source' }],
		parameters: [], customEncodings: {}, enabled: true,
		freshness: {
			authoredStateSha256: SHA_A, inputIdentitiesSha256: SHA_B,
			renderPlanFingerprintSha256: SHA_C, nativeEffectFingerprintSha256: SHA_D,
		},
		frozenFallback: null,
	};
}

function plugin(overrides: Readonly<Record<string, unknown>> = {}) {
	return framescaperOpenFxPluginProjectionV1({
		pluginHandle: HANDLE, pluginId: 'net.example.Filter', vendor: 'Example',
		version: { major: 1, minor: 0 }, binarySha256: SHA_A,
		supportedContexts: ['filter'], parameters: [], components: ['RGBA'],
		pixelDepths: ['byte'], threading: 'instance-safe', state: 'enabled', quarantined: false,
		...overrides,
	});
}

function renderResult(rgbaValue: Uint8Array) {
	const rgba = new Uint8Array(rgbaValue);
	return Object.freeze({
		mode: 'render' as const, availability: 'available' as const,
		authoredStatePreserved: true as const, reportsDegradation: false,
		backend: 'cpu' as const, retriedOnCpu: false,
		output: Object.freeze({ streamId: '34'.repeat(20), ...descriptor(rgba) }), rgba,
	});
}

function descriptor(bytes: Uint8Array) {
	return Object.freeze({
		byteLength: bytes.byteLength,
		sha256: createHash('sha256').update(bytes).digest('hex'),
	});
}

function splitRanges(length: number, pattern: readonly number[]): Array<readonly [number, number]> {
	const output: Array<readonly [number, number]> = [];
	let offset = 0; let index = 0;
	while (offset < length) {
		const end = Math.min(length, offset + pattern[index % pattern.length]!);
		output.push([offset, end]); offset = end; index += 1;
	}
	return output;
}

function concat(chunks: readonly Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, bytes) => total + bytes.byteLength, 0);
	const output = new Uint8Array(length); let offset = 0;
	for (const bytes of chunks) { output.set(bytes, offset); offset += bytes.byteLength; }
	return output;
}
