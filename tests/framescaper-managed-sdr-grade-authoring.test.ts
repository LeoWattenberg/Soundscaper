/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createFramescaperFinishingMenuItems } from '../src/common/editor/ui/framescaper-finishing-menu.ts';
import { createFramescaperFinishingCommand, createFramescaperFinishingDialogModel } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { parseCubeLutV1, normalizeVideoColorGradeV1 } from '../src/common/editor/video-color-management-v27.ts';
import type { UnifiedExactRenderVisualFrameEntryV13 } from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import type { UnifiedExactRenderFinishingNode } from '../src/common/editor/unified-exact-render-plan.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import { applyFramescaperProjectCommandFinishing } from '../src/framescaper/editor-project-finishing-commands.ts';
import { createFramescaperProjectUnifiedExactRenderPlanFinishing as createPlan } from '../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { bindFramescaperUnifiedRenderTimingSidecarsFinishing as bindSidecars } from '../src/framescaper/editor-project-unified-render-timing-finishing.ts';
import { createFramescaperSelectedExactFrameExecutionFinishing } from '../src/framescaper/selected-finishing-exact-frame-execution.ts';
import { placeFramescaperManagedGradedVisualFrameV1, placeFramescaperManagedGradedAdjustmentFrameV1 } from '../src/framescaper/selected-finishing-managed-grade-frame.ts';
import { gradeVisual, gradeLinearFrame, identityDescription } from '../src/framescaper/selected-finishing-exact-frame-support.ts';
import { placeUnifiedExactLinearRgbaFrameV13 } from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';
import { renderAuthority, visualFreshness } from './helpers/framescaper-unified-render-project-fixture.ts';

const WIDTH = 4;
const HEIGHT = 2;
const LIVE = new AbortController().signal;
function grade(overrides: Record<string, unknown> = {}) {
	return normalizeVideoColorGradeV1({ schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null, ...overrides });
}
function presentation(overrides: Record<string, unknown> = {}) {
	return { schemaVersion: 1, id: 'grade-presentation', owner: { kind: 'generator', id: 'generator-source' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: grade({ exposureStops: 1 }),
		processorStackId: null, maskMatteIds: [], ...overrides };
}
function project() {
	const options = framescaperV20Options();
	(options.clips as Record<string, unknown>[]).push({ schemaVersion: 1, kind: 'generator', id: 'generator-clip',
		sourceId: 'generator-source', sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 10,
		sourceInFrame: 0, sourceFrameCount: 10 });
	((options.tracks as Record<string, unknown>[])[0]!.clipIds as string[]).push('generator-clip');
	return createFramescaperProjectFinishing(PROFILE, { ...options,
		videoTransitionsByTrackId: { 'video-track': [] },
		visualModel: { stillSources: [], adjustmentLayers: [], presets: [], maskMattes: [], freezeFallbacks: [],
			generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'generator-source', name: 'Grade plate',
				width: WIDTH, height: HEIGHT, frameRate: { num: 10, den: 1 }, frameCount: 100,
				generator: { kind: 'solid', color: '#808080ff' } }] },
		finishing: { colorContexts: [{ schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' }] },
	});
}
function entryAndFinishing(value = project()) {
	const authority = renderAuthority(value, 10);
	const plan = createPlan(PROFILE, value, { ...authority,
		canvas: { ...authority.canvas, width: WIDTH, height: HEIGHT },
		visualFreshnessByModelId: visualFreshness(value as unknown as Parameters<typeof visualFreshness>[0]) });
	const visual = plan.nodes.find(node => node.kind === 'visual' && node.modelId === 'generator-clip');
	const finishing = plan.nodes.find((node): node is UnifiedExactRenderFinishingNode => node.kind === 'finishing');
	assert.ok(visual?.kind === 'visual');
	assert.ok(finishing);
	const entry: UnifiedExactRenderVisualFrameEntryV13 = { nodeId: visual.nodeId, modelId: visual.modelId,
		modelKind: visual.modelKind, trackId: 'video-track', authoredState: visual.authoredState,
		opacity: 1, blendMode: 'normal', masks: [] };
	return { authority, plan, entry, finishing };
}
function frame(width = WIDTH, height = HEIGHT) {
	const pixels = new Uint8Array(width * height * 4);
	for (let index = 0; index < pixels.length; index += 4) pixels.set([64, 128, 192, 128], index);
	return { width, height, pixels };
}

test('the existing Frame grading menu authors a durable command that the selected exact renderer consumes', async () => {
	const initial = project();
	const opened: string[] = [];
	const items = createFramescaperFinishingMenuItems({ productId: 'framescaper', project: initial,
		capabilities: { videoGrading: true }, editingBlocked: false, readOnly: false }, { open: surface => { opened.push(surface); } });
	const leaf = items.effect[0]?.items?.find(item => item.id === 'framescaper-grading-presets');
	assert.ok(leaf && !leaf.disabled);
	await leaf.onClick?.();
	assert.deepEqual(opened, ['grading-presets']);
	const model = createFramescaperFinishingDialogModel({ surface: 'grading-presets', project: initial });
	assert.equal(model.documentEditable, true);
	const document = JSON.parse(model.documentText) as Record<string, unknown>;
	const command = createFramescaperFinishingCommand('grading-presets', initial,
		JSON.stringify({ ...document, videoVisualPresentations: [presentation()] }));
	const authored = applyFramescaperProjectCommandFinishing(PROFILE, initial, command);
	assert.equal(initial.videoVisualPresentations.length, 0);
	assert.equal(authored.videoVisualPresentations[0]?.grade?.exposureStops, 1);
	const { authority, plan } = entryAndFinishing(authored);
	const execution = await createFramescaperSelectedExactFrameExecutionFinishing({ project: authored, plan,
		timingSidecars: bindSidecars(authored, authority.timingViews), signal: LIVE,
		captureFrame: () => { throw new Error('no original media requested'); },
		applyEffects: value => Promise.resolve(value), assertCurrent: () => undefined });
	const target = new Uint8Array(WIDTH * HEIGHT * 4);
	const fill = Uint8Array.prototype.fill;
	const released: Uint8Array[] = [];
	Uint8Array.prototype.fill = function(value, start, end) {
		if (value === 0 && this.length === WIDTH * HEIGHT * 4 && this[0] === 110 && this[3] === 255) released.push(this);
		return fill.call(this, value, start, end);
	};
	try {
		await execution.render({ sequencePosition: { num: 0, den: 1 }, layers: [], width: WIDTH, height: HEIGHT, target, signal: LIVE });
		assert.deepEqual(Array.from(target.subarray(0, 4)), [175, 175, 175, 255],
			'128 encoded input becomes110 linear bytes, then175 encoded bytes in the established Frame pipeline');
		assert.equal(new Set(released.map(value => value.buffer)).size, 2,
			'the actual selected renderer releases both its transformed chunk and callback-scoped grade output');
		assert.equal(released.every(value => value.every(byte => byte === 0)), true);
	} finally { Uint8Array.prototype.fill = fill; await execution.dispose(); }
});

test('numeric Frame grading and linear adjustments are byte-for-byte equal to the established exact math', async () => {
	const { entry, finishing } = entryAndFinishing();
	const active = { ...finishing, visualPresentations: [presentation({ grade: grade({
		exposureStops: 0.25, contrast: 1.1, lift: [0.01, -0.02, 0.03], gamma: [0.9, 1.1, 1], gain: [1.2, 0.8, 1], saturation: 0.7 }) })] };
	const source = frame();
	const original = Array.from(source.pixels);
	const old = gradeVisual(active as UnifiedExactRenderFinishingNode, entry, source, new Map(), LIVE);
	const expected = placeUnifiedExactLinearRgbaFrameV13({ frame: old, displayWidth: WIDTH, displayHeight: HEIGHT,
		outputWidth: WIDTH, outputHeight: HEIGHT, renderDescription: identityDescription(WIDTH, HEIGHT, 'normal') });
	const actual = await placeFramescaperManagedGradedVisualFrameV1({ finishing: active as UnifiedExactRenderFinishingNode,
		entry, frame: source, luts: new Map(), canvas: { width: WIDTH, height: HEIGHT }, signal: LIVE });
	assert.deepEqual(actual.pixels, expected.pixels);
	assert.deepEqual(Array.from(source.pixels), original);
	const grades = [grade({ gain: [0.5, 0.75, 1], saturation: 0.3 })];
	const oldAdjustment = gradeLinearFrame(source, grades, new Map(), LIVE);
	const expectedAdjustment = placeUnifiedExactLinearRgbaFrameV13({ frame: oldAdjustment, displayWidth: WIDTH, displayHeight: HEIGHT,
		outputWidth: WIDTH, outputHeight: HEIGHT, renderDescription: identityDescription(WIDTH, HEIGHT, 'normal'), opacity: 0.4 });
	const actualAdjustment = await placeFramescaperManagedGradedAdjustmentFrameV1({ frame: source, grades, luts: new Map(),
		width: WIDTH, height: HEIGHT, blendMode: 'normal', opacity: 0.4, signal: LIVE });
	assert.deepEqual(actualAdjustment.pixels, expectedAdjustment.pixels);
});

test('disabled and differently owned Frame presentations leave independent default linear goldens', async () => {
	const { entry, finishing } = entryAndFinishing();
	const active = { ...finishing, visualPresentations: [presentation({ enabled: false }),
		presentation({ id: 'another-source-grade', owner: { kind: 'generator', id: 'other-generator' } })] };
	const actual = await placeFramescaperManagedGradedVisualFrameV1({ finishing: active as UnifiedExactRenderFinishingNode,
		entry, frame: frame(), luts: new Map(), canvas: { width: WIDTH, height: HEIGHT }, signal: LIVE });
	const alpha = 128 / 255;
	assert.deepEqual(Array.from(actual.pixels.subarray(0, 4)), [13 / 255 * alpha, 55 / 255 * alpha, 134 / 255 * alpha, alpha]);
});

test('existing trusted LUT grades keep their original Frame path and exact results', async () => {
	const text = 'LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n';
	const parsed = parseCubeLutV1(text);
	const { sha256, byteLength, size, domainMin, domainMax } = parsed;
	const grades = [grade({ lut: { storageKey: `lut-sha256:${sha256}`, sha256, byteLength, size, domainMin, domainMax } })];
	const luts = new Map([[sha256, parsed]]);
	const source = frame();
	const expectedFrame = gradeLinearFrame(source, grades, luts, LIVE);
	const expected = placeUnifiedExactLinearRgbaFrameV13({ frame: expectedFrame, displayWidth: WIDTH, displayHeight: HEIGHT,
		outputWidth: WIDTH, outputHeight: HEIGHT, renderDescription: identityDescription(WIDTH, HEIGHT, 'normal'), opacity: 1 });
	const actual = await placeFramescaperManagedGradedAdjustmentFrameV1({ frame: source, grades, luts,
		width: WIDTH, height: HEIGHT, blendMode: 'normal', opacity: 1, signal: LIVE });
	assert.deepEqual(actual.pixels, expected.pixels);
});

test('nonintrinsic native Frame buffers explicitly preserve the previous grading path', async () => {
	class NativeFramePixels extends Uint8Array {}
	const ordinary = frame();
	const source = { ...ordinary, pixels: new NativeFramePixels(ordinary.pixels) };
	const grades = [grade({ exposureStops: 0.5 })];
	const expectedFrame = gradeLinearFrame(source, grades, new Map(), LIVE);
	const expected = placeUnifiedExactLinearRgbaFrameV13({ frame: expectedFrame, displayWidth: WIDTH, displayHeight: HEIGHT,
		outputWidth: WIDTH, outputHeight: HEIGHT, renderDescription: identityDescription(WIDTH, HEIGHT, 'normal'), opacity: 1 });
	const actual = await placeFramescaperManagedGradedAdjustmentFrameV1({ frame: source, grades, luts: new Map(),
		width: WIDTH, height: HEIGHT, blendMode: 'normal', opacity: 1, signal: LIVE });
	assert.deepEqual(actual.pixels, expected.pixels);
	assert.deepEqual(source.pixels, new NativeFramePixels(ordinary.pixels));
});

test('the shared Frame bridge yields numeric work and refuses task cancellation without changing input', async () => {
	const source = frame(512, 512);
	const controller = new AbortController();
	const reason = new DOMException('Frame grade superseded', 'AbortError');
	setTimeout(() => { controller.abort(reason); }, 0);
	await assert.rejects(placeFramescaperManagedGradedAdjustmentFrameV1({ frame: source,
		grades: [grade({ exposureStops: 1 })], luts: new Map(), width: 512, height: 512,
		blendMode: 'normal', opacity: 1, signal: controller.signal }), error => error === reason);
	assert.equal(source.pixels[0], 64);
	assert.equal(source.pixels.at(-1), 128);
});

test('cancellation after placement but before grade acknowledgement wipes the unpublished Float64 output', async () => {
	const controller = new AbortController();
	const reason = new DOMException('placement superseded', 'AbortError');
	const native = globalThis.Float64Array;
	const outputs: Float64Array[] = [];
	globalThis.Float64Array = new Proxy(native, { construct(target, argumentsList) {
		const output = Reflect.construct(target, argumentsList) as Float64Array;
		outputs.push(output);
		return output;
	} });
	try {
		void Promise.resolve().then(() => { controller.abort(reason); });
		await assert.rejects(placeFramescaperManagedGradedAdjustmentFrameV1({
			frame: { width: 1, height: 1, pixels: new Uint8Array([64, 128, 192, 255]) },
			grades: [], luts: new Map(), width: 1, height: 1, blendMode: 'normal', opacity: 1, signal: controller.signal,
		}), error => error === reason);
	} finally { globalThis.Float64Array = native; }
	assert.equal(outputs.length, 1, 'placement completed before cancellation was delivered');
	assert.equal(outputs[0]?.every(value => value === 0), true);
});
