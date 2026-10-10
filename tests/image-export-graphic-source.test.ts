/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateSync } from 'node:zlib';
import { withImageExportGraphicFrameV1 } from '../src/common/editor/imaging/image-export-graphic-source-v1.ts';
import type { PixelFrameV1 } from '../src/common/editor/imaging/pixel-frame-contract-v1.ts';
import type { FramescaperBrowserNativeImageDecodeSessionV1 as Session, OpenFramescaperBrowserNativeImageV1 as Open } from '../src/common/editor/timeline-image-native-decode-v1.ts';
import { createPhotoNativeImagePortV1 } from '../src/lightscaper/import/photo-native-image-port-v1.ts';
import { pngChunk, tiffFixture, numberEntry } from './helpers/image-metadata-fixtures.ts';
import { deferred, remainsPending, waitFor } from './helpers/async-test-control.ts';

// Independent PNG structure and literal oriented native-port pixels. Injected
// ports exercise custody, not native decoder fidelity or an imported asset pack.
const SOURCE = Uint8Array.of(201, 0, 0, 255, 0, 101, 0, 128, 77, 89, 99, 0);
const CANONICAL = [201, 0, 0, 255, 0, 101, 0, 128, 0, 0, 0, 0];
function png(orientation = 6, extra: readonly Uint8Array[] = [], header = Uint8Array.of(0, 0, 0, 3, 0, 0, 0, 1, 8, 6, 0, 0, 0)) {
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', header),
		pngChunk('sRGB', Uint8Array.of(0)), pngChunk('eXIf', tiffFixture([numberEntry(0x112, orientation)])), ...extra,
		pngChunk('IDAT', deflateSync(Uint8Array.of(0, ...SOURCE))), pngChunk('IEND', new Uint8Array())]));
}
const PNG = png(), body = () => new Blob([PNG], { type: 'text/plain' });
function native(events: string[], changes: Partial<Session> = {}): Session {
	const backing = new Uint8Array(20).fill(237); backing.set(SOURCE, 4);
	const owner: Session = { metadata: { width: 1, height: 3, frameCount: 1, topology: 'single', runtimeVersion: 'fixture-1' },
		async decodeFrame(index, signal) { assert.equal(this, owner); assert.equal(index, 0); signal?.throwIfAborted(); events.push('decode');
			return { rgba: backing.subarray(4, 16), durationMicroseconds: null }; },
		close() { assert.equal(this, owner); events.push('close'); }, ...changes };
	return owner;
}
function open(events: string[]): Open { return async request => { assert.equal(request.format, 'png'); assert.equal(request.mimeType, 'image/png');
	assert.deepEqual(request.bytes, PNG); events.push('open'); return native(events); }; }
function pixels(frame: Readonly<PixelFrameV1>) { return Array.from(frame.pixels); }

test('admission failure retains the opaque primary when native close also fails', async () => {
	const primary = Symbol('native abort'), cleanup = Symbol('native close'), stop = new AbortController(); stop.abort(primary);
	const session = native([], { close() { assert.equal(this, session); throw cleanup; } });
	const port = createPhotoNativeImagePortV1({ format: 'png', width: 3, height: 1 }, 6, async () => session, stop.signal);
	await assert.rejects(port({ bytes: PNG, format: 'png', mimeType: 'image/png', signal: stop.signal }), error => {
		assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
	});
});

test('graphic source closes native custody before consuming independent oriented canonical bytes', async () => {
	const events: string[] = [], original = body(), transport: { bytes: Uint8Array | null } = { bytes: null }; let retained: Readonly<PixelFrameV1> | null = null;
	const result = await withImageExportGraphicFrameV1({ body: original }, (frame, provenance) => {
		retained = frame; events.push('consume'); assert.deepEqual(events, ['open', 'decode', 'close', 'consume']);
		assert.deepEqual(frame.descriptor, { schemaVersion: 1, width: 1, height: 3, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
		assert.ok(Object.isFrozen(frame) && Object.isFrozen(provenance)); assert.deepEqual(provenance, { orientation: 6, runtimeVersion: 'fixture-1' });
		assert.deepEqual(pixels(frame), CANONICAL); return frame.pixels.slice();
	}, { openImage: request => { transport.bytes = request.bytes; return open(events)(request); } });
	assert.deepEqual([...result], CANONICAL); assert.ok(retained); assert.deepEqual(pixels(retained), new Array(12).fill(0));
	assert.ok(transport.bytes); assert.equal(transport.bytes.every(value => value === 0), true); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), PNG);
});

test('genuine File/Blob overrides never gain read or sizing authority', async () => {
	let invoked = 0;
	class Hostile extends File {
		override get size(): number { invoked++; throw new Error('size getter'); }
		override slice(): Blob { invoked++; throw new Error('slice override'); }
		override arrayBuffer(): Promise<ArrayBuffer> { invoked++; throw new Error('read override'); }
	}
	const file = new Hostile([PNG], 'Watermark.png');
	assert.deepEqual(await withImageExportGraphicFrameV1({ body: file }, pixels, { openImage: open([]) }), CANONICAL); assert.equal(invoked, 0);
});

test('invalid requests, signals, options and pre-aborted calls refuse before native work', async () => {
	const events: string[] = [], options = { openImage: open(events) }, controller = new AbortController(), reason = Symbol('pre-abort'); controller.abort(reason);
	for (const input of [{ body: {} }, { body: new Blob() }, { body: body(), signal: {} }, { body: body(), extra: true }])
		await assert.rejects(withImageExportGraphicFrameV1(input, pixels, options), /Blob|graphic|signal|empty/iu);
	await assert.rejects(withImageExportGraphicFrameV1({ body: body(), signal: controller.signal }, pixels, options), error => Object.is(error, reason));
	for (const maximumWorkingBytes of [0, 1.5, Infinity, 268_435_457])
		await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, pixels, { ...options, maximumWorkingBytes }), /working|ceiling/iu);
	await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, pixels, { openImage: undefined }), /port/iu);
	await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, pixels, { ...options, extra: true } as typeof options), /graphic/iu);
	assert.deepEqual(events, []);
});

test('encoded and two JS pixel planes share a captured capacity checked before native open', async () => {
	const events: string[] = [], exact = PNG.length + 24;
	await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, pixels, { openImage: open(events), maximumWorkingBytes: exact - 1 }), /working|capacity/iu);
	assert.deepEqual(events, []);
	assert.deepEqual(await withImageExportGraphicFrameV1({ body: body() }, pixels, { openImage: open(events), maximumWorkingBytes: exact }), CANONICAL);
});

test('animation, profiles, unsupported precision and oversized geometry refuse before native open', async () => {
	const events: string[] = [], options = { openImage: open(events) };
	for (const extra of [pngChunk('acTL', Uint8Array.of(0, 0, 0, 2, 0, 0, 0, 0)), pngChunk('iCCP', Uint8Array.of(0)),
		pngChunk('cICP', Uint8Array.of(9, 16, 0, 1))]) await assert.rejects(withImageExportGraphicFrameV1({ body: new Blob([png(6, [extra])]) }, pixels, options), RangeError);
	for (const header of [Uint8Array.of(0, 0, 0, 3, 0, 0, 0, 1, 16, 6, 0, 0, 0),
		Uint8Array.of(0, 0, 32, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0), Uint8Array.of(0, 0, 32, 0, 0, 0, 32, 0, 8, 6, 0, 0, 0)])
		await assert.rejects(withImageExportGraphicFrameV1({ body: new Blob([png(6, [], header)]) }, pixels, options), /precision|width|pixel/iu);
	await assert.rejects(withImageExportGraphicFrameV1({ body: new Blob([new Uint8Array(64 * 1024 * 1024 + 1)]) }, pixels, options), /byte|size/iu);
	assert.deepEqual(events, []);
});

test('unsafe native geometry/topology/accessors refuse and close before pixel or consumer work', async () => {
	for (const mode of ['geometry', 'animation', 'accessor'] as const) {
		const events: string[] = [], session = native(events); let invoked = 0;
		if (mode === 'geometry') Object.defineProperty(session.metadata, 'width', { value: 3 });
		else if (mode === 'animation') Object.defineProperty(session.metadata, 'frameCount', { value: 2 });
		else Object.defineProperty(session.metadata, 'width', { get() { invoked++; throw new Error('accessor'); } });
		await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, () => assert.fail('unsafe consumer'), { openImage: async () => session }), /geometry|dimensions|static|data|metadata/iu);
		assert.equal(invoked, 0); assert.deepEqual(events, ['close']);
	}
});

test('native transport mutation refuses without changing the selected immutable Blob', async () => {
	const events: string[] = [], original = body();
	await assert.rejects(withImageExportGraphicFrameV1({ body: original }, () => assert.fail('mutated transport consumer'), { openImage: async request => {
		request.bytes[0] = 0; return native(events);
	} }), /digest|changed/iu);
	assert.deepEqual(events, ['decode', 'close']); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), PNG);
});

test('held intrinsic read joins before cancelled storage can be released', async context => {
	const originalRead = Blob.prototype.arrayBuffer, release = deferred<void>(), entered = deferred<void>(), stop = new AbortController(), reason = Symbol('read cancellation');
	let owned: ArrayBuffer | null = null;
	context.mock.method(Blob.prototype, 'arrayBuffer', async function (this: Blob) {
		owned = await originalRead.call(this); entered.resolve(); await release.promise; return owned;
	});
	const events: string[] = [], pending = withImageExportGraphicFrameV1({ body: body(), signal: stop.signal }, pixels, { openImage: open(events) });
	await entered.promise; stop.abort(reason); assert.equal(await remainsPending(pending), true); assert.deepEqual(events, []); release.resolve();
	await assert.rejects(pending, error => Object.is(error, reason)); assert.ok(owned); assert.equal(new Uint8Array(owned).every(value => value === 0), true);
});

for (const stage of ['open', 'decode'] as const) test(`held native ${stage} joins cancellation before close and refuses consumer`, async () => {
	const events: string[] = [], release = deferred<void>(), stop = new AbortController(), reason = Symbol(`${stage} cancellation`);
	const session = native(events, stage === 'decode' ? { async decodeFrame() { events.push('decode'); await release.promise; return { rgba: SOURCE.slice(), durationMicroseconds: null }; } } : {});
	const pending = withImageExportGraphicFrameV1({ body: body(), signal: stop.signal }, () => assert.fail('cancelled consumer'), { openImage: async () => {
		events.push('open'); if (stage === 'open') await release.promise; return session;
	} });
	await waitFor(() => events.includes(stage), `native ${stage}`); stop.abort(reason); assert.equal(await remainsPending(pending), true);
	assert.equal(events.includes('close'), false); release.resolve(); await assert.rejects(pending, error => Object.is(error, reason));
	assert.equal(events.filter(event => event === 'close').length, 1);
});

test('a held consumer owns live copied pixels through cancellation then output is wiped', async () => {
	const events: string[] = [], release = deferred<void>(), stop = new AbortController(), reason = Symbol('consumer cancellation'); let retained: Readonly<PixelFrameV1> | null = null;
	const pending = withImageExportGraphicFrameV1({ body: body(), signal: stop.signal }, async frame => { retained = frame; events.push('consume'); await release.promise; }, { openImage: open(events) });
	await waitFor(() => events.includes('consume'), 'graphic consumer'); stop.abort(reason); assert.equal(await remainsPending(pending), true);
	assert.ok(retained); assert.deepEqual(pixels(retained), CANONICAL); assert.equal(events.filter(event => event === 'close').length, 1);
	release.resolve(); await assert.rejects(pending, error => Object.is(error, reason)); assert.deepEqual(pixels(retained), new Array(12).fill(0));
});

test('opaque consumer failure is preserved after joined native close and pixel wipe', async () => {
	const events: string[] = [], reason = Symbol('consumer rejection'); let retained: Readonly<PixelFrameV1> | null = null;
	await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, frame => { retained = frame; throw reason; }, { openImage: open(events) }), error => Object.is(error, reason));
	assert.deepEqual(events, ['open', 'decode', 'close']); assert.ok(retained); assert.deepEqual(pixels(retained), new Array(12).fill(0));
});

test('opaque decode plus close failure retain both reasons including thrown undefined', async () => {
	const events: string[] = [], cleanup = Symbol('cleanup'), input: { bytes: Uint8Array | null } = { bytes: null };
	await assert.rejects(withImageExportGraphicFrameV1({ body: body() }, () => assert.fail('failed decode consumer'), { openImage: async request => {
		input.bytes = request.bytes; return native(events, { async decodeFrame() { events.push('decode'); throw undefined; }, close() { events.push('close'); throw cleanup; } });
	} }), error => { assert.ok(error instanceof AggregateError); assert.equal(error.cause, undefined); assert.deepEqual(error.errors, [undefined, cleanup]); return true; });
	assert.deepEqual(events, ['decode', 'close']); assert.ok(input.bytes); assert.equal(input.bytes.every(value => value === 0), true);
});

test('genuine signals with own or subclass authority refuse without invoking getters or native work', async () => {
	const events: string[] = []; let invoked = 0;
	for (const key of ['aborted', 'reason', 'throwIfAborted', 'addEventListener', 'removeEventListener']) {
		const signal = new AbortController().signal;
		Object.defineProperty(signal, key, { get() { invoked++; throw new Error('signal accessor'); } });
		await assert.rejects(withImageExportGraphicFrameV1({ body: body(), signal }, pixels, { openImage: open(events) }), /unmodified native/iu);
	}
	const signal = new AbortController().signal;
	Object.setPrototypeOf(signal, Object.create(AbortSignal.prototype));
	await assert.rejects(withImageExportGraphicFrameV1({ body: body(), signal }, pixels, { openImage: open(events) }), /unmodified native/iu);
	assert.equal(invoked, 0); assert.deepEqual(events, []);
});

test('detached owned transport does not replace opaque native admission and close failures', async () => {
	const stop = new AbortController(), primary = Symbol('transport abort'), cleanup = Symbol('transport close'), events: string[] = [];
	const original = body();
	await assert.rejects(withImageExportGraphicFrameV1({ body: original, signal: stop.signal }, () => assert.fail('detached transport consumer'), {
		openImage: async request => {
			structuredClone(request.bytes.buffer, { transfer: [request.bytes.buffer] }); stop.abort(primary);
			return native(events, { close() { events.push('close'); throw cleanup; } });
		},
	}), error => { assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true; });
	assert.deepEqual(events, ['close']); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), PNG);
});

for (const mode of ['cancel', 'reject'] as const) test(`detached held consumer joins and preserves opaque ${mode} reason`, async () => {
	const release = deferred<void>(), entered = deferred<void>(), events: string[] = [], stop = new AbortController(), reason = Symbol(`consumer ${mode}`);
	const original = body();
	const pending = withImageExportGraphicFrameV1({ body: original, signal: stop.signal }, async frame => {
		structuredClone(frame.pixels.buffer, { transfer: [frame.pixels.buffer] }); entered.resolve(); await release.promise;
		if (mode === 'reject') throw reason;
	}, { openImage: open(events) });
	await entered.promise; if (mode === 'cancel') stop.abort(reason);
	try { assert.equal(await remainsPending(pending), true); assert.equal(events.filter(event => event === 'close').length, 1); }
	finally { release.resolve(); }
	await assert.rejects(pending, error => Object.is(error, reason)); assert.deepEqual(new Uint8Array(await original.arrayBuffer()), PNG);
});
