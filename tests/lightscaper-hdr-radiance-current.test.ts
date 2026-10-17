/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

async function owner() {
	assert.ok(existsSync(new URL('../src/common/editor/imaging/image-hdr-radiance-v1.ts', import.meta.url)), 'HDR requires tiled native radiance reconstruction.');
	return import('../src/common/editor/imaging/image-hdr-radiance-v1.ts');
}
async function contract() { assert.ok(existsSync(new URL('../src/common/editor/imaging/image-hdr-merge-contract-v1.ts', import.meta.url))); return import('../src/common/editor/imaging/image-hdr-merge-contract-v1.ts'); }
function descriptor(width: number, height: number) { return { schemaVersion: 1 as const, width, height, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const }; }
const code = (value: number) => Math.round(65535 * Math.max(0, Math.min(1, value)));
function words(width: number, height: number, value: (x: number, y: number) => readonly number[]) {
	return { descriptor: descriptor(width, height), pixels: Uint16Array.from(Array.from({ length: width * height }, (_, i) => [...value(i % width, Math.floor(i / width)), 65535]).flat()) };
}
async function plan(width: number, height: number, exposures: readonly number[], deghost: 'off' | 'reference-v1' = 'off', threshold = .05) {
	const api = await contract(), scalar = api.prepareImageHdrMergeV1({ schemaVersion: 1, referenceIndex: 1, alignment: 'none', deghost: { mode: deghost, threshold }, inputs: exposures.map(exposureMultiplier => ({ descriptor: descriptor(width, height), exposureMultiplier })) });
	return api.finalizeImageHdrMergeV1(scalar, exposures.map(() => ({ x: 0, y: 0, error: 0, support: width * height })));
}
function gate() { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); return { promise, release }; }
function close(actual: number, expected: number, tolerance = .0001) { assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`); }

test('independent unit-profile radiance literal reconstructs three and deterministic all-clipped fallback', async () => {
	const api = await owner();
	assert.deepEqual(api.imageHdrRadianceChannelV1([.75, 1, 1], [.25, 1, 4]), { value: 3, unresolved: false });
	assert.deepEqual(api.imageHdrRadianceChannelV1([.125, .5, 1], [.25, 1, 4]), { value: .5, unresolved: false });
	assert.deepEqual(api.imageHdrRadianceChannelV1([1, 1, 1], [.25, 1, 4]), { value: 4, unresolved: true });
	assert.deepEqual(api.imageHdrRadianceChannelV1([0, 0, 0], [.25, 1, 4]), { value: 0, unresolved: true });
	assert.throws(() => api.imageHdrRadianceChannelV1([NaN, .5], [.25, 1]));
});

test('native word tiles retain HDR, mixed clipped channels and subword precision without a byte intermediate', async () => {
	const api = await owner(), exposures = [.25, 1, 4], aligned = await plan(3, 1, exposures), tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width: 3, height: 1 });
	const scene = [[3, .5, .125], [.1, 2, .25], [1 / 65535, 2 / 65535, 3 / 65535]], frames = exposures.map(exposure => words(3, 1, x => scene[x]!.map(n => code(n * exposure))));
	const before = frames.map(source => source.pixels.slice()); let borrowed: Float32Array | undefined;
	await api.withImageHdrRadianceTileV1(tile, frames, view => {
		borrowed = view.frame.pixels; assert.equal(view.frame.descriptor.sampleFormat, 'float32');
		for (let x = 0; x < 3; x++) for (let c = 0; c < 3; c++) {
			if (x !== 2) close(view.frame.pixels[x * 4 + c]!, scene[x]![c]!);
			else {
				// Quantized bracket codes are [0,1,4], [1,2,8], [1,3,12].
				// Endpoint weights therefore give independent rational radiances
				// [1,24/11,49/16]/65535, rather than the unquantized scene.
				assert.equal(view.frame.pixels[x * 4 + c], Math.fround([1, 24 / 11, 49 / 16][c]! / 65535));
			}
		}
		assert.equal(view.frame.pixels[3], 1); assert.ok(view.frame.pixels[0]! > 1); assert.notEqual(view.frame.pixels[8], view.frame.pixels[9]);
		assert.equal(view.diagnostics.motionPixels, 0); assert.ok(view.diagnostics.referenceClippedPixels >= 2);
	});
	assert.ok(borrowed?.every(n => n === 0)); frames.forEach((source, i) => { assert.deepEqual(source.pixels, before[i]); });
});

test('reference deghost keeps one moving foreground while reconstructing a separate static HDR highlight', async () => {
	const api = await owner(), width = 31, height = 9, exposures = [.25, 1, 4];
	const aligned = await plan(width, height, exposures, 'reference-v1', .04), tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width, height });
	const positions = [4, 12, 20], frames = exposures.map((exposure, index) => words(width, height, (x, y) => {
		const radiance = x >= positions[index]! && x < positions[index]! + 3 && y >= 3 && y <= 5 ? .8 : x >= 26 ? 3 : .2;
		return [code(radiance * exposure), code(radiance * exposure), code(radiance * exposure)];
	}));
	await api.withImageHdrRadianceTileV1(tile, frames, view => {
		close(view.frame.pixels[(4 * width + 13) * 4]!, .8);
		for (const x of [5, 21]) close(view.frame.pixels[(4 * width + x) * 4]!, .2);
		close(view.frame.pixels[(4 * width + 28) * 4]!, 3); assert.ok(view.diagnostics.motionPixels > 0); assert.ok(view.diagnostics.inconsistentPixels > 0);
	});
});

test('motion dilation across adjacent tile boundaries equals one complete evaluation and still averages distant static pixels', async () => {
	const api = await owner(), width = 12, height = 7, aligned = await plan(width, height, [.25, 1], 'reference-v1', .2);
	const frames = [words(width, height, (x, y) => { const n = x === 5 && y === 3 ? .8 : .25; return [code(n * .25), code(n * .25), code(n * .25)]; }),
		words(width, height, () => [code(.2), code(.2), code(.2)])];
	async function evaluated(x: number, tileWidth: number) {
		const tile = api.prepareImageHdrRadianceTileV1(aligned, { x, y: 0, width: tileWidth, height });
		const windows = tile.windows.map((window, i) => ({ descriptor: window.descriptor, pixels: Uint16Array.from(Array.from({ length: window.descriptor.width * window.descriptor.height }, (_, at) => {
			const from = ((window.y + Math.floor(at / window.descriptor.width)) * width + window.x + at % window.descriptor.width) * 4;
			return Array.from(frames[i]!.pixels.slice(from, from + 4));
		}).flat()) }));
		return api.withImageHdrRadianceTileV1(tile, windows, view => view.frame.pixels.slice());
	}
	const full = await evaluated(0, width), left = await evaluated(0, 6), right = await evaluated(6, 6);
	for (let y = 0; y < height; y++) {
		assert.deepEqual(left.slice(y * 24, y * 24 + 24), full.slice(y * 48, y * 48 + 24));
		assert.deepEqual(right.slice(y * 24, y * 24 + 24), full.slice(y * 48 + 24, y * 48 + 48));
	}
	assert.equal(full[(3 * width + 6) * 4], Math.fround(.2)); assert.ok(full[0]! > .205);
});

test('encoded-sRGB byte windows decode before radiance weighting and remain borrowed inputs', async () => {
	const api = await owner(), contracts = await contract(), encodedDescriptor = { ...descriptor(1, 1), sampleFormat: 'unorm8', transfer: 'srgb' };
	const scalar = contracts.prepareImageHdrMergeV1({ schemaVersion: 1, referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .05 },
		inputs: [0, 1].map(() => ({ descriptor: encodedDescriptor, exposureMultiplier: 1 })) });
	const tile = api.prepareImageHdrRadianceTileV1(contracts.finalizeImageHdrMergeV1(scalar, [0, 1].map(() => ({ x: 0, y: 0, error: 0, support: 1 }))), { x: 0, y: 0, width: 1, height: 1 });
	const frames = [64, 192].map(n => ({ descriptor: encodedDescriptor, pixels: Uint8Array.of(n, n, n, 255) }));
	const decode = (n: number) => ((n / 255 + .055) / 1.055) ** 2.4, a = decode(64), b = decode(192), wa = Math.min(a, 1 - a), wb = Math.min(b, 1 - b);
	await api.withImageHdrRadianceTileV1(tile, frames, view => { assert.equal(view.frame.pixels[0], Math.fround((wa * a + wb * b) / (wa + wb))); assert.equal(view.frame.pixels[3], 1); });
	assert.deepEqual(Array.from(frames[0]!.pixels), [64, 64, 64, 255]); assert.deepEqual(Array.from(frames[1]!.pixels), [192, 192, 192, 255]);
});

test('radiance mean improves deterministic static noise and endpoint fallback reports missing information', async () => {
	const api = await owner(), aligned = await plan(2, 1, [1, 1, 1]), tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width: 2, height: 1 });
	const frames = [.24, .27, .24].map(n => words(2, 1, x => x === 0 ? [code(n), code(n), code(n)] : [65535, 65535, 65535]));
	await api.withImageHdrRadianceTileV1(tile, frames, view => {
		assert.ok(Math.abs(view.frame.pixels[0]! - .25) < Math.abs(.27 - .25) / 5);
		assert.equal(view.frame.pixels[4], 1); assert.equal(view.diagnostics.fallbackChannels, 3); assert.equal(view.diagnostics.unresolvedPixels, 1);
	});
});

test('tile windows include exact translated two-pixel motion halos and never admit whole-image inputs', async () => {
	const api = await owner(), contracts = await contract(), scalar = contracts.prepareImageHdrMergeV1({ schemaVersion: 1, referenceIndex: 0, alignment: 'ward-mtb-v1', deghost: { mode: 'reference-v1', threshold: .05 },
		inputs: [0, 1].map(() => ({ descriptor: descriptor(1024, 1024), exposureMultiplier: 1 })) });
	const aligned = contracts.finalizeImageHdrMergeV1(scalar, [{ x: 0, y: 0, error: 0, support: 1000 }, { x: 3, y: -2, error: .01, support: 1000 }]);
	const tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 10, y: 20, width: 256, height: 256 });
	assert.deepEqual(tile.windows.map(window => ({ x: window.x, y: window.y, width: window.descriptor.width, height: window.descriptor.height })),
		[{ x: 11, y: 18, width: 260, height: 260 }, { x: 8, y: 20, width: 260, height: 260 }]);
	assert.ok(tile.maximumWorkingBytes <= 16 * 1024 * 1024);
	assert.throws(() => api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width: 257, height: 1 }));
	await assert.rejects(api.withImageHdrRadianceTileV1(tile, [words(1024, 1024, () => [10, 10, 10]), words(1024, 1024, () => [10, 10, 10])], () => assert.fail('whole frame window refused')));
});

test('window admission refuses alpha/profile/forged-plan/physical-budget errors before consumer publication', async () => {
	const api = await owner(), aligned = await plan(1, 1, [1, 1]), tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width: 1, height: 1 });
	const one = words(1, 1, () => [100, 200, 300]), other = words(1, 1, () => [100, 200, 300]);
	const alpha = words(1, 1, () => [100, 200, 300]); alpha.pixels[3] = 65534;
	await assert.rejects(api.withImageHdrRadianceTileV1(tile, [one, alpha], () => assert.fail('opaque only')));
	await assert.rejects(api.withImageHdrRadianceTileV1(tile, [one, { descriptor: { ...other.descriptor, sampleFormat: 'unorm8', transfer: 'srgb' }, pixels: Uint8Array.of(1, 2, 3, 255) }], () => assert.fail('exact captured source profile required')));
	await assert.rejects(api.withImageHdrRadianceTileV1({ ...tile }, [one, other], () => assert.fail('owning plan required')));
	const huge = new ArrayBuffer(16 * 1024 * 1024), padded = { ...other, pixels: new Uint16Array(huge, 0, 4) }; padded.pixels.set(other.pixels);
	await assert.rejects(api.withImageHdrRadianceTileV1(tile, [one, padded], () => assert.fail('full physical backing must be charged')), /budget|working|physical/iu);
});

test('held tile consumption joins before cancellation and detached output retains distinct cleanup failure', async () => {
	const api = await owner(), aligned = await plan(4, 4, [1, 1]), tile = api.prepareImageHdrRadianceTileV1(aligned, { x: 0, y: 0, width: 4, height: 4 });
	const frames = [0, 1].map(() => words(4, 4, () => [16000, 24000, 32000])), held = gate(), entered = gate(), controller = new AbortController(), reason = Object.create(null) as object;
	let pixels: Float32Array | undefined, settled = false;
	const operation = api.withImageHdrRadianceTileV1(tile, frames, async view => { pixels = view.frame.pixels; entered.release(); await held.promise; }, controller.signal);
	void operation.then(() => { settled = true; }, () => { settled = true; }); await entered.promise; controller.abort(reason); await Promise.resolve();
	assert.equal(settled, false); assert.ok(pixels?.some(n => n > 0)); held.release();
	try { await operation; assert.fail('exact opaque cancellation required'); } catch (error) { assert.equal(error, reason); }
	assert.ok(pixels?.every(n => n === 0));
	let observed: unknown;
	try { await api.withImageHdrRadianceTileV1(tile, frames, view => { structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw reason; }); }
	catch (error) { observed = error; }
	assert.ok(observed instanceof AggregateError); assert.ok(observed.errors.some((error: unknown) => Object.is(error, reason)));
	assert.ok(observed.errors.some((error: unknown) => error instanceof TypeError));
});
