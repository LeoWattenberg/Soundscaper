/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	parseCubeLutV1,
	type VideoColorGradeV1,
	type VideoSourceColorInterpretationV1,
} from '../src/common/editor/video-color-management-v27.ts';
import type {
	UnifiedExactRenderFinishingNode,
	UnifiedExactRenderPlanV13,
} from '../src/common/editor/unified-exact-render-plan.ts';
import type {
	UnifiedExactRenderVisualFrameEntryV13,
} from '../src/common/editor/unified-exact-render-visual-consumers-v13.ts';
import type {
	UnifiedExactRenderVisualRgbaV13,
} from '../src/common/editor/unified-exact-render-visual-materializer-v13.ts';
import {
	authoredCompositingOrder,
	backgroundLinear,
	captureBrowserFrame,
	combinedGraphs,
	combinedMask,
	gradeEncodedFrame,
	gradeLinearFrame,
	gradeVisual,
	identityDescription,
	mediaPresentation,
	orderBucketEntries,
	renderBlendMode,
	requiredInterpretation,
	type TrackOrderBucketFinishing,
} from '../src/framescaper/selected-finishing-exact-frame-support.ts';

type Data = Record<string, unknown>;

const WIDTH = 4;
const HEIGHT = 2;
const BYTES = WIDTH * HEIGHT * 4;
/** Every entry maps to pure green, so a sampled LUT is unmistakable in the output. */
const GREEN_LUT = `LUT_3D_SIZE 2\n${'0.0 1.0 0.0\n'.repeat(8)}`;

const live = new AbortController().signal;

function plate(fill: number, alpha = 255): UnifiedExactRenderVisualRgbaV13 {
	const pixels = new Uint8Array(BYTES);
	for (let offset = 0; offset < BYTES; offset += 4) {
		pixels[offset] = fill;
		pixels[offset + 1] = fill;
		pixels[offset + 2] = fill;
		pixels[offset + 3] = alpha;
	}
	return { width: WIDTH, height: HEIGHT, pixels };
}

function grade(overrides: Partial<VideoColorGradeV1> = {}): VideoColorGradeV1 {
	return {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1, lut: null,
		...overrides,
	};
}

function interpretation(overrides: Partial<VideoSourceColorInterpretationV1> = {}): VideoSourceColorInterpretationV1 {
	return {
		schemaVersion: 1, sourceId: 'still-source', sourceKind: 'still', primaries: 'srgb',
		transfer: 'srgb', matrix: 'rgb', range: 'full', provenance: 'user-override', ...overrides,
	};
}

function presentation(overrides: Data = {}): Data {
	return {
		schemaVersion: 1, id: 'presentation-1', owner: { kind: 'clip', id: 'still-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: null,
		processorStackId: null, maskMatteIds: [], ...overrides,
	};
}

function finishingNode(overrides: Data = {}): UnifiedExactRenderFinishingNode {
	return {
		kind: 'finishing', nodeId: 'render:finishing:main-sequence', sequenceId: 'main-sequence',
		colorContext: {
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'srgb', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		},
		sourceInterpretations: [], visualPresentations: [], processorStacks: [], motionAnalyses: [],
		captionTracks: [], captionDisposition: 'sidecar-only',
		audioContext: {
			audioTracks: [], masterEffectIds: [], masterChannels: 2, automationLanes: [], mixer: {},
		},
		...overrides,
	} as unknown as UnifiedExactRenderFinishingNode;
}

function visualEntry(source: Data, overrides: Data = {}): UnifiedExactRenderVisualFrameEntryV13 {
	return {
		nodeId: 'render:visual:still-clip', modelId: 'still-clip', modelKind: source.kind,
		trackId: 'video-track', authoredState: { source, clip: { id: 'still-clip' } },
		opacity: 1, blendMode: 'normal', masks: [], ...overrides,
	} as unknown as UnifiedExactRenderVisualFrameEntryV13;
}

function rectangleGraph(id: string, x: number, y: number, width: number, height: number): Data {
	return {
		schemaVersion: 1, id, kind: 'mask', inputs: [],
		nodes: [{ id: 'shape', kind: 'vector-shape', shape: 'rectangle', x, y, width, height }],
		outputNodeId: 'shape',
	};
}

/** Swap in a fake document and hand back the restoration the test must run. */
function installDocument(value: unknown): () => void {
	const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
	Object.defineProperty(globalThis, 'document', { configurable: true, value });
	return () => {
		if (descriptor) Object.defineProperty(globalThis, 'document', descriptor);
		else Reflect.deleteProperty(globalThis, 'document');
	};
}

interface CanvasCalls {
	readonly cleared: number[][];
	readonly drawn: unknown[];
	readonly sizes: Readonly<{ width: number; height: number }>[];
	contextOptions: unknown;
}

function canvasDocument(config: Readonly<{
	readonly context?: boolean;
	readonly fill?: number;
	readonly onDraw?: () => void;
}> = {}) {
	const calls: CanvasCalls = { cleared: [], drawn: [], sizes: [], contextOptions: null };
	const document = {
		createElement(name: string) {
			assert.equal(name, 'canvas', 'readback allocates a canvas and nothing else');
			const canvas = {
				width: 0,
				height: 0,
				getContext(kind: string, options: unknown) {
					assert.equal(kind, '2d');
					calls.contextOptions = options;
					if (config.context === false) return null;
					return {
						clearRect(...box: number[]) { calls.cleared.push(box); },
						drawImage(drawable: unknown) {
							calls.drawn.push(drawable);
							calls.sizes.push({ width: canvas.width, height: canvas.height });
							config.onDraw?.();
						},
						getImageData(_x: number, _y: number, width: number, height: number) {
							const data = new Uint8ClampedArray(width * height * 4);
							for (let offset = 0; offset < data.length; offset += 4) {
								data[offset] = config.fill ?? 3;
								data[offset + 3] = 255;
							}
							return { data };
						},
					};
				},
			};
			return canvas;
		},
	};
	return { document, calls };
}

test('an encoded frame decodes through its interpretation and a limited range lifts the same byte higher', () => {
	const frame = plate(128);

	const full = gradeEncodedFrame(frame, interpretation(), [], new Map(), live);
	const limited = gradeEncodedFrame(frame, interpretation({ range: 'limited' }), [], new Map(), live);

	assert.deepEqual([...full.pixels.slice(0, 4)], [55, 55, 55, 255],
		'a mid sRGB byte decodes to its linear counterpart, not to itself');
	assert.deepEqual([...limited.pixels.slice(0, 4)], [57, 57, 57, 255],
		'expanding a limited range before decoding must brighten the same byte');
	assert.equal(full.width, WIDTH);
	assert.equal(full.height, HEIGHT);
	assert.equal(full.pixels.length, BYTES, 'every pixel of the plate is written, not only the first row');
	assert.ok(Object.isFrozen(full), 'a graded frame is published frozen');
});

test('a frame admits its grade stack once, however many pixels it carries', () => {
	// Admitting the interpretation and normalizing every grade per pixel is what
	// made a single preview frame block the main thread for seconds; that work
	// belongs to the frame, so its cost must not scale with the pixel count.
	const stackReads = (width: number, height: number): number => {
		let reads = 0;
		const grades: VideoColorGradeV1[] = [];
		Object.defineProperty(grades, '0', {
			get() { reads += 1; return grade(); },
			enumerable: true,
			configurable: true,
		});
		grades.length = 1;
		const frame = { width, height, pixels: new Uint8Array(width * height * 4) };
		gradeEncodedFrame(frame, interpretation(), grades, new Map(), live);
		return reads;
	};

	assert.equal(stackReads(64, 64), stackReads(2, 2),
		'a 1024-times larger frame must not read its grade stack 1024 times more often');
});

test('a clip-owned enabled grade reaches its visual while a disabled or foreign presentation does not', () => {
	const black = grade({ gain: [0, 0, 0] });
	const finishing = finishingNode({
		sourceInterpretations: [interpretation()],
		visualPresentations: [
			presentation({ id: 'p-disabled', enabled: false, grade: black }),
			presentation({ id: 'p-other-clip', owner: { kind: 'clip', id: 'other-clip' }, grade: black }),
			presentation({ id: 'p-adjustment', owner: { kind: 'adjustment-layer', id: 'adjustment' }, grade: black }),
		],
	});
	const entry = visualEntry({ kind: 'still', id: 'still-source' });

	const ungraded = gradeVisual(finishing, entry, plate(128), new Map(), live);
	const applied = gradeVisual(finishingNode({
		sourceInterpretations: [interpretation()],
		visualPresentations: [presentation({ grade: black })],
	}), entry, plate(128), new Map(), live);

	assert.deepEqual([...ungraded.pixels.slice(0, 4)], [55, 55, 55, 255],
		'a disabled or foreign presentation must not grade the visual');
	assert.deepEqual([...applied.pixels.slice(0, 4)], [0, 0, 0, 255],
		'the clip-owned grade zeroes the plate through its gain');
});

test('a visual with no authored source and a still with no persisted interpretation are both refused', () => {
	const finishing = finishingNode({ sourceInterpretations: [interpretation()] });
	const sourceless = visualEntry({ kind: 'still', id: 'still-source' }, { authoredState: {} });

	assert.throws(
		() => gradeVisual(finishing, sourceless, plate(0), new Map(), live),
		(error: unknown) => error instanceof TypeError
			&& /visual source is unavailable/u.test(error.message),
	);
	assert.throws(
		() => gradeVisual(finishing, visualEntry({ kind: 'still', id: 'ghost-source' }), plate(0), new Map(), live),
		(error: unknown) => error instanceof ReferenceError
			&& /source interpretation ghost-source is unavailable/u.test(error.message),
	);
	assert.throws(() => requiredInterpretation(finishing, 'ghost-source'), ReferenceError);
	assert.equal(requiredInterpretation(finishing, 'still-source').sourceId, 'still-source');
});

test('a generator visual grades through the default still interpretation rather than a persisted one', () => {
	// No sourceInterpretations at all: a generator must not need one to render.
	const finishing = finishingNode({
		visualPresentations: [presentation({
			owner: { kind: 'generator', id: 'generator-source' }, grade: grade({ gain: [0, 0, 0] }),
		})],
	});
	const entry = visualEntry({ kind: 'generator', id: 'generator-source' });

	const graded = gradeVisual(finishing, entry, plate(128), new Map(), live);

	assert.deepEqual([...graded.pixels.slice(0, 4)], [0, 0, 0, 255],
		'a generator-owned presentation grades the generator it owns');
	assert.deepEqual(
		[...gradeVisual(finishingNode({}), entry, plate(128), new Map(), live).pixels.slice(0, 4)],
		[55, 55, 55, 255],
		'an ungraded generator decodes as sRGB full range',
	);
});

test('a graded LUT samples its verified transient body and refuses a stack whose body is missing', () => {
	const body = parseCubeLutV1(GREEN_LUT);
	const reference = {
		storageKey: `lut-sha256:${body.sha256}`, sha256: body.sha256, byteLength: body.byteLength,
		size: body.size, domainMin: body.domainMin, domainMax: body.domainMax,
	};
	const grades = [grade({ lut: reference })];
	const luts = new Map([[body.sha256, body]]);

	const sampled = gradeLinearFrame(plate(128), grades, luts, live);

	assert.deepEqual([...sampled.pixels.slice(0, 4)], [0, 255, 0, 255],
		'the constant LUT replaces the plate colour with its own output');
	assert.throws(() => gradeLinearFrame(plate(128), grades, new Map(), live), (error: unknown) => (
		error instanceof TypeError && /requires its verified transient cube LUT body/u.test(error.message)
	));
	assert.throws(() => gradeEncodedFrame(plate(128), interpretation(), grades, new Map(), live), TypeError);
});

test('grading refuses an HDR interpretation instead of tone mapping it', () => {
	assert.throws(
		() => gradeEncodedFrame(plate(128), interpretation({ transfer: 'pq', primaries: 'bt2020' }), [], new Map(), live),
		(error: unknown) => error instanceof RangeError
			&& /refuses an HDR or wide-gamut source interpretation/u.test(error.message),
	);
});

test('an aborted grade throws its own reason, and a signal with no reason raises an AbortError', () => {
	const controller = new AbortController();
	const reason = new DOMException('the finishing frame was superseded', 'AbortError');
	controller.abort(reason);
	const reasonless = { aborted: true, reason: undefined } as unknown as AbortSignal;

	assert.throws(() => gradeEncodedFrame(plate(128), interpretation(), [], new Map(), controller.signal),
		(error: unknown) => error === reason);
	assert.throws(() => gradeLinearFrame(plate(128), [], new Map(), controller.signal),
		(error: unknown) => error === reason);
	assert.throws(() => gradeLinearFrame(plate(128), [], new Map(), reasonless), (error: unknown) => (
		error instanceof DOMException && error.name === 'AbortError'
		&& /exact execution was aborted/u.test(error.message)
	));
});

test('a linear grade applies gain to already-decoded pixels without decoding them again', () => {
	const halved = gradeLinearFrame(plate(200, 128), [grade({ gain: [0.5, 0.5, 0.5] })], new Map(), live);

	assert.deepEqual([...halved.pixels.slice(0, 4)], [100, 100, 100, 128],
		'a linear halving is exact, and alpha passes through ungraded');
	assert.deepEqual([...gradeLinearFrame(plate(200, 128), [], new Map(), live).pixels.slice(0, 4)],
		[200, 200, 200, 128], 'an empty grade stack leaves linear pixels untouched');
});

test('a browser capture sizes its canvas from the media, clears it, and returns the readback pixels', async () => {
	const { document, calls } = canvasDocument({ fill: 21 });
	const restore = installDocument(document);
	const drawable = { tag: 'drawable' };
	const video = { videoWidth: 3, videoHeight: 2, drawable };

	try {
		const captured = await captureBrowserFrame({ video }, live);
		const fallback = await captureBrowserFrame({ video: { videoWidth: 1, videoHeight: 1 } }, live);

		assert.deepEqual({ width: captured.width, height: captured.height }, { width: 3, height: 2 });
		assert.equal(captured.pixels.length, 3 * 2 * 4);
		assert.deepEqual([...captured.pixels.slice(0, 4)], [21, 0, 0, 255]);
		assert.ok(Object.isFrozen(captured), 'a captured frame is published frozen');
		assert.deepEqual(calls.cleared[0], [0, 0, 3, 2], 'the canvas is cleared over its whole extent');
		assert.deepEqual(calls.sizes, [{ width: 3, height: 2 }, { width: 1, height: 1 }],
			'each canvas is resized to its own media before the draw, not after it');
		assert.deepEqual(calls.contextOptions, { alpha: true, willReadFrequently: true });
		assert.equal(calls.drawn[0], drawable, 'the declared drawable is what gets drawn');
		assert.deepEqual(calls.drawn[1], { videoWidth: 1, videoHeight: 1 },
			'a media element with no separate drawable is drawn directly');
		assert.equal(fallback.pixels.length, 4);
	} finally {
		restore();
	}
});

test('capture refuses a missing document, a bad drawable, an out-of-range size, and no 2D context', async () => {
	const absent = installDocument(undefined);
	await assert.rejects(() => captureBrowserFrame({ video: {} }, live), (error: unknown) => (
		error instanceof Error && /source readback is unavailable/u.test(error.message)
	));
	absent();

	const restore = installDocument(canvasDocument().document);
	try {
		await assert.rejects(() => captureBrowserFrame({ video: [1] }, live), (error: unknown) => (
			error instanceof TypeError && /media drawable must be an object/u.test(error.message)
		));
		await assert.rejects(() => captureBrowserFrame({ video: { videoWidth: 0, videoHeight: 4 } }, live),
			(error: unknown) => error instanceof RangeError
				&& /media width must be a positive bounded integer/u.test(error.message));
		await assert.rejects(
			() => captureBrowserFrame({ video: { videoWidth: 4, videoHeight: 65_537 } }, live),
			(error: unknown) => error instanceof RangeError
				&& /media height must be a positive bounded integer/u.test(error.message),
		);
	} finally {
		restore();
	}

	const contextless = installDocument(canvasDocument({ context: false }).document);
	try {
		await assert.rejects(
			() => captureBrowserFrame({ video: { videoWidth: 2, videoHeight: 2 } }, live),
			(error: unknown) => error instanceof Error && /has no 2D context/u.test(error.message),
		);
	} finally {
		contextless();
	}
});

test('a capture aborted during its draw refuses rather than publishing the readback', async () => {
	const controller = new AbortController();
	const reason = new DOMException('the preview moved on', 'AbortError');
	const restore = installDocument(canvasDocument({ onDraw: () => { controller.abort(reason); } }).document);

	try {
		await assert.rejects(
			() => captureBrowserFrame({ video: { videoWidth: 2, videoHeight: 2 } }, controller.signal),
			(error: unknown) => error === reason,
		);
		const early = new AbortController();
		early.abort(reason);
		await assert.rejects(() => captureBrowserFrame({ video: { videoWidth: 2, videoHeight: 2 } }, early.signal),
			(error: unknown) => error === reason);
	} finally {
		restore();
	}
});

test('media presentations multiply opacity, take the last blend mode, and merge mask identities in order', () => {
	const finishing = finishingNode({
		visualPresentations: [
			presentation({
				id: 'p-clip', owner: { kind: 'clip', id: 'video-clip' }, opacity: 0.5,
				blendMode: 'multiply', maskMatteIds: ['mask-b', 'mask-a'],
			}),
			presentation({
				id: 'p-source', owner: { kind: 'source', id: 'video-source' }, opacity: 0.5,
				blendMode: 'screen', maskMatteIds: ['mask-a', 'mask-c'],
			}),
			presentation({
				id: 'p-off', owner: { kind: 'clip', id: 'video-clip' }, enabled: false,
				opacity: 0, blendMode: 'overlay', maskMatteIds: ['mask-z'],
			}),
			presentation({
				id: 'p-generator', owner: { kind: 'generator', id: 'video-source' },
				opacity: 0, maskMatteIds: ['mask-y'],
			}),
		],
	});

	const state = mediaPresentation(finishing, 'video-clip', 'video-source');

	assert.equal(state.opacity, 0.25, 'clip and source opacity compose multiplicatively');
	assert.equal(state.blendMode, 'screen', 'the last enabled presentation owns the blend authority');
	assert.deepEqual(state.maskIds, ['mask-a', 'mask-b', 'mask-c'],
		'mask identities are deduplicated and sorted, not appended in authoring order');
	assert.ok(Object.isFrozen(state) && Object.isFrozen(state.maskIds));
});

test('a track with no enabled presentation reports full opacity and no blend authority', () => {
	const state = mediaPresentation(finishingNode({}), 'video-clip', 'video-source');

	assert.deepEqual({ ...state, maskIds: [...state.maskIds] },
		{ opacity: 1, blendMode: null, maskIds: [] });
});

test('a combined mask multiplies its graphs and refuses an identity the finishing never carried', () => {
	const graphs = new Map<string, unknown>([
		['left', rectangleGraph('left', 0, 0, 0.5, 1)],
		['top', rectangleGraph('top', 0, 0, 1, 0.5)],
	]);

	const left = combinedMask(['left'], graphs, WIDTH, HEIGHT, new Map());
	const corner = combinedMask(['left', 'top'], graphs, WIDTH, HEIGHT, new Map());
	const none = combinedGraphs([], WIDTH, HEIGHT, new Map());

	assert.deepEqual([...left], [255, 255, 0, 0, 255, 255, 0, 0],
		'a half-width rectangle covers exactly the left columns of both rows');
	assert.deepEqual([...corner], [255, 255, 0, 0, 0, 0, 0, 0],
		'two graphs intersect multiplicatively rather than replacing one another');
	assert.deepEqual([...none], new Array(WIDTH * HEIGHT).fill(255),
		'no graphs means full coverage, not empty coverage');
	assert.throws(() => combinedMask(['ghost'], graphs, WIDTH, HEIGHT, new Map()), (error: unknown) => (
		error instanceof ReferenceError && /mask ghost is unavailable/u.test(error.message)
	));
});

test('mask graphs read the raster inputs they are handed and refuse a source binding that is absent', () => {
	const graph = {
		schemaVersion: 1, id: 'plate-mask', kind: 'matte',
		inputs: [{ name: 'Plate', sourceRef: 'plate-source', kind: 'raster' }],
		nodes: [{ id: 'raster', kind: 'raster', inputName: 'Plate', channel: 'red' }],
		outputNodeId: 'raster',
	};
	const pixels = new Uint8Array([255, 0, 0, 255, 0, 0, 0, 255]);
	const inputs = new Map([['plate-source', { width: 2, height: 1, pixels }]]);

	assert.deepEqual([...combinedGraphs([graph], 2, 1, inputs)], [255, 0],
		'the red channel of the bound input becomes the coverage');
	assert.throws(() => combinedGraphs([graph], 2, 1, new Map()), (error: unknown) => (
		error instanceof ReferenceError && /source plate-source is unavailable/u.test(error.message)
	));
});

test('the background decodes through the output space and refuses a colour name it cannot resolve', () => {
	const plan = (backgroundColor: string) => (
		{ output: { canvas: { backgroundColor } } } as unknown as UnifiedExactRenderPlanV13
	);
	const rec709 = finishingNode({
		colorContext: {
			schemaVersion: 1, sequenceId: 'main-sequence', workingSpace: 'linear-rec709-d65',
			outputSpace: 'rec709', alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none',
		},
	});

	const green = backgroundLinear(plan('#00ff00ff'), finishingNode({}));
	const grey = backgroundLinear(plan('#808080'), finishingNode({}));
	const greyRec709 = backgroundLinear(plan('#808080'), rec709);

	assert.deepEqual([...green], [0, 1, 0, 1], 'a saturated hexadecimal background decodes exactly');
	assert.ok(Math.abs(grey[0] - 0.2158) < 0.001, 'mid grey decodes through the sRGB transfer');
	assert.ok(greyRec709[0] > grey[0] + 0.01,
		'the BT.709 transfer decodes the same byte higher than sRGB does');
	assert.equal(grey[3], 1, 'a six-digit background is fully opaque');
	assert.throws(() => backgroundLinear(plan('red'), finishingNode({})), (error: unknown) => (
		error instanceof Error && /requires a hexadecimal background color/u.test(error.message)
	));
});

test('the identity description states a frozen unclipped full-frame placement', () => {
	const description = identityDescription(WIDTH, HEIGHT, 'multiply');

	assert.deepEqual(JSON.parse(JSON.stringify(description)), {
		crop: {
			normalized: { left: 0, top: 0, right: 0, bottom: 0 },
			sourcePixels: { x: 0, y: 0, width: WIDTH, height: HEIGHT },
		},
		sourceDisplayToCanvas: [1, 0, 0, 1, 0, 0],
		opacityStart: 1, opacityEnd: 1, blendMode: 'multiply', compositingOrder: 0,
	});
	assert.ok(Object.isFrozen(description) && Object.isFrozen(description.crop)
		&& Object.isFrozen(description.crop.sourcePixels));
	assert.equal(renderBlendMode(description), 'multiply',
		'the identity description reads back through the blend-mode admission');
	assert.equal(authoredCompositingOrder(description), 0);
});

test('render descriptions admit the eight linear blend modes and refuse anything else', () => {
	const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference', 'exclusion'];

	for (const blendMode of modes) assert.equal(renderBlendMode({ blendMode }), blendMode);

	// 'add' is a presentation blend mode, but no render description may state it.
	for (const blendMode of ['add', 'burn', 'Normal', '', null, undefined]) {
		assert.throws(() => renderBlendMode({ blendMode }), (error: unknown) => (
			error instanceof RangeError && /blend mode is unsupported/u.test(error.message)
		), `${String(blendMode)} must be refused`);
	}
	for (const value of ['normal', null, [{ blendMode: 'normal' }], 7]) {
		assert.throws(() => renderBlendMode(value), (error: unknown) => (
			error instanceof TypeError && /render description must be an object/u.test(error.message)
		), `${String(value)} is not a render description`);
	}
});

test('authored compositing orders admit their signed sixteen-bit range and refuse everything outside it', () => {
	for (const compositingOrder of [0, -32_768, 32_767, -1, 12]) {
		assert.equal(authoredCompositingOrder({ compositingOrder }), compositingOrder);
	}
	for (const compositingOrder of [-32_769, 32_768, 1.5, Number.NaN, '5', null, undefined, 2 ** 53]) {
		assert.throws(() => authoredCompositingOrder({ compositingOrder }), (error: unknown) => (
			error instanceof RangeError && /compositing order is outside its range/u.test(error.message)
		), `${String(compositingOrder)} must be refused`);
	}
	assert.throws(() => authoredCompositingOrder([]), TypeError);
});

test('order buckets are created once per track and reused for a repeated authored order', () => {
	const trackFrames = new Map<string, TrackOrderBucketFinishing[]>();

	const first = orderBucketEntries(trackFrames, 'video-track', 0);
	first.push('entry-a' as never);
	const again = orderBucketEntries(trackFrames, 'video-track', 0);
	const higher = orderBucketEntries(trackFrames, 'video-track', 3);
	const other = orderBucketEntries(trackFrames, 'other-track', 0);

	assert.equal(again, first, 'a repeated order reuses the bucket already recorded for the track');
	assert.deepEqual(again, ['entry-a'], 'entries pushed through one reference are visible through the other');
	assert.notEqual(higher, first, 'a second authored order opens its own bucket');
	assert.deepEqual(trackFrames.get('video-track')?.map(({ order }) => order), [0, 3],
		'buckets are recorded in the order they were first requested');
	assert.deepEqual(other, [], 'a fresh track starts with an empty bucket');
	assert.deepEqual([...trackFrames.keys()], ['video-track', 'other-track']);
	assert.equal(trackFrames.get('other-track')?.length, 1);
});
