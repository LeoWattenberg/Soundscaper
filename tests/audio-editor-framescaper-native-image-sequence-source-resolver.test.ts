/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
	createFramescaperNativeImageSequenceSourceResolver,
	type FramescaperNativeImageSequenceSourceAsset,
} from '../src/common/editor/ui/framescaper-native-image-sequence-source-resolver.ts';

const SOURCE_ID = 'sequence-source';
const CLIP_ID = 'sequence-clip';
const IDENTITY = '1'.repeat(64);
const CLAIM_ID = 'a'.repeat(40);
const REQUEST_ID = 'b'.repeat(40);
const RATE = Object.freeze({ num: 60_000, den: 1_001 });

for (const extension of ['png', 'tiff'] as const) {
	test(`native ${extension.toUpperCase()} sequence presents exact 60000/1001 pixels and opaque alpha`, async () => {
		const pixels = [Uint8Array.of(11, 22, 33, 255), Uint8Array.of(44, 55, 66, 255)];
		const fixture = bridgeFixture(framePack(pixels));
		const written: number[][] = [];
		const canvas = { width: 0, height: 0 } as HTMLCanvasElement;
		const resolver = createFramescaperNativeImageSequenceSourceResolver({
			projectId: 'project-1', projectRevision: 8,
			sources: [asset(extension)], bridge: fixture.bridge,
			createCanvas: () => canvas,
			writeRgba: (_canvas, bytes) => { written.push([...bytes]); },
			mintRequestId: () => REQUEST_ID,
		});
		const presentation = await resolver.resolveSource(entry(0), {
			signal: new AbortController().signal,
		});
		await presentation.present(entry(0), { signal: new AbortController().signal });
		await presentation.present(entry(1), { signal: new AbortController().signal });
		assert.deepEqual(written, pixels.map((value) => [...value]));
		assert.deepEqual(fixture.reads, [
			{ claimId: CLAIM_ID, offset: 59, length: 32 },
			{ claimId: CLAIM_ID, offset: 91, length: 4 },
			{ claimId: CLAIM_ID, offset: 95, length: 32 },
			{ claimId: CLAIM_ID, offset: 127, length: 4 },
		]);
		assert.equal(fixture.decodes.length, 1);
		assert.deepEqual(fixture.decodes[0], {
			requestId: REQUEST_ID, projectId: 'project-1', projectRevision: 8, sourceId: SOURCE_ID,
		});
		await presentation.dispose();
		await resolver.dispose();
		assert.deepEqual(fixture.releases, [CLAIM_ID]);
		assert.equal(canvas.width, 0);
		assert.equal(canvas.height, 0);
	});
}

test('native sequence rejects a 30fps descriptor before reading a 60000/1001 claim', async () => {
	const fixture = bridgeFixture(framePack([Uint8Array.of(1, 2, 3, 255), Uint8Array.of(4, 5, 6, 255)]));
	const resolver = createFramescaperNativeImageSequenceSourceResolver({
		projectId: 'project-1', projectRevision: 1, sources: [asset('png')], bridge: fixture.bridge,
		createCanvas: () => ({ width: 0, height: 0 } as HTMLCanvasElement),
		writeRgba: () => undefined, mintRequestId: () => REQUEST_ID,
	});
	const presentation = await resolver.resolveSource(entry(1, descriptor(1, { num: 30, den: 1 })), {
		signal: new AbortController().signal,
	});
	await assert.rejects(
		async () => {
			await presentation.present(entry(1, descriptor(1, { num: 30, den: 1 })), {
				signal: new AbortController().signal,
			});
		},
		/exact rational frame timing/u,
	);
	assert.deepEqual(fixture.reads, []);
	await resolver.dispose();
});

test('native sequence rejects tampered frame authority and short pixel content without canvas install', async () => {
	const pack = framePack([Uint8Array.of(1, 2, 3, 255), Uint8Array.of(4, 5, 6, 255)]);
	new DataView(pack.buffer, pack.byteOffset, pack.byteLength).setBigInt64(59 + 8, 9n, true);
	let writes = 0;
	const tampered = bridgeFixture(pack);
	const first = resolverFor(tampered, () => { writes += 1; });
	const firstPresentation = await first.resolveSource(entry(0), { signal: new AbortController().signal });
	await assert.rejects(
		async () => { await firstPresentation.present(entry(0), { signal: new AbortController().signal }); },
		/frame header changed/u,
	);
	assert.equal(writes, 0);
	await first.dispose();

	const short = bridgeFixture(framePack([Uint8Array.of(1, 2, 3, 255), Uint8Array.of(4, 5, 6, 255)]), true);
	const second = resolverFor(short, () => { writes += 1; });
	const secondPresentation = await second.resolveSource(entry(0), { signal: new AbortController().signal });
	await assert.rejects(
		async () => { await secondPresentation.present(entry(0), { signal: new AbortController().signal }); },
		/range was short/u,
	);
	assert.equal(writes, 0);
	await second.dispose();
});

test('resolver cancellation releases a late claim and never installs its canvas', async () => {
	const pack = framePack([Uint8Array.of(1, 2, 3, 255), Uint8Array.of(4, 5, 6, 255)]);
	const claim = claimFor(pack);
	let complete!: (value: typeof claim) => void;
	const pending = new Promise<typeof claim>((resolve) => { complete = resolve; });
	const cancellations: string[] = [];
	const releases: string[] = [];
	let canvases = 0;
	const resolver = createFramescaperNativeImageSequenceSourceResolver({
		projectId: 'project-1', projectRevision: 1, sources: [asset('png')],
		bridge: {
			decodeImageSequenceSource: () => pending,
			cancelImageSequenceDecode: async ({ requestId }) => { cancellations.push(requestId); return true; },
			readImageSequenceDecode: async () => new Uint8Array(),
			releaseImageSequenceDecode: async ({ claimId }) => { releases.push(claimId); return true; },
		},
		createCanvas: () => { canvases += 1; return { width: 0, height: 0 } as HTMLCanvasElement; },
		writeRgba: () => undefined, mintRequestId: () => REQUEST_ID,
	});
	const abort = new AbortController();
	const resolution = resolver.resolveSource(entry(0), { signal: abort.signal });
	abort.abort(new DOMException('navigation', 'AbortError'));
	complete(claim);
	await assert.rejects(async () => { await resolution; }, { name: 'AbortError' });
	await resolver.dispose();
	assert.deepEqual(cancellations, [REQUEST_ID]);
	assert.deepEqual(releases, [CLAIM_ID]);
	assert.equal(canvases, 0);
});

function resolverFor(
	fixture: ReturnType<typeof bridgeFixture>,
	writeRgba: (
		canvas: HTMLCanvasElement, bytes: Uint8ClampedArray, width: number, height: number,
	) => void,
) {
	return createFramescaperNativeImageSequenceSourceResolver({
		projectId: 'project-1', projectRevision: 1, sources: [asset('png')], bridge: fixture.bridge,
		createCanvas: () => ({ width: 0, height: 0 } as HTMLCanvasElement),
		writeRgba, mintRequestId: () => REQUEST_ID,
	});
}

function asset(extension: 'png' | 'tiff'): FramescaperNativeImageSequenceSourceAsset {
	return Object.freeze({
		sourceId: SOURCE_ID, identity: IDENTITY, extension,
		clipIds: Object.freeze([CLIP_ID]), frameCount: 2, frameRate: RATE,
		decodedWidth: 1, decodedHeight: 1, displayWidth: 1, displayHeight: 1,
		presentationForEntry: (value: Readonly<Record<string, unknown>>) => (
			value.presentationDescriptor as ReturnType<typeof descriptor>
		),
	});
}

function entry(ordinal: number, presentationDescriptor = descriptor(ordinal, RATE)) {
	return Object.freeze({
		kind: 'video', sourceId: SOURCE_ID, clipId: CLIP_ID,
		source: Object.freeze({ kind: 'video', id: SOURCE_ID, contentSha256: IDENTITY }),
		clip: Object.freeze({ kind: 'video', id: CLIP_ID, sourceId: SOURCE_ID }),
		presentationDescriptor,
	});
}

function descriptor(ordinal: number, rate: Readonly<{ num: number; den: number }>) {
	const start = exact(BigInt(ordinal) * BigInt(rate.den), BigInt(rate.num));
	const end = exact(BigInt(ordinal + 1) * BigInt(rate.den), BigInt(rate.num));
	return Object.freeze({
		outerCell: ordinal, segmentIndex: 0, mode: 'constant-forward' as const,
		sourceFrame: exact(BigInt(ordinal), 1n), sourceTime: start,
		drawableSourceFrame: ordinal, drawableSourceStartTime: start, drawableSourceEndTime: end,
	});
}

function exact(numerator: bigint, denominator: bigint) { return Object.freeze({ numerator, denominator }); }

function framePack(pixels: readonly Uint8Array[]): Uint8Array {
	const bytes = new Uint8Array(59 + pixels.length * 36);
	bytes.set(new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n'));
	const header = new DataView(bytes.buffer);
	header.setUint32(31, 1, true); header.setUint32(35, 1, true); header.setUint32(39, 1, true);
	header.setBigUint64(43, BigInt(pixels.length), true);
	header.setUint32(51, RATE.den, true); header.setUint32(55, RATE.num, true);
	let offset = 59;
	for (const [ordinal, rgba] of pixels.entries()) {
		header.setBigUint64(offset, BigInt(ordinal), true);
		header.setBigInt64(offset + 8, BigInt(ordinal), true);
		header.setBigInt64(offset + 16, 1n, true);
		header.setBigUint64(offset + 24, BigInt(rgba.byteLength), true);
		bytes.set(rgba, offset + 32);
		offset += 32 + rgba.byteLength;
	}
	return bytes;
}

function claimFor(pack: Uint8Array) {
	return Object.freeze({
		claimId: CLAIM_ID, sourceId: SOURCE_ID, byteLength: pack.byteLength,
		sha256: createHash('sha256').update(pack).digest('hex'),
		frameCount: 2, width: 1, height: 1, frameRate: RATE,
	});
}

function bridgeFixture(pack: Uint8Array, shortPixels = false) {
	const reads: Array<{ claimId: string; offset: number; length: number }> = [];
	const releases: string[] = [];
	const decodes: unknown[] = [];
	return {
		reads, releases, decodes,
		bridge: {
			decodeImageSequenceSource: async (request: unknown) => { decodes.push(request); return claimFor(pack); },
			cancelImageSequenceDecode: async () => true,
			readImageSequenceDecode: async (request: { claimId: string; offset: number; length: number }) => {
				reads.push(request);
				const length = shortPixels && request.length === 4 ? 3 : request.length;
				return pack.slice(request.offset, request.offset + length);
			},
			releaseImageSequenceDecode: async ({ claimId }: { claimId: string }) => {
				releases.push(claimId); return true;
			},
		},
	};
}
