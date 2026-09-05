/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { DEFAULT_VIDEO_CLIP_COMPOSITION } from '../src/common/editor/video-clip-composition.ts';
import {
	FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectFinishing } from '../src/framescaper/editor-project-finishing.ts';
import {
	createFramescaperSelectedTimelineFilmstripFinishing as filmstrip,
} from '../src/framescaper/editor-selected-finishing-timeline-filmstrip.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

type Data = Record<string, unknown>;

interface ContextStub {
	putImageData(image: { data: Uint8ClampedArray }): void;
	clearRect(): void;
	drawImage(): void;
	getImageData(x: number, y: number, width: number, height: number): { data: Uint8ClampedArray };
}

interface CanvasStub {
	width: number;
	height: number;
	clears: number;
	written: Uint8ClampedArray | null;
	getContext?: (kind: string, options?: Data) => ContextStub | null;
}

interface ImageStub {
	decoding: string;
	src: string;
	decode(): Promise<void>;
}

interface DecodedStub {
	readonly drawable: unknown;
	readonly width: number;
	readonly height: number;
	dispose(): void;
}

interface FilmstripCell {
	readonly key: string;
	readonly timelineSample: number;
	readonly width: number;
	readonly height: number;
	readonly pixels: Uint8Array;
}

const WIDTH = 64;
const HEIGHT = 36;

/**
 * A canvas that really remembers a written frame, so the strip's readback is the
 * composite the exact render produced. An unwritten canvas answers with `fill`,
 * which is how a test paints the plate its stub decode hands to the compositor.
 */
function canvasStub(fill: number): CanvasStub {
	const canvas: CanvasStub = { width: 0, height: 0, clears: 0, written: null };
	canvas.getContext = () => ({
		putImageData: (image: { data: Uint8ClampedArray }) => { canvas.written = image.data; },
		clearRect: () => { canvas.clears += 1; },
		drawImage: () => undefined,
		getImageData: (_x: number, _y: number, width: number, height: number) => ({
			data: canvas.written ?? new Uint8ClampedArray(width * height * 4).fill(fill),
		}),
	});
	return canvas;
}

interface DomHandles {
	readonly canvases: readonly CanvasStub[];
	readonly images: readonly ImageStub[];
}

/** Install the browser image surfaces the exact preview output and image decode demand. */
function installDom(t: TestContext, options: Readonly<{
	bitmap?: Readonly<{ width: number; height: number }> | undefined;
	decodeImage?: (image: ImageStub) => Promise<void>;
	plateFill?: number;
}> = {}): DomHandles {
	const root = globalThis as unknown as Data;
	const previous = {
		document: root.document, ImageData: root.ImageData, createImageBitmap: root.createImageBitmap,
	};
	const canvases: CanvasStub[] = [];
	const images: ImageStub[] = [];
	root.document = {
		createElement(tag: string): unknown {
			if (tag === 'img') {
				const image: ImageStub = {
					decoding: '', src: '',
					decode: () => (options.decodeImage ? options.decodeImage(image) : Promise.resolve()),
				};
				images.push(image);
				return image;
			}
			const canvas = canvasStub(options.plateFill ?? 0);
			canvases.push(canvas);
			return canvas;
		},
	};
	root.ImageData = class {
		constructor(
			readonly data: Uint8ClampedArray, readonly width: number, readonly height: number,
		) {}
	};
	const bitmap = options.bitmap;
	if (bitmap) root.createImageBitmap = async () => ({ ...bitmap, close: () => undefined });
	else delete root.createImageBitmap;
	t.after(() => {
		for (const [name, value] of Object.entries(previous)) {
			if (value === undefined) delete root[name];
			else root[name] = value;
		}
	});
	return { canvases, images };
}

function store(): never {
	return { loadMediaAsset: async () => null, loadSource: async () => null } as unknown as never;
}

function pictureOptions(): Data {
	return { ...framescaperV20Options(), videoTransitionsByTrackId: { 'video-track': [] } };
}

function projectOf(options: Data): Data {
	return createFramescaperProjectFinishing(PROFILE, options as never) as unknown as Data;
}

function frame(overrides: Data = {}): Data {
	return {
		key: 'cell-0', clipId: 'video-clip', sourceId: 'video-source',
		timelineSample: 0, sourceUrl: 'blob:cell-0', ...overrides,
	};
}

/** A decoded plate whose geometry differs from the canvas so placement really scales. */
function decoded(disposals: string[], width = 8, height = 4): DecodedStub {
	return {
		drawable: { readback: 'plate' }, width, height,
		dispose() { disposals.push(`${String(width)}x${String(height)}`); },
	};
}

function strip(overrides: Data = {}): Promise<unknown> {
	return filmstrip({
		profile: PROFILE, project: projectOf(pictureOptions()), store: store(),
		width: WIDTH, height: HEIGHT, frames: [frame()], ...overrides,
	} as never);
}

async function cells(overrides: Data = {}): Promise<readonly FilmstripCell[]> {
	const result = await strip(overrides);
	assert.ok(Array.isArray(result), 'a picture project must answer with a filmstrip');
	return result as readonly FilmstripCell[];
}

test('every requested cell is rendered through the exact preview session at its own sample', async (t) => {
	installDom(t);
	const disposals: string[] = [];
	const seen: Data[] = [];

	const rendered = await cells({
		frames: [frame(), frame({ key: 'cell-1', timelineSample: 24_000, sourceUrl: 'blob:cell-1' })],
		decodeSource: (url: string, width: number, height: number, signal: AbortSignal) => {
			seen.push({ url, width, height, aborted: signal.aborted });
			return Promise.resolve(decoded(disposals));
		},
	});

	assert.deepEqual(
		rendered.map(({ key, timelineSample, width, height }) => ({ key, timelineSample, width, height })),
		[
			{ key: 'cell-0', timelineSample: 0, width: WIDTH, height: HEIGHT },
			{ key: 'cell-1', timelineSample: 24_000, width: WIDTH, height: HEIGHT },
		],
	);
	assert.deepEqual(seen, [
		{ url: 'blob:cell-0', width: WIDTH, height: HEIGHT, aborted: false },
		{ url: 'blob:cell-1', width: WIDTH, height: HEIGHT, aborted: false },
	], 'each cell is decoded at the requested thumbnail box, not at source size');
	assert.deepEqual(disposals, ['8x4', '8x4'], 'every decoded plate is released with its cell');
	for (const cell of rendered) {
		assert.ok(cell.pixels instanceof Uint8Array);
		assert.equal(cell.pixels.length, WIDTH * HEIGHT * 4);
		assert.deepEqual(
			[...cell.pixels.slice(0, 4)],
			[0, 0, 0, 255],
			'a transparent plate over the plan background reads back as opaque black',
		);
	}
	assert.ok(Object.isFrozen(rendered));
});

test('the authored clip presentation is carried into the cell the strip composites', async (t) => {
	installDom(t, { plateFill: 255 });
	const brightness = async (opacity: number): Promise<readonly number[]> => {
		const options = pictureOptions();
		(options.clips as Data[])[0]!.videoComposition = {
			...DEFAULT_VIDEO_CLIP_COMPOSITION, opacity,
		};
		const rendered = await cells({
			project: projectOf(options),
			decodeSource: () => Promise.resolve(decoded([], WIDTH, HEIGHT)),
		});
		return [...rendered[0]!.pixels.slice(0, 4)];
	};

	const opaque = await brightness(1);
	const faded = await brightness(0.25);

	assert.deepEqual(opaque, [255, 255, 255, 255], 'a white plate at full opacity fills the cell');
	assert.equal(faded[3], 255, 'the plan background keeps the cell opaque');
	assert.ok(
		faded[0]! > 0 && faded[0]! < opaque[0]!,
		`an authored quarter opacity must dim the plate, not drop it: ${String(faded)}`,
	);
});

test('an odd or undersized filmstrip box is rounded down to the even dimensions the codec admits', async (t) => {
	installDom(t);
	const seen: Data[] = [];
	const stopped = new Error('decode stopped once the box was recorded');
	const decodeSource = (_url: string, width: number, height: number) => {
		seen.push({ width, height });
		return Promise.reject(stopped);
	};

	const stoppedHere = (error: unknown) => error === stopped;
	await assert.rejects(() => strip({ width: 65, height: 37, decodeSource }), stoppedHere);
	await assert.rejects(() => strip({ width: 1, height: 1, decodeSource }), stoppedHere);

	assert.deepEqual(seen, [{ width: 64, height: 36 }, { width: 2, height: 2 }]);
});

test('a project with no picture clips composes no session and answers with no filmstrip', async (t) => {
	installDom(t);
	const options = pictureOptions();
	options.clips = (options.clips as Data[]).filter(({ kind }) => kind === 'audio');
	options.tracks = (options.tracks as Data[]).filter(({ type }) => type === 'audio');
	(options.sequences as Data[])[0]!.trackIds = ['audio-track'];
	(options.projectBin as Data).clips = [];
	delete options.videoTransitionsByTrackId;

	assert.equal(
		await strip({ project: projectOf(options) }),
		null,
		'a session that never opens must not be reported as an empty strip',
	);
});

test('a cell whose clip is not active at its sample is refused before the plate is decoded', async (t) => {
	installDom(t);
	let decodes = 0;
	const decodeSource = () => { decodes += 1; return Promise.resolve(decoded([])); };

	await assert.rejects(
		() => strip({ frames: [frame({ timelineSample: 48_000 })], decodeSource }),
		(error: unknown) => {
			assert.ok(error instanceof ReferenceError);
			assert.match(error.message, /clip video-clip is not active at its requested sample/u);
			return true;
		},
	);
	assert.equal(decodes, 0, 'a refused cell must not spend a decode');
});

test('a cell that names a source the active clip does not carry is refused as an authority change', async (t) => {
	installDom(t);

	await assert.rejects(
		() => strip({
			frames: [frame({ sourceId: 'audio-source' })],
			decodeSource: () => Promise.resolve(decoded([])),
		}),
		(error: unknown) => {
			assert.ok(error instanceof Error && !(error instanceof ReferenceError));
			assert.match(error.message, /clip video-clip changed source authority/u);
			return true;
		},
	);
});

test('a cell identity must be a record of stable IDs and bounded source text', async (t) => {
	installDom(t);

	await assert.rejects(() => strip({ frames: ['cell'] }), /frame 0 must be an object/u);
	await assert.rejects(
		() => strip({ frames: [frame({ clipId: 'not a clip id' })] }),
		/clip ID must be a stable ID/u,
	);
	await assert.rejects(
		() => strip({ frames: [frame({ sourceId: '' })] }),
		/source ID must be a stable ID/u,
	);
	await assert.rejects(
		() => strip({ frames: [frame({ sourceUrl: '' })] }),
		/source URL must be non-empty bounded text/u,
	);
	await assert.rejects(
		() => strip({ frames: [frame({ sourceUrl: 'b'.repeat(1_048_577) })] }),
		/source URL must be non-empty bounded text/u,
	);
});

test('cancelling while a plate is in flight releases that plate and abandons the strip', async (t) => {
	installDom(t);
	const controller = new AbortController();
	const reason = new Error('the timeline scrolled away from the strip');
	const disposals: string[] = [];

	await assert.rejects(
		() => strip({
			signal: controller.signal,
			frames: [frame(), frame({ key: 'cell-1', timelineSample: 24_000 })],
			decodeSource: () => {
				controller.abort(reason);
				return Promise.resolve(decoded(disposals));
			},
		}),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(
		disposals,
		['8x4'],
		'the plate decoded before the abort is still released, and no second cell is started',
	);
});

test('a decode failure is surfaced to the caller unchanged', async (t) => {
	installDom(t);
	const failure = new TypeError('the object URL was revoked');

	await assert.rejects(
		() => strip({ decodeSource: () => Promise.reject(failure) }),
		(error: unknown) => error === failure,
	);
});

/**
 * Break the exact preview output canvas the session already opened, from inside
 * the decode seam. Nothing is created between that canvas and the first decode,
 * so the newest canvas is the output the strip will read its pixels back from.
 */
function sabotage(canvases: readonly CanvasStub[], replacement: CanvasStub['getContext']): void {
	const output = canvases.at(-1);
	assert.ok(output, 'the session opens its exact output canvas before the first decode');
	output.getContext = replacement;
}

test('an exact output whose canvas has no readable context is refused', async (t) => {
	const dom = installDom(t);
	const withContext = (replacement: CanvasStub['getContext']) => strip({
		decodeSource: () => {
			sabotage(dom.canvases, replacement);
			return Promise.resolve(decoded([]));
		},
	});

	await assert.rejects(() => withContext(undefined), (error: unknown) => {
		assert.ok(error instanceof TypeError);
		assert.match(error.message, /output has no canvas context/u);
		return true;
	});
	await assert.rejects(() => withContext(() => null), /output has no readable 2D context/u);
	await assert.rejects(
		() => withContext(() => ({
			putImageData: () => undefined, clearRect: () => undefined, drawImage: () => undefined,
		} as unknown as ContextStub)),
		/output has no readable 2D context/u,
	);
});

test('an exact output that reads back the wrong pixel geometry is refused', async (t) => {
	const dom = installDom(t);
	const readingBack = (data: Uint8ClampedArray | Uint8Array) => strip({
		decodeSource: () => {
			sabotage(dom.canvases, () => ({
				putImageData: () => undefined, clearRect: () => undefined, drawImage: () => undefined,
				getImageData: () => ({ data: data as Uint8ClampedArray }),
			}));
			return Promise.resolve(decoded([]));
		},
	});

	await assert.rejects(
		() => readingBack(new Uint8ClampedArray(WIDTH * HEIGHT * 4 - 4)),
		(error: unknown) => {
			assert.ok(error instanceof RangeError);
			assert.match(error.message, /output geometry changed/u);
			return true;
		},
	);
	await assert.rejects(
		() => readingBack(new Uint8Array(WIDTH * HEIGHT * 4)),
		/output geometry changed/u,
	);
});

test('the shipped decode refuses to run without a browser image runtime', async (t) => {
	installDom(t);

	await assert.rejects(() => strip(), /thumbnail decode requires a browser image runtime/u);
});

test('the shipped decode scales an object URL down through an image element and a canvas', async (t) => {
	const dom = installDom(t, { bitmap: { width: 200, height: 50 } });

	const rendered = await cells();

	assert.deepEqual(
		rendered.map(({ key, width, height }) => ({ key, width, height })),
		[{ key: 'cell-0', width: WIDTH, height: HEIGHT }],
	);
	assert.equal(dom.images.length, 1);
	assert.deepEqual(
		{ decoding: dom.images[0]!.decoding, src: dom.images[0]!.src },
		{ decoding: 'async', src: 'blob:cell-0' },
		'the plate is loaded as an image, which is what the shipped policy admits for a blob URL',
	);
	// The session's output canvas comes first; the plate the decode draws is next,
	// scaled by min(1, 64/200, 36/50) and read back by the exact capture after it.
	assert.deepEqual(
		dom.canvases.map(({ width, height }) => [width, height]),
		[[WIDTH, HEIGHT], [64, 16], [64, 16]],
	);
	assert.equal(dom.canvases[1]!.clears, 1, 'the plate canvas is cleared when its cell is released');
});

test('cancelling while the plate image decodes rejects with the caller reason and drops the load', async (t) => {
	const controller = new AbortController();
	const reason = new DOMException('the strip was scrolled off screen', 'AbortError');
	const dom = installDom(t, {
		bitmap: { width: 128, height: 72 },
		decodeImage: () => {
			queueMicrotask(() => { controller.abort(reason); });
			return new Promise<void>(() => undefined);
		},
	});

	await assert.rejects(
		() => strip({ signal: controller.signal }),
		(error: unknown) => error === reason,
	);
	assert.equal(dom.images.length, 1);
	assert.equal(dom.images[0]!.src, '', 'an abandoned load releases the object URL it was given');
});
