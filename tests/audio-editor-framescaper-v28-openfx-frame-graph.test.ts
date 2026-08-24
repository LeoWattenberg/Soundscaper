/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { OfxContext } from '../src/common/editor/native-ofx-descriptor.ts';
import {
	createFramescaperOpenFxFrameGraphV28,
	type FramescaperOpenFxFrameExecutionRequestV28,
	type FramescaperOpenFxFrameV28,
} from '../src/framescaper/editor-openfx-frame-graph-v28.ts';

const SHA = 'a1'.repeat(32);
const CONTEXTS = ['generator', 'filter', 'transition', 'paint', 'retimer', 'general'] as const;

test('the V28 OpenFX frame graph maps all six contexts at their exact intermediate planes', async () => {
	const observed: FramescaperOpenFxFrameExecutionRequestV28[] = [];
	const graph = createFramescaperOpenFxFrameGraphV28({
		plan: plan(CONTEXTS),
		assertCurrent() {},
		async execute(request) {
			observed.push(request);
			return {
				mode: 'render', rgba: frame(request.inputs.length + 20), backend: 'cpu',
				retriedOnCpu: false, reportsDegradation: false,
			};
		},
	});
	for (const context of CONTEXTS) {
		const request = checkpoint(context);
		const result = await graph.apply(request);
		assert.equal(result.dispositions.length, 1, context);
		assert.equal(result.dispositions[0]?.context, context);
		assert.equal(result.frame.pixels[0],
			(observed.at(-1)?.inputs as readonly unknown[]).length + 20, context);
	}
	assert.deepEqual(observed.map(({ context, inputs, standardParameters }) => ({
		context,
		inputs: (inputs as readonly Readonly<Record<string, unknown>>[]).map(({ name, sourceRef, rgba }) => ({
			name, sourceRef, pixel: (rgba as FramescaperOpenFxFrameV28).pixels[0],
		})),
		standardParameters,
	})), [
		{ context: 'generator', inputs: [{ name: 'Background', sourceRef: 'background-source', pixel: 1 }], standardParameters: {} },
		{ context: 'filter', inputs: [{ name: 'Source', sourceRef: 'clip-source', pixel: 2 }], standardParameters: {} },
		{ context: 'transition', inputs: [
			{ name: 'SourceFrom', sourceRef: 'outgoing-clip', pixel: 3 },
			{ name: 'SourceTo', sourceRef: 'incoming-clip', pixel: 4 },
		], standardParameters: { Transition: 0.25 } },
		{ context: 'paint', inputs: [
			{ name: 'Source', sourceRef: 'paint-source', pixel: 5 },
			{ name: 'Mask', sourceRef: 'mask-matte', pixel: 6 },
		], standardParameters: {} },
		{ context: 'retimer', inputs: [{ name: 'Source', sourceRef: 'retime-source', pixel: 7 }], standardParameters: {
			SourceTime: { num: 7, den: 3 },
		} },
		{ context: 'general', inputs: [
			{ name: 'InputA', sourceRef: 'general-a', pixel: 8 },
			{ name: 'InputB', sourceRef: 'general-b', pixel: 9 },
		], standardParameters: {} },
	]);
});

test('the frame graph never aliases a final carrier over distinct named inputs', async () => {
	let seen: readonly FramescaperOpenFxFrameV28[] = [];
	const graph = createFramescaperOpenFxFrameGraphV28({
		plan: plan(['general']), assertCurrent() {},
		async execute(request) {
			seen = request.inputs.map(({ rgba }) => rgba);
			return { mode: 'render', rgba: frame(31), backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
		},
	});
	const sourceA = frame(11);
	const sourceB = frame(12);
	await graph.apply({
		context: 'general', targetId: 'general-target', outputOrdinal: 0,
		primary: null, namedPlanes: [
			{ identity: 'general-a', rgba: sourceA },
			{ identity: 'general-b', rgba: sourceB },
		], signal: new AbortController().signal,
	});
	assert.deepEqual(seen.map(({ pixels }) => pixels[0]), [11, 12]);
	assert.notStrictEqual(seen[0]?.pixels, sourceA.pixels);
	assert.notStrictEqual(seen[1]?.pixels, sourceB.pixels);
});

test('bypass, frozen recovery, and GPU degradation are deterministic and never mutate authored state', async () => {
	const source = frame(40);
	const authored = plan(['filter']);
	const before = structuredClone(authored);
	let mode: 'bypass' | 'frozen' | 'render' = 'bypass';
	const graph = createFramescaperOpenFxFrameGraphV28({
		plan: authored, assertCurrent() {},
		allowRepeatedFrames: true,
		async execute() {
			if (mode === 'bypass') return { mode, availability: 'missing', reportsDegradation: true };
			if (mode === 'frozen') return {
				mode, availability: 'quarantined', reportsDegradation: true,
				frozenFallback: effect('filter').state.frozenFallback,
			};
			return { mode, rgba: frame(42), backend: 'cpu', retriedOnCpu: true, reportsDegradation: true };
		},
		async resolveFrozenFrame() { return frame(41); },
	});
	const request = checkpoint('filter', source);
	let result = await graph.apply(request);
	assert.equal(result.frame.pixels[0], 40);
	assert.equal(result.dispositions[0]?.mode, 'bypass');
	mode = 'frozen'; result = await graph.apply(request);
	assert.equal(result.frame.pixels[0], 41);
	assert.equal(result.dispositions[0]?.mode, 'frozen');
	mode = 'render'; result = await graph.apply(request);
	assert.equal(result.frame.pixels[0], 42);
	assert.deepEqual(result.dispositions[0], {
		instanceId: 'effect-filter', context: 'filter', outputOrdinal: 0, mode: 'render',
		reportsDegradation: true, backend: 'cpu', retriedOnCpu: true,
	});
	assert.deepEqual(authored, before);
});

test('the frame graph refuses stale, replayed, malformed, and context-forged plane requests', async () => {
	let current = true;
	const graph = createFramescaperOpenFxFrameGraphV28({
		plan: plan(['transition']), assertCurrent() { if (!current) throw new Error('stale project'); },
		async execute() { return { mode: 'render', rgba: frame(1), backend: 'cpu', retriedOnCpu: false, reportsDegradation: false }; },
	});
	const valid = checkpoint('transition');
	current = false;
	await assert.rejects(() => graph.apply(valid), /stale/iu);
	current = true;
	const first = await graph.apply(valid);
	assert.equal(first.frame.pixels[0], 1);
	await assert.rejects(() => graph.apply(valid), /replay|ordinal/iu);
	await assert.rejects(() => graph.apply({ ...valid, outputOrdinal: 1, transitionProgress: undefined }), /Transition/iu);
	await assert.rejects(() => graph.apply({
		...valid, outputOrdinal: 2,
		namedPlanes: [{ identity: 'outgoing-clip', rgba: frame(3) }],
	}), /named input|SourceTo/iu);
	await assert.rejects(() => graph.apply({
		...valid, outputOrdinal: 3,
		namedPlanes: valid.namedPlanes.map((plane, index) => index === 0
			? { ...plane, rgba: { ...plane.rgba, pixels: new Uint8Array(3) } } : plane),
	}), /RGBA|geometry/iu);
});

function checkpoint(context: OfxContext, primaryValue?: FramescaperOpenFxFrameV28) {
	const byContext = {
		generator: { targetId: 'generator-target', primary: null, namedPlanes: [plane('background-source', 1)] },
		filter: { targetId: 'filter-target', primary: { identity: 'clip-source', rgba: primaryValue ?? frame(2) }, namedPlanes: [] },
		transition: { targetId: 'transition-target', primary: null, namedPlanes: [plane('outgoing-clip', 3), plane('incoming-clip', 4)], transitionProgress: 0.25 },
		paint: { targetId: 'paint-target', primary: null, namedPlanes: [plane('paint-source', 5), plane('mask-matte', 6)] },
		retimer: { targetId: 'retimer-target', primary: null, namedPlanes: [plane('retime-source', 7)], retimerSourceTime: { num: 7, den: 3 } },
		general: { targetId: 'general-target', primary: null, namedPlanes: [plane('general-a', 8), plane('general-b', 9)] },
	} as const;
	return {
		context, ...byContext[context], outputOrdinal: 0,
		signal: new AbortController().signal,
	};
}

function plane(identity: string, value: number) { return { identity, rgba: frame(value) }; }
function frame(value: number): FramescaperOpenFxFrameV28 {
	return Object.freeze({ width: 2, height: 1, pixels: new Uint8Array([value, 0, 0, 255, value, 0, 0, 255]) });
}

function plan(contexts: readonly OfxContext[]) {
	return {
		version: 14, output: { frameCount: 10, canvas: { width: 2, height: 1 } },
		nodes: contexts.map(effect),
	} as never;
}

function effect(context: OfxContext) {
	const inputs = {
		generator: [{ name: 'Background', sourceRef: 'background-source' }],
		filter: [{ name: 'Source', sourceRef: 'clip-source' }],
		transition: [{ name: 'SourceFrom', sourceRef: 'outgoing-clip' }, { name: 'SourceTo', sourceRef: 'incoming-clip' }],
		paint: [{ name: 'Source', sourceRef: 'paint-source' }, { name: 'Mask', sourceRef: 'mask-matte' }],
		retimer: [{ name: 'Source', sourceRef: 'retime-source' }],
		general: [{ name: 'InputA', sourceRef: 'general-a' }, { name: 'InputB', sourceRef: 'general-b' }],
	}[context];
	return {
		kind: 'openfx', nodeId: `node-${context}`,
		state: {
			schemaVersion: 1, instanceId: `effect-${context}`, pluginId: 'net.example.AllContexts',
			binarySha256: SHA, context, attachment: { kind: context, targetId: `${context}-target` },
			inputs, parameters: [], customEncodings: {}, enabled: true,
			freshness: { authoredStateSha256: SHA, inputIdentitiesSha256: SHA, renderPlanFingerprintSha256: SHA, nativeEffectFingerprintSha256: SHA },
			frozenFallback: { externalMediaSourceId: 'frozen-source', renderedAssetSha256: SHA, frameCount: 10,
				freshness: { authoredStateSha256: SHA, inputIdentitiesSha256: SHA, renderPlanFingerprintSha256: SHA, nativeEffectFingerprintSha256: SHA } },
		},
	};
}
