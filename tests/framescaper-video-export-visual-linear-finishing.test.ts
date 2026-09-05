/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createUnifiedExactLinearPremultipliedFrameV13,
	encodeUnifiedExactLinearFrameV13,
	type UnifiedExactLinearCompositionEntryV13,
	type UnifiedExactLinearPremultipliedFrameV13,
} from '../src/common/editor/unified-exact-linear-rgba-v13.ts';
import type { UnifiedExactRenderFinishingNode } from '../src/common/editor/unified-exact-render-plan.ts';
import type {
	UnifiedExactRenderActiveAdjustmentV13,
	UnifiedExactRenderVisualFrameEntryV13,
} from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import type {
	UnifiedExactRenderVisualRgbaV13,
} from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import {
	normalizeVideoSourceColorInterpretationV1,
	type VideoSourceColorInterpretationV1,
} from '../src/common/editor/video-color-management-v27.ts';
import {
	normalizeVideoMaskMatteGraphV1,
	type VideoMaskMatteGraphV1,
} from '../src/common/editor/video-mask-matte-v24.ts';
import {
	normalizeVideoVisualPresentationV1,
	type VideoVisualPresentationV1,
} from '../src/common/editor/video-visual-presentation-v27.ts';
import {
	applyAdjustment,
	applyVideoPresentationLinear,
	backgroundLinear,
	combinedGraphs,
	decodeEncodedPicture,
	identityDescription,
	managedVisualFrame,
	sourceState,
} from '../src/framescaper/video-export-visual-linear-finishing.ts';

type Fields = Readonly<Record<string, unknown>>;

/** The sRGB and BT.709 toe slopes; eight-bit 10 stays on both linear segments. */
const SRGB_TEN = 10 / 255 / 12.92;
const REC709_TEN = 10 / 255 / 4.5;
const TOLERANCE = 1e-9;
const OPEN = new AbortController().signal;

function assertPixels(actual: Float64Array, expected: readonly number[], name: string): void {
	assert.equal(actual.length, expected.length, `${name} pixel count`);
	for (let index = 0; index < expected.length; index += 1) {
		assert.ok(
			Math.abs(actual[index]! - expected[index]!) <= TOLERANCE,
			`${name}[${String(index)}] was ${String(actual[index])}, expected ${String(expected[index])}`,
		);
	}
}

function repeat(pixel: readonly number[], count: number): number[] {
	return Array.from({ length: count }, () => pixel).flat();
}

function linearFrame(
	width: number,
	height: number,
	background: readonly [number, number, number, number],
): UnifiedExactLinearPremultipliedFrameV13 {
	return createUnifiedExactLinearPremultipliedFrameV13(width, height, background);
}

function grade(overrides: Fields = {}): Fields {
	return {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null,
		...overrides,
	};
}

function presentation(overrides: Fields = {}): VideoVisualPresentationV1 {
	return normalizeVideoVisualPresentationV1({
		schemaVersion: 1, id: 'presentation', owner: { kind: 'clip', id: 'clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [],
		...overrides,
	});
}

function stillInterpretation(sourceId: string): VideoSourceColorInterpretationV1 {
	return normalizeVideoSourceColorInterpretationV1({
		schemaVersion: 1, sourceId, sourceKind: 'still', primaries: 'srgb',
		transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'user-override',
	});
}

function finishingNode(
	visualPresentations: readonly VideoVisualPresentationV1[],
	sourceInterpretations: readonly VideoSourceColorInterpretationV1[] = [],
): UnifiedExactRenderFinishingNode {
	return { visualPresentations, sourceInterpretations } as unknown as UnifiedExactRenderFinishingNode;
}

/** A one-node rectangle covering `x` through `x + width` of the full frame height. */
function rectangleMask(id: string, x: number, width: number): Fields {
	return {
		schemaVersion: 1, id, kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y: 0, width, height: 1 }],
		outputNodeId: 'shape',
	};
}

function maskGraph(id: string, x: number, width: number): VideoMaskMatteGraphV1 {
	return normalizeVideoMaskMatteGraphV1(rectangleMask(id, x, width));
}

function rgbaFrame(
	width: number,
	height: number,
	values: readonly number[],
): UnifiedExactRenderVisualRgbaV13 {
	return Object.freeze({ width, height, pixels: Uint8Array.from(values) });
}

function visualEntry(modelId: string, authoredState: Fields): UnifiedExactRenderVisualFrameEntryV13 {
	return {
		nodeId: 'visual-node', modelId, modelKind: 'still', trackId: 'track',
		authoredState: authoredState as never, opacity: 1, blendMode: 'normal', masks: [],
	};
}

function activeAdjustment(
	overrides: Partial<UnifiedExactRenderActiveAdjustmentV13> = {},
): UnifiedExactRenderActiveAdjustmentV13 {
	return {
		nodeId: 'adjust-node', modelId: 'adjust-layer', targetTrackIds: [],
		effectIds: [], opacity: 1, blendMode: 'normal', masks: [], ...overrides,
	};
}

function compositionEntry(
	frame: UnifiedExactLinearPremultipliedFrameV13,
	blendMode: UnifiedExactLinearCompositionEntryV13['blendMode'],
): UnifiedExactLinearCompositionEntryV13 {
	return Object.freeze({ frame, blendMode });
}

test('a picture route holding other than one clip leaves the working frame untouched', () => {
	const node = finishingNode([presentation({ opacity: 0.5 })]);
	for (const clipIds of [[], ['clip', 'other-clip']]) {
		const working = linearFrame(1, 1, [0.6, 0.6, 0.6, 1]);

		applyVideoPresentationLinear(
			clipIds, working, 1, 1, node, new Map(), new Map(), new Map(),
			null, 'srgb', new Set(),
		);

		assertPixels(working.pixels, [0.6, 0.6, 0.6, 1], `clip count ${String(clipIds.length)}`);
	}
});

test('a clip whose finishing source is unresolved refuses the presentation reapplication', () => {
	assert.throws(() => applyVideoPresentationLinear(
		['clip'], linearFrame(1, 1, [0, 0, 0, 1]), 1, 1,
		finishingNode([presentation({ opacity: 0.5 })]),
		new Map(), new Map(), new Map(), { backgroundColor: '#000000ff' }, 'srgb', new Set(),
	), (error: unknown) => error instanceof ReferenceError
		&& /finishing presentation source for clip clip is unavailable/u.test(error.message));
});

test('an identity presentation returns before the canvas background is ever read', () => {
	const working = linearFrame(1, 1, [0.6, 0.6, 0.6, 1]);

	// The disabled half-opacity presentation must be filtered out; were it kept the
	// null canvas below would be decoded and refused instead of short-circuiting.
	applyVideoPresentationLinear(
		['clip'], working, 1, 1,
		finishingNode([
			presentation({ id: 'enabled-identity' }),
			presentation({ id: 'disabled-fade', enabled: false, opacity: 0.5 }),
			presentation({ id: 'other-owner', owner: { kind: 'clip', id: 'elsewhere' }, opacity: 0.25 }),
		]),
		new Map([['clip', 'source']]), new Map(), new Map(), null, 'srgb', new Set(),
	);

	assertPixels(working.pixels, [0.6, 0.6, 0.6, 1], 'identity presentation');
});

test('clip-owned and source-owned presentations multiply their opacities onto the frame', () => {
	const working = linearFrame(1, 1, [0.6, 0.6, 0.6, 1]);

	applyVideoPresentationLinear(
		['clip'], working, 1, 1,
		finishingNode([
			presentation({ id: 'clip-fade', opacity: 0.5 }),
			presentation({ id: 'source-fade', owner: { kind: 'source', id: 'source' }, opacity: 0.5 }),
			presentation({ id: 'adjustment-fade', owner: { kind: 'adjustment-layer', id: 'source' }, opacity: 0.5 }),
		]),
		new Map([['clip', 'source']]), new Map(), new Map(),
		{ backgroundColor: '#00000000' }, 'srgb', new Set(),
	);

	// 0.5 * 0.5 over a fully transparent backdrop; the adjustment owner never applies.
	assertPixels(working.pixels, [0.15, 0.15, 0.15, 0.25], 'stacked opacity');
});

test('presentation masks scale the content and record every evaluated mask node', () => {
	const working = linearFrame(2, 1, [0.6, 0.6, 0.6, 1]);
	const executed = new Set<string>();

	applyVideoPresentationLinear(
		['clip'], working, 2, 1,
		finishingNode([presentation({ maskMatteIds: ['mask-wide', 'mask-left'] })]),
		new Map([['clip', 'source']]),
		new Map([
			['mask-left', { nodeId: 'mask-left-node', graph: rectangleMask('mask-left', 0, 0.5) }],
			['mask-wide', { nodeId: 'mask-wide-node', graph: rectangleMask('mask-wide', 0, 1) }],
		]),
		new Map(), { backgroundColor: '#00000000' }, 'srgb', executed,
	);

	assertPixels(working.pixels, [0.6, 0.6, 0.6, 1, 0, 0, 0, 0], 'masked content');
	assert.deepEqual([...executed].sort(), ['mask-left-node', 'mask-wide-node']);
});

test('the last matching presentation states the blend authority over the canvas background', () => {
	const working = linearFrame(1, 1, [0.2, 0.2, 0.2, 1]);

	applyVideoPresentationLinear(
		['clip'], working, 1, 1,
		finishingNode([
			presentation({ id: 'screen-first', blendMode: 'screen' }),
			presentation({ id: 'multiply-last', blendMode: 'multiply' }),
		]),
		new Map([['clip', 'source']]), new Map(), new Map(),
		{ backgroundColor: '#0a0a0aff' }, 'srgb', new Set(),
	);

	// multiply against the decoded background, not screen's 0.2 + 0.8 * background.
	assertPixels(working.pixels, [SRGB_TEN * 0.2, SRGB_TEN * 0.2, SRGB_TEN * 0.2, 1], 'multiplied');
});

test('a still visual decodes through its declared source interpretation', () => {
	const result = managedVisualFrame(
		finishingNode([], [stillInterpretation('still-source')]),
		visualEntry('clip', { source: { kind: 'still', id: 'still-source' } }),
		rgbaFrame(2, 1, [255, 10, 0, 255, 0, 0, 0, 0]),
		new Map(), OPEN,
	);

	assert.equal(result.width, 2);
	assert.equal(result.height, 1);
	assert.deepEqual([...result.pixels], [255, 1, 0, 255, 0, 0, 0, 0]);
});

test('a still visual without a declared source interpretation is refused', () => {
	assert.throws(() => managedVisualFrame(
		finishingNode([], [stillInterpretation('other-source')]),
		visualEntry('clip', { source: { kind: 'still', id: 'still-source' } }),
		rgbaFrame(1, 1, [255, 255, 255, 255]), new Map(), OPEN,
	), (error: unknown) => error instanceof ReferenceError
		&& /finishing visual source interpretation still-source is unavailable/u.test(error.message));
});

test('a generator visual decodes through the default still interpretation and its grade', () => {
	const node = finishingNode([presentation({
		owner: { kind: 'generator', id: 'gen-source' }, grade: grade({ gain: [0.5, 0.5, 0.5] }),
	})]);

	const result = managedVisualFrame(
		node, visualEntry('clip', { source: { kind: 'generator', id: 'gen-source' } }),
		rgbaFrame(1, 1, [255, 10, 0, 255]), new Map(), OPEN,
	);

	// sRGB-decoded 255 is 1.0; halved by gain it lands on 128, and 10 falls below one code.
	assert.deepEqual([...result.pixels], [128, 0, 0, 255]);
});

test('stacked presentation grades apply in their authored order to the linear pixels', () => {
	const node = finishingNode([
		presentation({ id: 'clip-half', grade: grade({ gain: [0.5, 0.5, 0.5] }) }),
		presentation({
			id: 'source-half', owner: { kind: 'source', id: 'still-source' },
			grade: grade({ gain: [0.5, 0.5, 0.5] }),
		}),
	], [stillInterpretation('still-source')]);

	const result = managedVisualFrame(
		node, visualEntry('clip', { source: { kind: 'still', id: 'still-source' } }),
		rgbaFrame(1, 1, [255, 255, 255, 255]), new Map(), OPEN,
	);

	assert.deepEqual([...result.pixels], [64, 64, 64, 255]);
});

test('an aborted signal stops the managed visual frame with the stated reason', () => {
	const controller = new AbortController();
	const reason = new Error('the finishing export was cancelled by the test.');
	controller.abort(reason);

	assert.throws(() => managedVisualFrame(
		finishingNode([], [stillInterpretation('still-source')]),
		visualEntry('clip', { source: { kind: 'still', id: 'still-source' } }),
		rgbaFrame(1, 1, [255, 255, 255, 255]), new Map(), controller.signal,
	), (error: unknown) => error === reason);
});

test('an adjustment layer carrying legacy effect IDs refuses browser execution', () => {
	assert.throws(() => applyAdjustment(
		finishingNode([]), activeAdjustment({ effectIds: ['legacy-effect'] }),
		new Map(), linearFrame(1, 1, [0, 0, 0, 1]), new Set(), 1, 1,
		new Map(), new Map(), OPEN,
	), (error: unknown) => error instanceof Error
		&& /unexecutable legacy effect IDs/u.test(error.message));
});

test('an adjustment flattens every targeted track entry and preserves its blend authority', () => {
	const trackEntries = new Map<string, UnifiedExactLinearCompositionEntryV13[]>([['track-a', [
		compositionEntry(linearFrame(2, 1, [0.2, 0.2, 0.2, 1]), 'multiply'),
		compositionEntry(linearFrame(2, 1, [0.6, 0.6, 0.6, 0.5]), 'multiply'),
	]]]);

	applyAdjustment(
		finishingNode([]), activeAdjustment({ targetTrackIds: ['track-a'] }),
		trackEntries, linearFrame(2, 1, [0, 0, 0, 0]), new Set(), 2, 1,
		new Map(), new Map(), OPEN,
	);

	const flattened = trackEntries.get('track-a')!;
	assert.equal(flattened.length, 1);
	assert.equal(flattened[0]!.blendMode, 'multiply');
	// 0.2 then a half-alpha 0.6 multiplied over it flattens to 0.16, quantized to 41/255.
	assertPixels(flattened[0]!.frame.pixels, repeat([41 / 255, 41 / 255, 41 / 255, 1], 2), 'flattened');
});

test('a targeted track whose entries disagree on blend mode refuses to flatten', () => {
	const trackEntries = new Map<string, UnifiedExactLinearCompositionEntryV13[]>([['track-a', [
		compositionEntry(linearFrame(1, 1, [0.2, 0.2, 0.2, 1]), 'normal'),
		compositionEntry(linearFrame(1, 1, [0.6, 0.6, 0.6, 1]), 'multiply'),
	]]]);

	assert.throws(() => applyAdjustment(
		finishingNode([]), activeAdjustment({ targetTrackIds: ['track-a'] }),
		trackEntries, linearFrame(1, 1, [0, 0, 0, 0]), new Set(), 1, 1,
		new Map(), new Map(), OPEN,
	), (error: unknown) => error instanceof Error
		&& /one track blend authority/u.test(error.message));
	assert.equal(trackEntries.get('track-a')!.length, 2);
});

test('an adjustment over absent entries and untargeted picture tracks changes nothing', () => {
	const trackEntries = new Map<string, UnifiedExactLinearCompositionEntryV13[]>([['empty-track', []]]);
	const working = linearFrame(1, 1, [0.6, 0.6, 0.6, 1]);

	applyAdjustment(
		finishingNode([]),
		activeAdjustment({ targetTrackIds: ['missing-track', 'empty-track'] }),
		trackEntries, working, new Set(['picture-track']), 1, 1,
		new Map(), new Map(), OPEN,
	);

	assert.deepEqual([...trackEntries.keys()], ['empty-track']);
	assert.deepEqual(trackEntries.get('empty-track'), []);
	assertPixels(working.pixels, [0.6, 0.6, 0.6, 1], 'untargeted backdrop');
});

test('an adjustment targeting only part of the baked picture refuses execution', () => {
	assert.throws(() => applyAdjustment(
		finishingNode([]), activeAdjustment({ targetTrackIds: ['picture-a'] }),
		new Map(), linearFrame(1, 1, [0.6, 0.6, 0.6, 1]),
		new Set(['picture-a', 'picture-b']), 1, 1, new Map(), new Map(), OPEN,
	), (error: unknown) => error instanceof Error
		&& /unavailable per-layer browser execution/u.test(error.message));
});

test('an adjustment covering every picture track grades the backdrop through its mask', () => {
	const working = linearFrame(2, 1, [0.2, 0.2, 0.2, 1]);

	applyAdjustment(
		finishingNode([presentation({
			owner: { kind: 'adjustment-layer', id: 'adjust-layer' },
			grade: grade({ gain: [2, 2, 2] }),
		})]),
		activeAdjustment({
			targetTrackIds: ['picture-a'], masks: [maskGraph('adjust-mask', 0, 0.5)],
		}),
		new Map(), working, new Set(['picture-a']), 2, 1, new Map(), new Map(), OPEN,
	);

	assertPixels(working.pixels, [0.4, 0.4, 0.4, 1, 0.2, 0.2, 0.2, 1], 'masked adjustment');
});

test('the canvas background decodes through the stated output transfer', () => {
	assert.deepEqual(backgroundLinear({ backgroundColor: '#ffffff' }, 'srgb'), [1, 1, 1, 1]);
	assertPixels(
		Float64Array.from(backgroundLinear({ backgroundColor: '#0a0a0a80' }, 'srgb')),
		[SRGB_TEN, SRGB_TEN, SRGB_TEN, 128 / 255], 'sRGB background',
	);
	assertPixels(
		Float64Array.from(backgroundLinear({ backgroundColor: '#0a0a0aff' }, 'rec709')),
		[REC709_TEN, REC709_TEN, REC709_TEN, 1], 'Rec.709 background',
	);
});

test('a background colour the finishing renderer cannot resolve is refused', () => {
	for (const backgroundColor of ['black', '#zzzzzz', '#fff', 0x00ff00]) {
		assert.throws(() => backgroundLinear({ backgroundColor }, 'srgb'), (error: unknown) => (
			error instanceof TypeError && /finishing visual background is invalid/u.test(error.message)
		), `background ${String(backgroundColor)}`);
	}
});

test('a finishing canvas that is not a plain object is refused', () => {
	for (const canvas of [null, undefined, '#ffffff', ['#ffffff']]) {
		assert.throws(() => backgroundLinear(canvas, 'srgb'), (error: unknown) => (
			error instanceof TypeError && /finishing visual canvas must be an object/u.test(error.message)
		), `canvas ${String(canvas)}`);
	}
});

test('encoded picture output whose geometry changed is refused', () => {
	assert.throws(
		() => decodeEncodedPicture(new Uint8Array(4), 2, 1, 'srgb'),
		(error: unknown) => error instanceof RangeError
			&& /finishing visual output geometry changed/u.test(error.message),
	);
});

test('encoded picture output decodes back into premultiplied linear working pixels', () => {
	const working = decodeEncodedPicture(
		Uint8Array.from([255, 51, 0, 128]), 1, 1, 'linear-rec709-d65',
	);

	assert.equal(working.width, 1);
	assert.equal(working.height, 1);
	assertPixels(working.pixels, [128 / 255, 0.2 * 128 / 255, 0, 128 / 255], 'decoded picture');
});

test('encoding and decoding one working frame round-trips its linear pixels', () => {
	const frame = linearFrame(2, 1, [SRGB_TEN, SRGB_TEN, SRGB_TEN, 1]);

	const encoded = encodeUnifiedExactLinearFrameV13(frame, 'srgb');
	assert.deepEqual([...encoded], [10, 10, 10, 255, 10, 10, 10, 255]);

	assertPixels(
		decodeEncodedPicture(encoded, 2, 1, 'srgb').pixels,
		repeat([SRGB_TEN, SRGB_TEN, SRGB_TEN, 1], 2), 'round trip',
	);
});

test('an empty mask graph collection leaves full coverage', () => {
	assert.deepEqual([...combinedGraphs([], 2, 2, new Map())], [255, 255, 255, 255]);
});

test('mask graphs multiply into a single coverage plane', () => {
	assert.deepEqual(
		[...combinedGraphs([rectangleMask('left', 0, 0.5), rectangleMask('all', 0, 1)], 2, 1, new Map())],
		[255, 0],
	);
	assert.deepEqual(
		[...combinedGraphs([rectangleMask('left', 0, 0.5), rectangleMask('right', 0.5, 0.5)], 2, 1, new Map())],
		[0, 0],
	);
});

test('a raster mask graph reads its bound input and refuses an unbound source', () => {
	const graph: Fields = {
		schemaVersion: 1, id: 'raster-graph', kind: 'matte',
		inputs: [{ name: 'Plate', sourceRef: 'plate-source', kind: 'raster' }],
		nodes: [{ id: 'plate', kind: 'raster', inputName: 'Plate', channel: 'red' }],
		outputNodeId: 'plate',
	};
	const inputs = new Map([['plate-source', rgbaFrame(2, 1, [255, 0, 0, 255, 0, 0, 0, 255])]]);

	assert.deepEqual([...combinedGraphs([graph], 2, 1, inputs)], [255, 0]);
	assert.throws(() => combinedGraphs([graph], 2, 1, new Map()), (error: unknown) => (
		error instanceof ReferenceError && /Mask\/matte source plate-source is unavailable/u.test(error.message)
	));
});

test('the identity placement description states a full-aperture untransformed layer', () => {
	const description = identityDescription(1920, 1080, 'screen');

	assert.deepEqual(description, {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: 1920, height: 1080 },
		},
		sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0],
		opacityStart: 1, opacityEnd: 1, blendMode: 'screen', compositingOrder: 0,
	});
	assert.ok(Object.isFrozen(description));
	assert.ok(Object.isFrozen(description.crop));
	assert.ok(Object.isFrozen(description.sourceDisplayToCanvas));
});

test('a visual entry states its authored source record or is refused', () => {
	assert.deepEqual(
		sourceState(visualEntry('clip', { source: { kind: 'still', id: 'still-source' } })),
		{ kind: 'still', id: 'still-source' },
	);
	assert.throws(() => sourceState(visualEntry('clip', {})), (error: unknown) => (
		error instanceof TypeError && /finishing visual entry source is unavailable/u.test(error.message)
	));
	for (const source of [null, 'still-source', ['still-source']]) {
		assert.throws(() => sourceState(visualEntry('clip', { source })), (error: unknown) => (
			error instanceof TypeError && /finishing visual entry source must be an object/u.test(error.message)
		), `source ${String(source)}`);
	}
});
