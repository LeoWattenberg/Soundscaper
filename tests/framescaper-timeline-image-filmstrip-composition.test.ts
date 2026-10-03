/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import type {
	ProductVideoTimelineFilmstripFrame,
	ProductVideoTimelineFilmstripFrameRequest,
	ProductVideoTimelineFilmstripRequest,
} from '../src/common/editor/ui/workspace/product-video-visual-preview-runtime.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';
import {
	createFramescaperSelectedTimelineFilmstripTimelineImage as filmstrip,
} from '../src/framescaper/editor-selected-timeline-image-image-filmstrip.ts';
import {
	imageClip,
	imageFixture,
	scene,
	SECOND_PACK_FRAME_SAMPLE,
} from './helpers/framescaper-timeline-image-preview-fixture.ts';

type Data = Record<string, unknown>;

const WIDTH = 2;
const HEIGHT = 2;
const FRAME_BYTES = WIDTH * HEIGHT * 4;

function frame(
	key: string,
	clipId: string,
	sourceId: string,
	timelineSample: number,
): ProductVideoTimelineFilmstripFrameRequest {
	return { key, clipId, sourceId, timelineSample, sourceUrl: `blob:${key}` };
}

function imagePixels(index: number): Uint8Array<ArrayBuffer> {
	return Uint8Array.from({ length: FRAME_BYTES }, (_byte, offset) => (
		offset % 4 === 3 ? 255 : ((index + 1) * 37 + offset) % 251
	)) as Uint8Array<ArrayBuffer>;
}

function solidPixels(red: number, green: number, blue: number): Uint8Array<ArrayBuffer> {
	const pixels = new Uint8Array(FRAME_BYTES);
	for (let offset = 0; offset < pixels.length; offset += 4) {
		pixels.set([red, green, blue, 255], offset);
	}
	return pixels;
}

function inheritedFrame(
	request: ProductVideoTimelineFilmstripFrameRequest,
	pixels: Uint8Array<ArrayBuffer>,
): ProductVideoTimelineFilmstripFrame {
	return Object.freeze({
		key: request.key,
		timelineSample: request.timelineSample,
		width: WIDTH,
		height: HEIGHT,
		pixels,
	});
}

function render(
	frames: readonly ProductVideoTimelineFilmstripFrameRequest[],
	imageScene: Data,
	createInheritedFilmstrip: (
		request: ProductVideoTimelineFilmstripRequest,
	) => Promise<readonly ProductVideoTimelineFilmstripFrame[] | null>,
): Promise<readonly ProductVideoTimelineFilmstripFrame[] | null> {
	return filmstrip({
		profile: PROFILE,
		width: WIDTH,
		height: HEIGHT,
		frames,
		...imageScene,
		createInheritedFilmstrip,
	} as never);
}

function firstPixel(frameValue: ProductVideoTimelineFilmstripFrame): readonly number[] {
	return [...frameValue.pixels.subarray(0, 4)];
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

/** Capture the exact scaled-cache and output copies the image route creates. */
function captureImageCopies(
	t: TestContext,
	expected: readonly Uint8Array[],
): Uint8Array<ArrayBuffer>[] {
	const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'slice');
	const original = Uint8Array.prototype.slice;
	const copies: Uint8Array<ArrayBuffer>[] = [];
	Object.defineProperty(Uint8Array.prototype, 'slice', {
		configurable: true,
		writable: true,
		value(this: Uint8Array, start?: number, end?: number): Uint8Array<ArrayBuffer> {
			const copy = original.call(this, start, end) as Uint8Array<ArrayBuffer>;
			if (expected.some((pattern) => sameBytes(copy, pattern))) copies.push(copy);
			return copy;
		},
	});
	t.after(() => {
		if (descriptor) Object.defineProperty(Uint8Array.prototype, 'slice', descriptor);
		else delete (Uint8Array.prototype as Partial<typeof Uint8Array.prototype>).slice;
	});
	return copies;
}

function assertZeroized(buffers: readonly Uint8Array[], message: string): void {
	assert.ok(buffers.length > 0, `${message}: the route must create at least one tracked buffer`);
	for (const buffer of buffers) {
		assert.deepEqual(buffer, new Uint8Array(buffer.byteLength), message);
	}
}

test('mixed image and inherited cells preserve request order, keys, samples, and distinct pixels', async () => {
	const fixture = imageFixture('image-source', WIDTH, HEIGHT);
	const requests = [
		frame('image-late', 'image-clip', fixture.source.id, SECOND_PACK_FRAME_SAMPLE),
		frame('video-middle', 'video-clip', 'video-source', 24_000),
		frame('image-start', 'image-clip', fixture.source.id, 0),
		frame('video-end', 'video-clip', 'video-source', 72_000),
	];
	const inheritedRequests: ProductVideoTimelineFilmstripFrameRequest[] = [];
	const rendered = await render(requests, scene({
		fixtures: [fixture],
		clips: [imageClip('image-clip', fixture.source.id)],
	}), async (request) => {
		inheritedRequests.push(...request.frames);
		return request.frames.map((item, index) => inheritedFrame(
			item,
			index === 0 ? solidPixels(0, 0, 211) : solidPixels(211, 211, 0),
		));
	});

	assert.ok(rendered);
	assert.deepEqual(rendered.map((item) => ({
		key: item.key,
		timelineSample: item.timelineSample,
		pixel: firstPixel(item),
	})), [
		{ key: 'image-late', timelineSample: SECOND_PACK_FRAME_SAMPLE, pixel: [74, 75, 76, 255] },
		{ key: 'video-middle', timelineSample: 24_000, pixel: [0, 0, 211, 255] },
		{ key: 'image-start', timelineSample: 0, pixel: [37, 38, 39, 255] },
		{ key: 'video-end', timelineSample: 72_000, pixel: [211, 211, 0, 255] },
	]);
	assert.deepEqual(inheritedRequests.map(({ key, timelineSample, sourceUrl }) => ({
		key, timelineSample, sourceUrl,
	})), [
		{ key: 'video-middle', timelineSample: 24_000, sourceUrl: 'blob:video-middle' },
		{ key: 'video-end', timelineSample: 72_000, sourceUrl: 'blob:video-end' },
	]);
	assert.ok(Object.isFrozen(rendered));
});

test('an image-route failure zeroizes earlier image copies and every inherited output', async (t) => {
	const available = imageFixture('available-source', WIDTH, HEIGHT);
	const unavailable = imageFixture('unavailable-source', WIDTH, HEIGHT);
	const imageCopies = captureImageCopies(t, [imagePixels(0)]);
	const inheritedPixels = solidPixels(17, 34, 51);

	await assert.rejects(() => render([
		frame('available-image', 'available-clip', available.source.id, 0),
		frame('inherited-video', 'video-clip', 'video-source', 0),
		frame('unavailable-image', 'unavailable-clip', unavailable.source.id, 0),
	], scene({
		fixtures: [available, unavailable],
		stored: [available],
		clips: [
			imageClip('available-clip', available.source.id),
			imageClip('unavailable-clip', unavailable.source.id),
		],
	}), async (request) => [inheritedFrame(request.frames[0]!, inheritedPixels)]), {
		message: /image frame pack unavailable-source is unavailable/u,
	});

	assert.equal(imageCopies.length, 2, 'the scaled cache and unpublished image output are both observed');
	assertZeroized(imageCopies, 'an image failure must erase every earlier image copy');
	assertZeroized([inheritedPixels], 'an image failure must erase inherited output that cannot be published');
});

test('an inherited-route failure waits for and zeroizes every image output', async (t) => {
	const fixture = imageFixture('image-source', WIDTH, HEIGHT);
	const imageCopies = captureImageCopies(t, [imagePixels(1)]);
	const failure = new Error('the inherited video renderer failed');

	await assert.rejects(() => render([
		frame('image-cell', 'image-clip', fixture.source.id, SECOND_PACK_FRAME_SAMPLE),
		frame('video-cell', 'video-clip', 'video-source', 24_000),
	], scene({
		fixtures: [fixture],
		clips: [imageClip('image-clip', fixture.source.id)],
	}), async () => { throw failure; }), (error: unknown) => error === failure);

	assert.equal(imageCopies.length, 2, 'the scaled cache and unpublished image output are both observed');
	assertZeroized(imageCopies, 'an inherited failure must erase every completed image copy');
});

test('simultaneous image and inherited failures retain both causes and erase prior image work', async (t) => {
	const available = imageFixture('available-source', WIDTH, HEIGHT);
	const unavailable = imageFixture('unavailable-source', WIDTH, HEIGHT);
	const imageCopies = captureImageCopies(t, [imagePixels(0)]);
	const inheritedFailure = new Error('the inherited route failed too');

	await assert.rejects(() => render([
		frame('available-image', 'available-clip', available.source.id, 0),
		frame('unavailable-image', 'unavailable-clip', unavailable.source.id, 0),
		frame('video-cell', 'video-clip', 'video-source', 0),
	], scene({
		fixtures: [available, unavailable],
		stored: [available],
		clips: [
			imageClip('available-clip', available.source.id),
			imageClip('unavailable-clip', unavailable.source.id),
		],
	}), async () => { throw inheritedFailure; }), (error: unknown) => {
		assert.ok(error instanceof AggregateError);
		assert.equal(error.message, 'The timelineImage timeline filmstrip image and inherited routes both failed.');
		assert.equal(error.errors.length, 2);
		assert.match(String(error.errors[0]), /unavailable-source/u);
		assert.equal(error.errors[1], inheritedFailure);
		return true;
	});

	assert.equal(imageCopies.length, 2, 'the image route completed one cell before its failure');
	assertZeroized(imageCopies, 'a combined route failure must erase every earlier image copy');
});
