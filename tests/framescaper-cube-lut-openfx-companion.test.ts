/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { liveFixture } from './helpers/framescaper-native-live-openfx-fixture.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createUnifiedExactRenderPlanV16 } from '../src/common/editor/unified-exact-render-plan-v16.ts';
import { createFramescaperProjectUnifiedExactRenderPlanV16 } from '../src/framescaper/editor-project-unified-render-plan-v16.ts';
import { framescaperProjectFinishingFoundationShapeNativeMedia } from '../src/framescaper/editor-project-native-media-foundation.ts';
import { cloneFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { createFramescaperOpenFxExecutionForResourceFoundationV16 } from '../src/framescaper/selected-native-media-openfx-resource-v16.ts';
import { createFramescaperOpenFxExecutionForFoundationNativeMedia } from '../src/framescaper/selected-native-media-openfx-execution.ts';
import { createFramescaperSelectedOpenFxExactPlanesNativeMedia } from '../src/framescaper/selected-native-media-openfx-exact-planes.ts';
import { createFramescaperSelectedExactFrameExecutionV16 } from '../src/framescaper/selected-finishing-exact-frame-execution-v16.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as FINISHING, FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as NATIVE } from '../src/framescaper/editor-domain-runtime-profile.ts';

const TEXT = 'LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1';
const PARSED = parseCubeLutV1(TEXT), BODY = new TextEncoder().encode(TEXT);
const REF = { storageKey: `lut-sha256:${PARSED.sha256}`, sha256: PARSED.sha256, byteLength: PARSED.byteLength,
	size: PARSED.size, domainMin: PARSED.domainMin, domainMax: PARSED.domainMax };
const CUBE = { id: 'cube', type: 'cube-lut-profile-v1', enabled: true, params: { lut: REF } };
const SOURCE = [255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255];
const AFTER_CUBE = [0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255];
const AFTER_FILTER = [0,255,0,255,255,0,0,255,0,0,255,255,255,255,255,255];

function fixture() {
	const original = liveFixture(true).project;
	const clips = original.clips as readonly Readonly<Record<string, unknown>>[];
	const project = cloneFramescaperProjectNativeMedia(NATIVE, { ...original,
		clips: clips.map(clip => clip.id === 'video-clip' ? { ...clip, videoEffects: [CUBE] } : clip) });
	const foundation = framescaperProjectFinishingFoundationShapeNativeMedia(project);
	const timingViews = new Map([['video-source', { kind: 'cfr' as const, rate: { num: 1, den: 1 }, frameCount: 1 }]]);
	const plan = createFramescaperProjectUnifiedExactRenderPlanV16(FINISHING, foundation, {
		sequenceId: 'main-sequence', sampleStart: 0, sampleDuration: 48_000, outputRate: { num: 1, den: 1 },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { width: 2, height: 2, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#00000000' },
		quality: 'balanced', includeAudio: false, audioLayout: null, timingViews, visualFreshnessByModelId: new Map(),
	});
	return { project, foundation, plan, timingViews };
}

test('the exact current cube stage feeds the existing OpenFX request/reply owner, preserving a strict native14 carrier', async () => {
	const value = fixture(), stop = new AbortController(); let calls = 0;
	const openFx = createFramescaperOpenFxExecutionForResourceFoundationV16({ profile: NATIVE, project: value.project,
		foundationPlan: value.plan, timingViews: value.timingViews, async execute(request) {
			calls++; assert.equal(request.plan.version, 14); assert.equal(request.instanceId, 'ofx-instance');
			for (const node of request.plan.nodes) if (node.kind === 'clip') assert.deepEqual(node.pictureState.videoEffects, []);
			assert.equal(request.inputs.length, 1); const input = request.inputs[0]!.rgba;
			assert.deepEqual(Array.from(input.pixels), AFTER_CUBE);
			const pixels = new Uint8Array(input.pixels.length);
			for (let index = 0; index < pixels.length; index += 4) pixels.set([input.pixels[index+1]!, input.pixels[index+2]!, input.pixels[index]!, input.pixels[index+3]!], index);
			return { mode: 'render', rgba: { width: 2, height: 2, pixels }, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
		} });
	const execution = await createFramescaperSelectedExactFrameExecutionV16({ project: value.foundation, plan: value.plan,
		timingSidecars: bindFramescaperUnifiedRenderTimingSidecarsFinishing(value.foundation, value.timingViews),
		openFx, signal: stop.signal, assertCurrent() {}, captureFrame() { return { width: 2, height: 2, pixels: new Uint8Array(SOURCE) }; },
		sourceFrames: { async resolve() { throw Error('The filter never requests a frozen frame.'); } } as never,
		store: { async loadMediaAsset() { return new Blob([BODY]); } } });
	try {
		const target = new Uint8Array(16);
		await execution.render({ sequencePosition: { num: 0, den: 1 }, timelineSample: 0, outputOrdinal: 0,
			width: 2, height: 2, target, signal: stop.signal, layers: [{ trackId: 'video-track', entries: [{
				clipId: 'video-clip', sourceId: 'video-source', presentationDescriptor: { drawableSourceFrame: 0, outerCell: 0 },
				displayWidth: 2, displayHeight: 2, effects: [CUBE], intervalProgress: 0,
				renderDescription: { crop: { normalized: { left: 0, top: 0, right: 0, bottom: 0 }, sourcePixels: { x: 0, y: 0, width: 2, height: 2 } },
					sourceDisplayToCanvas: [1,0,0,1,0,0], opacityStart: 1, opacityEnd: 1, blendMode: 'normal', compositingOrder: 0 },
			}] }] });
		assert.deepEqual(Array.from(target), AFTER_FILTER); assert.equal(calls, 1);
	} finally { await execution.dispose(); }
});

test('a native abort observed during complete project currentness prevents the next plugin demand', async () => {
	const value = fixture(), stop = new AbortController(); let calls = 0, checks = 0, traps = 0;
	const reason = new Proxy({}, { get() { traps++; throw Error('get'); }, getPrototypeOf() { traps++; throw Error('prototype'); },
		getOwnPropertyDescriptor() { traps++; throw Error('descriptor'); } });
	const openFx = createFramescaperOpenFxExecutionForResourceFoundationV16({ profile: NATIVE, project: value.project,
		foundationPlan: value.plan, timingViews: value.timingViews, async execute(request) {
			calls++; return { mode: 'render', rgba: request.inputs[0]!.rgba, backend: 'cpu', retriedOnCpu: false, reportsDegradation: false };
		} });
	const mutable = value.project as unknown as Record<string, unknown>;
	mutable.sources = new Proxy(value.project.sources as object, { getOwnPropertyDescriptor(target, key) {
		checks++; stop.abort(reason); return Reflect.getOwnPropertyDescriptor(target, key);
	} });
	const planes = createFramescaperSelectedOpenFxExactPlanesNativeMedia({ foundationPlan: value.plan, openFx, assertCurrent() {} });
	const work = planes.apply({ context: 'filter', targetId: 'video-clip', outputOrdinal: 0,
		primary: { identity: 'video-source', frame: { width: 2, height: 2, pixels: new Uint8Array(SOURCE) } }, named: [], signal: stop.signal });
	const { error } = await work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	assert.equal(error, reason); assert.ok(checks > 0); assert.equal(calls, 0); assert.equal(traps, 0);
});

test('complete resource identity/order and full native project freshness are required, with held plugin work joined', async () => {
	const value = fixture(), held = deferred<void>(), entered = deferred<void>();
	const execute = async (request: Parameters<ReturnType<typeof createFramescaperOpenFxExecutionForResourceFoundationV16>['execute']>[0]) => {
		entered.resolve(); await held.promise;
		return { mode: 'render' as const, rgba: request.inputs[0]!.rgba, backend: 'cpu' as const, retriedOnCpu: false, reportsDegradation: false };
	};
	const options = { profile: NATIVE, project: value.project, foundationPlan: value.plan, timingViews: value.timingViews, execute };
	const changedPlan = createUnifiedExactRenderPlanV16({ ...value.plan, nodes: value.plan.nodes.map(node => node.kind === 'clip'
		? { ...node, pictureState: { ...node.pictureState, videoEffects: [{ ...CUBE, params: { lut: null } }] } } : node) });
	assert.throws(() => createFramescaperOpenFxExecutionForResourceFoundationV16({ ...options, foundationPlan: changedPlan }), /diverg|author|snapshot/iu);
	assert.throws(() => createFramescaperOpenFxExecutionForFoundationNativeMedia({ ...options, foundationPlan: value.plan as never }), /unsupported|cube/iu);
	const openFx = createFramescaperOpenFxExecutionForResourceFoundationV16(options);
	assert.throws(() => createFramescaperSelectedOpenFxExactPlanesNativeMedia({ foundationPlan: changedPlan, openFx, assertCurrent() {} }), /pair|author|diverg/iu);
	const planes = createFramescaperSelectedOpenFxExactPlanesNativeMedia({ foundationPlan: value.plan, openFx, assertCurrent() {} });
	const work = planes.apply({ context: 'filter', targetId: 'video-clip', outputOrdinal: 0,
		primary: { identity: 'video-source', frame: { width: 2, height: 2, pixels: new Uint8Array(SOURCE) } }, named: [], signal: new AbortController().signal });
	const observed = work.then(() => ({ error: undefined as unknown }), (error: unknown) => ({ error }));
	await entered.promise; assert.equal(await remainsPending(work), true);
	const mutable = value.project as unknown as Record<string, unknown>; mutable.title = 'same-revision drift';
	held.resolve(); assert.match(String((await observed).error), /changed|stale/iu);
});
