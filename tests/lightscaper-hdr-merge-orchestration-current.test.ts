/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import { readImageHdrOriginalV1, withDecodedImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { withMergedImageHdrOriginalCurrentV1, type ImageHdrMergePortsCurrentV1 } from '../src/common/editor/controller/shared/image-hdr-merge-current-v1.ts';
import { withImageHdrPixelStagingV1, type ImageHdrPixelStagingStoreV1 } from '../src/common/editor/storage/image-hdr-pixel-staging-v1.ts';
import { hdrOpfsStagingFixture } from './helpers/lightscaper-hdr-opfs-staging-fixture.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';
import { LinearDevelopOwnerV1 } from '../src/common/editor/imaging/image-develop-linear-owner-v1.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Handle = Readonly<{ byteLength: number; sha256: string }>;
type Store = ImageHdrPixelStagingStoreV1;

/** Explicit in-memory IO model for orchestration tests. Production OPFS,
 * leases and physical deletion have separate native storage-owner coverage. */
function stagedModel() {
	const bodies = new Map<Handle, Uint8Array<ArrayBuffer>>(), ranges: Uint8Array<ArrayBuffer>[] = [];
	let closed = false;
	return { get closed() { return closed; }, ranges,
		async withStaging<Result>(consume: (store: Store) => Result | Promise<Result>, _options?: unknown): Promise<Result> {
			assert.equal(closed, false);
			const store: Store = {
				async write(byteLength, produce) {
					const bytes = new Uint8Array(byteLength); let at = 0;
					await produce(Object.freeze({ async write(chunk: Uint8Array<ArrayBuffer>) {
						assert.ok(chunk.byteLength <= 1024 * 1024); assert.ok(at + chunk.byteLength <= byteLength);
						bytes.set(chunk, at); at += chunk.byteLength; await Promise.resolve();
					} }));
					assert.equal(at, byteLength); const handle = Object.freeze({ byteLength, sha256: digest(bytes) }); bodies.set(handle, bytes); return handle;
				},
				async withRead(handle, offset, length, accept) {
					assert.ok(length <= 1024 * 1024); const body = bodies.get(handle); assert.ok(body);
					assert.ok(offset >= 0 && offset + length <= body.byteLength);
					const bytes = body.slice(offset, offset + length); ranges.push(bytes);
					try { return await accept(bytes); } finally { bytes.fill(0); }
				},
			};
			try { return await consume(Object.freeze(store)); }
			finally { for (const bytes of bodies.values()) bytes.fill(0); bodies.clear(); closed = true; }
		},
	};
}

function fixture() {
	const descriptor = Object.freeze({ schemaVersion: 1 as const, width: 3, height: 1, sampleFormat: 'unorm16' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
	const codes = [[49151, 8192, 0], [65535, 32768, 1], [65535, 65535, 4]];
	const exposures = [.25, 1, 4], exposed: Uint16Array<ArrayBuffer>[] = [], events: string[] = [];
	const inputs = codes.map((_, index) => ({ product: 'lightscaper' as const, ownerId: 'catalog', sourceId: `photo-${index}`, revision: index + 1,
		original: { fileName: `Bracket ${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: String(index + 1).repeat(64), byteLength: 2048, width: 3, height: 1 },
		descriptor, exposureMultiplier: exposures[index]! }));
	const request = { schemaVersion: 1, referenceIndex: 1, alignment: 'none', deghost: { mode: 'off', threshold: .15 }, inputs };
	let active = 0;
	const ports = {
		async withCanonicalFrame<Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, signal?: AbortSignal): Promise<Result> {
			assert.equal(this, ports); signal?.throwIfAborted(); assert.equal(active, 0);
			assert.ok(exposed.every(plane => plane.every(value => value === 0)), 'previous canonical scope must retire before another source opens');
			active++; events.push(`open:${index}`);
			const pixels = Uint16Array.from(codes[index]!.flatMap(n => [n, n, n, 65535])); exposed.push(pixels);
			try { return await consume(Object.freeze({ descriptor, pixels })); }
			finally { pixels.fill(0); active--; events.push(`retired:${index}`); }
		},
	};
	return { request, ports, exposed, events, get active() { return active; } };
}
function withPorts(f: ReturnType<typeof fixture>, staging: typeof withImageHdrPixelStagingV1): ImageHdrMergePortsCurrentV1 {
	return { withCanonicalFrame: <Result>(index: number, consume: (frame: Readonly<PixelFrameV1>) => Result | Promise<Result>, signal?: AbortSignal) =>
		f.ports.withCanonicalFrame(index, consume, signal), withStaging: staging };
}

test('shared HDR owner stages canonical brackets sequentially and lends lossless encoded radiance only after native and staged storage retirement', async () => {
	const f = fixture(), stage = stagedModel(); let borrowed: Uint8Array<ArrayBuffer> | undefined;
	const ports = withPorts(f, stage.withStaging.bind(stage));
	const allocated: Float32Array<ArrayBuffer>[] = [], original = Object.getOwnPropertyDescriptor(LinearDevelopOwnerV1.prototype, 'floats')!;
	const allocate = LinearDevelopOwnerV1.prototype.floats;
	Object.defineProperty(LinearDevelopOwnerV1.prototype, 'floats', { ...original, value: function (this: LinearDevelopOwnerV1, count: number) {
		const plane = Reflect.apply(allocate, this, [count]) as Float32Array<ArrayBuffer>; allocated.push(plane); return plane;
	} });
	try { const result = await withMergedImageHdrOriginalCurrentV1(f.request, ports, async view => {
		borrowed = view.bytes; assert.equal(stage.closed, true); assert.equal(f.active, 0);
		assert.ok(f.exposed.every(plane => plane.every(value => value === 0)));
		assert.ok(allocated.length >= 2); assert.ok(allocated.every(plane => plane.every(value => value === 0)), 'master and radiance tile retire before encoded publication');
		assert.ok(stage.ranges.every(bytes => bytes.every(value => value === 0)));
		assert.equal(view.sha256, digest(view.bytes)); assert.equal(view.byteLength, view.bytes.byteLength);
		const parsed = readImageHdrOriginalV1(view.bytes); assert.deepEqual(parsed.provenance, view.provenance);
		assert.deepEqual(parsed.provenance.inputs.map(input => input.exposureMultiplier), [.25, 1, 4]);
		assert.deepEqual(parsed.provenance.output, { x: 0, y: 0, width: 3, height: 1 });
		await withDecodedImageHdrOriginalV1({ bytes: view.bytes }, decoded => {
			for (let x = 0; x < 3; x++) {
				const expected = Math.fround([196604 / 65535, 32768 / 65535, 1 / 65535][x]!);
				assert.deepEqual([...decoded.frame.pixels.subarray(x * 4, x * 4 + 4)], [expected, expected, expected, 1]);
			}
			assert.ok(decoded.frame.pixels[0]! > 1);
		});
		return 'published';
	});
	assert.equal(result, 'published'); assert.deepEqual(f.events, ['open:1', 'retired:1', 'open:0', 'retired:0', 'open:2', 'retired:2']);
	assert.ok(borrowed); assert.ok(borrowed.every(value => value === 0));
	} finally { Object.defineProperty(LinearDevelopOwnerV1.prototype, 'floats', original); }
});

test('actual binary staging closes verified native Blob snapshots and deletes all leased files before encoded HDR publication', async () => {
	const f = fixture(), native = hdrOpfsStagingFixture();
	const staging: typeof withImageHdrPixelStagingV1 = (consume, options) => withImageHdrPixelStagingV1(consume,
		{ ...options, backend: native.backend, acquireLease: native.acquireLease });
	let bytes: Uint8Array<ArrayBuffer> | undefined;
	await withMergedImageHdrOriginalCurrentV1(f.request, withPorts(f, staging), view => {
		bytes = view.bytes; assert.equal(native.files.size, 0); assert.equal(native.leases.size, 0); assert.equal(native.closed, true);
		assert.equal(readImageHdrOriginalV1(view.bytes).provenance.inputs.length, 3);
		assert.equal(native.events.filter(event => event.startsWith('delete:')).length, 3);
		assert.ok(f.exposed.every(plane => plane.every(value => value === 0)));
	});
	assert.ok(bytes?.every(value => value === 0));
});

test('actual Ward guides produce recorded translations and exact overlap rather than accepting caller-supplied placements', async () => {
	const width = 161, height = 127, stage = stagedModel(), descriptor = { schemaVersion: 1 as const, width, height,
		sampleFormat: 'unorm8' as const, primaries: 'srgb' as const, transfer: 'srgb' as const };
	const texture = (x: number, y: number) => 20 + ((Math.imul(Math.floor(x / 3) + 31, 73856093) ^ Math.imul(Math.floor(y / 3) + 17, 19349663)) >>> 0) % 190;
	const sources = [0, 1].map(index => Uint8Array.from(Array.from({ length: width * height }, (_, at) => {
		const x = at % width, y = Math.floor(at / width), n = index ? Math.min(255, Math.round(texture(x - 7, y + 4) * 1.2)) : texture(x, y);
		return [n, n, n, 255];
	}).flat()));
	const original = sources.map(bytes => bytes.slice());
	const request = { schemaVersion: 1, referenceIndex: 0, alignment: 'ward-mtb-v1', deghost: { mode: 'off', threshold: .15 },
		inputs: sources.map((_, index) => ({ product: 'framescaper', ownerId: 'project', sourceId: `image-${index}`, revision: null,
			original: { fileName: `Frame ${index}.png`, mimeType: 'image/png', sha256: String(index + 1).repeat(64), byteLength: 2048, width, height }, descriptor, exposureMultiplier: 1 })) };
	await withMergedImageHdrOriginalCurrentV1(request, {
		withStaging: stage.withStaging.bind(stage),
		async withCanonicalFrame(index, consume) { const pixels = sources[index]!.slice(); try { return await consume({ descriptor, pixels }); } finally { pixels.fill(0); } },
	}, view => {
		assert.deepEqual(view.provenance.inputs.map(input => input.offset), [{ x: 0, y: 0 }, { x: -7, y: 4 }]);
		assert.deepEqual(view.provenance.output, { x: 0, y: 4, width: 154, height: 123 });
		assert.ok(view.provenance.inputs[1]!.alignmentSupport > 1000); assert.ok(view.provenance.inputs[1]!.alignmentError < .15);
		assert.ok(stage.closed); assert.equal(readImageHdrOriginalV1(view.bytes).descriptor.width, 154);
	});
	sources.forEach((bytes, index) => { assert.deepEqual(bytes, original[index]); });
});

test('staged tiles preserve two-pixel deghost dilation across the256 boundary and retain distant reconstructed HDR', async () => {
	const width = 520, height = 7, stage = stagedModel(), f = fixture(), exposures = [.25, 1, 4], positions = [249, 257, 265];
	const descriptor = { ...f.request.inputs[0]!.descriptor, width, height };
	const inputs = f.request.inputs.map(input => ({ ...input, descriptor, original: { ...input.original, width, height } }));
	const sources = exposures.map((exposure, index) => Uint16Array.from(Array.from({ length: width * height }, (_, at) => {
		const x = at % width, y = Math.floor(at / width), n = x >= positions[index]! && x < positions[index]! + 3 && y >= 2 && y <= 4 ? .8 : x >= 500 ? 3 : .2;
		const code = Math.round(65535 * Math.min(1, n * exposure)); return [code, code, code, 65535];
	}).flat()));
	await withMergedImageHdrOriginalCurrentV1({ ...f.request, inputs, deghost: { mode: 'reference-v1', threshold: .04 } }, {
		withStaging: stage.withStaging.bind(stage),
		async withCanonicalFrame(index, consume) { const pixels = sources[index]!.slice(); try { return await consume({ descriptor, pixels }); } finally { pixels.fill(0); } },
	}, async view => {
		await withDecodedImageHdrOriginalV1({ bytes: view.bytes }, decoded => {
			for (const x of [250, 266]) assert.ok(Math.abs(decoded.frame.pixels[(3 * width + x) * 4]! - .2) < .0001);
			assert.ok(Math.abs(decoded.frame.pixels[(3 * width + 258) * 4]! - .8) < .0001);
			assert.ok(Math.abs(decoded.frame.pixels[(3 * width + 510) * 4]! - 3) < .0001);
		});
		assert.ok(view.diagnostics.motionPixels > 0); assert.ok(view.diagnostics.inconsistentPixels > 0);
	});
});

test('full request facts and receiver capabilities are captured before first staging wait', async () => {
	const f = fixture(), stage = stagedModel(), entered = deferred<void>(), release = deferred<void>();
	const ports = withPorts(f, async (consume, options) => { entered.resolve(); await release.promise; return stage.withStaging(consume, options); });
	const originalRead = ports.withCanonicalFrame;
	const work = withMergedImageHdrOriginalCurrentV1(f.request, ports, view => {
		assert.equal(view.provenance.inputs[0]!.original.fileName, 'Bracket 0.dng');
		assert.equal(view.provenance.inputs[0]!.exposureMultiplier, .25); assert.equal(view.provenance.deghost.threshold, .15);
	});
	await entered.promise; f.request.inputs[0]!.original.fileName = 'Changed'; f.request.inputs[0]!.exposureMultiplier = 2; f.request.deghost.threshold = .99;
	ports.withCanonicalFrame = () => { throw new Error('Replaced canonical capability was consulted.'); };
	try { release.resolve(); await work; } finally { release.resolve(); await work.catch(() => undefined); ports.withCanonicalFrame = originalRead; }
});

test('late canonical owner failure rejects after joining its borrower and deletes actual staged files without publishing', async () => {
	const f = fixture(), native = hdrOpfsStagingFixture(), primary = Object.freeze({ source: 'late retirement failed' }); let published = false;
	const staging: typeof withImageHdrPixelStagingV1 = (consume, options) => withImageHdrPixelStagingV1(consume, { ...options, backend: native.backend, acquireLease: native.acquireLease });
	const ports = withPorts(f, staging), read = ports.withCanonicalFrame;
	ports.withCanonicalFrame = async (index, consume, signal) => { const result = await read(index, consume, signal); if (index === 0) throw primary; return result; };
	try { await withMergedImageHdrOriginalCurrentV1(f.request, ports, () => { published = true; }); assert.fail('late native failure must reject'); }
	catch (error) { assert.ok(Object.is(error, primary)); }
	assert.equal(published, false); assert.equal(native.files.size, 0); assert.equal(native.leases.size, 0); assert.ok(native.closed);
	assert.deepEqual(f.events, ['open:1', 'retired:1', 'open:0', 'retired:0']);
});

test('held canonical cancellation joins native retirement and staging cleanup before returning its exact opaque reason', async () => {
	const f = fixture(), native = hdrOpfsStagingFixture(), entered = deferred<void>(), release = deferred<void>(), stop = new AbortController();
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let published = false;
	const staging: typeof withImageHdrPixelStagingV1 = (consume, options) => withImageHdrPixelStagingV1(consume, { ...options, backend: native.backend, acquireLease: native.acquireLease });
	const ports = withPorts(f, staging), read = ports.withCanonicalFrame;
	ports.withCanonicalFrame = (index, consume, signal) => read(index, async frame => { const result = await consume(frame); entered.resolve(); await release.promise; return result; }, signal);
	const work = withMergedImageHdrOriginalCurrentV1({ ...f.request, signal: stop.signal }, ports, () => { published = true; });
	const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; stop.abort(opaque.proxy); assert.equal(await remainsPending(work), true); assert.equal(native.files.size, 1); }
	finally { release.resolve(); }
	const outcome = await observed; assert.ok(!outcome.ok); assert.ok(Object.is(outcome.error, opaque.proxy));
	assert.equal(published, false); assert.ok(f.exposed.every(plane => plane.every(value => value === 0))); assert.equal(native.files.size, 0); assert.equal(native.leases.size, 0);
});

test('canonical source admission charges its full physical backing before staging and consults metadata before source pixels', async () => {
	const f = fixture(), stage = stagedModel(); let reads = 0;
	const ports = withPorts(f, stage.withStaging.bind(stage));
	ports.withCanonicalFrame = async (_index, consume) => consume({ descriptor: { ...f.request.inputs[0]!.descriptor, width: 4 },
		get pixels(): never { reads++; return assert.fail('changed descriptor consulted pixels'); } });
	await assert.rejects(withMergedImageHdrOriginalCurrentV1(f.request, ports, () => assert.fail('metadata mismatch reached output')), /descriptor/iu);
	assert.equal(reads, 0); assert.equal(stage.ranges.length, 0);
	const other = stagedModel(), padded = new ArrayBuffer(512 * 1024 * 1024);
	const words = new Uint16Array(padded, 64, 12); words.set([1, 1, 1, 65535, 2, 2, 2, 65535, 3, 3, 3, 65535]);
	const paddedPorts = withPorts(f, other.withStaging.bind(other));
	paddedPorts.withCanonicalFrame = (_index, consume) => Promise.resolve(consume({ descriptor: f.request.inputs[0]!.descriptor, pixels: words }));
	await assert.rejects(withMergedImageHdrOriginalCurrentV1(f.request, paddedPorts, () => assert.fail('padded physical source reached output')), /physical|phase|budget/iu);
	assert.equal(other.ranges.length, 0);
});

test('late source refusal and independent exact staging deletion failure both survive without an encoded result', async () => {
	const f = fixture(), native = hdrOpfsStagingFixture(), primary = Object.freeze({ source: 'late refusal' }), cleanup = Object.freeze({ disk: 'retained path' });
	native.hooks.remove = async () => { throw cleanup; };
	const staging: typeof withImageHdrPixelStagingV1 = (consume, options) => withImageHdrPixelStagingV1(consume, { ...options, backend: native.backend, acquireLease: native.acquireLease });
	const ports = withPorts(f, staging), read = ports.withCanonicalFrame;
	ports.withCanonicalFrame = async (index, consume, signal) => { await read(index, consume, signal); throw primary; };
	await assert.rejects(withMergedImageHdrOriginalCurrentV1(f.request, ports, () => assert.fail('refused source reached publication')), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.ok(Object.is(error.cause, primary));
		assert.ok(error.errors.some(value => Object.is(value, primary))); assert.ok(error.errors.some(value => Object.is(value, cleanup))); return true;
	});
	assert.equal(native.files.size, 1); assert.equal(native.leases.size, 0); assert.ok(native.closed);
});

test('pre-abort wins hostile request metadata, and unsupported source extent/profile refuses before canonical decoding', async () => {
	const f = fixture(), stage = stagedModel(), stop = new AbortController(), reason = Object.freeze({ cancelled: 'before metadata' }); stop.abort(reason); let reads = 0;
	const hostile = Object.defineProperty({ signal: stop.signal }, 'inputs', { enumerable: true, get() { reads++; throw new Error('input getter'); } });
	try { await withMergedImageHdrOriginalCurrentV1(hostile, withPorts(f, stage.withStaging.bind(stage)), () => assert.fail('pre-abort reached result')); assert.fail('pre-abort must reject'); }
	catch (error) { assert.ok(Object.is(error, reason)); } assert.equal(reads, 0); assert.equal(stage.closed, false);
	for (const descriptor of [{ ...f.request.inputs[0]!.descriptor, sampleFormat: 'float32' }, { ...f.request.inputs[0]!.descriptor, width: 8193 }, { ...f.request.inputs[0]!.descriptor, primaries: 'display-p3' }]) {
		await assert.rejects(withMergedImageHdrOriginalCurrentV1({ ...f.request, inputs: f.request.inputs.map(input => ({ ...input, descriptor })) },
			withPorts(f, stage.withStaging.bind(stage)), () => assert.fail('invalid metadata reached result')));
	}
	assert.equal(f.events.length, 0); assert.equal(stage.closed, false);
});

test('held encoded publication stays live until joined, then cancellation wipes bytes; detach preserves distinct opaque and physical failures', async () => {
	for (const mode of ['cancel', 'detach'] as const) {
		const f = fixture(), stage = stagedModel(), stop = new AbortController(), entered = deferred<void>(), release = deferred<void>(), reason = Proxy.revocable({}, {}); reason.revoke();
		let encoded: Uint8Array<ArrayBuffer> | undefined;
		const work = withMergedImageHdrOriginalCurrentV1({ ...f.request, signal: stop.signal }, withPorts(f, stage.withStaging.bind(stage)), async view => {
			encoded = view.bytes; entered.resolve(); await release.promise;
			if (mode === 'detach') { structuredClone(view.bytes.buffer, { transfer: [view.bytes.buffer] }); throw reason.proxy; }
		});
		const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		try { await entered.promise; assert.ok(encoded?.some(value => value !== 0)); if (mode === 'cancel') stop.abort(reason.proxy); assert.equal(await remainsPending(work), true); }
		finally { release.resolve(); }
		const outcome = await observed; assert.ok(!outcome.ok);
		if (mode === 'cancel') { assert.ok(Object.is(outcome.error, reason.proxy)); assert.ok(encoded?.every(value => value === 0)); }
		else {
			assert.ok(outcome.error instanceof AggregateError); assert.ok(Object.is(outcome.error.cause, reason.proxy));
			assert.equal(outcome.error.errors.filter((error: unknown) => Object.is(error, reason.proxy)).length, 1);
			assert.equal(outcome.error.errors.filter((error: unknown) => !Object.is(error, reason.proxy) && error instanceof TypeError).length, 1);
		}
	}
});
