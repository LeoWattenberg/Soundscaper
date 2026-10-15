/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { encodeImageHdrOriginalV1, readImageHdrOriginalV1, withDecodedImageHdrOriginalV1 } from '../src/common/editor/imaging/image-hdr-original-v1.ts';
import { normalizeImageHdrOriginalProvenanceV1, IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, IMAGE_HDR_ORIGINAL_FORMAT_V1,
	IMAGE_HDR_ORIGINAL_SUFFIX_V1 } from '../src/common/editor/imaging/image-hdr-original-contract-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const descriptor = Object.freeze({ schemaVersion: 1 as const, width: 2, height: 1, sampleFormat: 'float32' as const, primaries: 'srgb' as const, transfer: 'linear' as const });
const values = [3, .5, -.25, 1, 1e-30, -0, 1 / 65535, 1] as const;
const frame = () => ({ descriptor, pixels: new Float32Array(values) });
function provenance() {
	return { schemaVersion: 1, operation: 'hdr-merge-v1', referenceIndex: 0, alignment: 'none', deghost: { mode: 'off', threshold: .15 },
		inputs: [0, 1].map(index => ({ product: index === 0 ? 'lightscaper' : 'framescaper', ownerId: `owner-${index}`, sourceId: `source-${index}`,
			revision: index === 0 ? 7 : null, original: { fileName: `Bracket ${index}.dng`, mimeType: 'image/x-adobe-dng', sha256: String(index + 1).repeat(64),
				byteLength: 2048, width: 2, height: 1 }, profile: 'linear-srgb16', exposureMultiplier: index === 0 ? 1 : .25,
			offset: { x: 0, y: 0 }, alignmentError: 0, alignmentSupport: 2 })), output: { x: 0, y: 0, width: 2, height: 1 } };
}
/** Independent wire fixture: no production encoder, parser or JSON utility. */
function canonical(value: unknown): string {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(Reflect.get(value, key))}`).join(',')}}`;
}
function literalBody(metadata: unknown = provenance(), input: readonly number[] = values, text = canonical(metadata)) {
	const json = new TextEncoder().encode(text), payloadOffset = Math.ceil((64 + json.length) / 4) * 4;
	const bytes = new Uint8Array(payloadOffset + input.length / 4 * 12), view = new DataView(bytes.buffer);
	bytes.set(new TextEncoder().encode('LSCHDRF1')); view.setUint32(8, 64, true); view.setUint32(12, 1, true);
	view.setUint32(16, 2, true); view.setUint32(20, 1, true); view.setUint32(24, json.length, true); view.setUint32(28, 24, true);
	bytes.set(createHash('sha256').update(json).digest(), 32); bytes.set(json, 64);
	for (let pixel = 0; pixel < input.length / 4; pixel++) for (let channel = 0; channel < 3; channel++) view.setFloat32(payloadOffset + (pixel * 3 + channel) * 4, input[pixel * 4 + channel]!, true);
	return { bytes, json, payloadOffset };
}
function bits(input: Float32Array) {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	return Array.from({ length: input.length }, (_, index) => view.getUint32(index * 4, true));
}

test('HDR Original encoder matches an independent fixed header, canonical provenance and exact RGBFloat32LE body', async () => {
	assert.equal(IMAGE_HDR_ORIGINAL_MIME_TYPE_V1, 'image/x-lightscaper-hdr'); assert.equal(IMAGE_HDR_ORIGINAL_FORMAT_V1, 'lightscaper-hdr'); assert.equal(IMAGE_HDR_ORIGINAL_SUFFIX_V1, '.lshdr');
	const source = frame(), before = bits(source.pixels), literal = literalBody(), body = await encodeImageHdrOriginalV1(source, provenance());
	assert.deepEqual(body, literal.bytes); assert.deepEqual(bits(source.pixels), before);
	const parsed = readImageHdrOriginalV1(body);
	assert.deepEqual(parsed.descriptor, descriptor); assert.deepEqual(parsed.provenance, provenance()); assert.equal(parsed.payloadOffset, literal.payloadOffset);
	assert.equal(parsed.pixelsSha256, digest(body.subarray(literal.payloadOffset))); assert.equal(parsed.metadataSha256, digest(literal.json));
	assert.ok(Object.isFrozen(parsed)); assert.ok(Object.isFrozen(parsed.provenance.inputs)); assert.ok(Object.isFrozen(parsed.provenance.inputs[0]!.original));
});

test('independent native body decodes signed HDR, tiny, negative-zero and nonword-grid samples exactly and wipes its owned RGBA plane', async () => {
	const literal = literalBody(), before = literal.bytes.slice(); let exposed: Float32Array<ArrayBuffer> | undefined;
	await withDecodedImageHdrOriginalV1({ bytes: literal.bytes }, view => {
		exposed = view.frame.pixels; assert.deepEqual(view.frame.descriptor, descriptor); assert.deepEqual(bits(view.frame.pixels), bits(frame().pixels));
		assert.equal(Object.is(view.frame.pixels[5], -0), true); assert.ok(view.frame.pixels[0]! > 1);
		assert.equal(view.pixelsSha256, digest(literal.bytes.subarray(literal.payloadOffset))); assert.deepEqual(view.provenance, provenance());
	});
	assert.ok(exposed); assert.ok(new Uint8Array(exposed.buffer).every(byte => byte === 0)); assert.deepEqual(literal.bytes, before);
});

test('encoded source borrow ends before decoded consumer: callers may wipe and transfer its backing while holding native floats', async () => {
	const literal = literalBody(), entered = deferred<void>(), release = deferred<void>(); let exposed: Float32Array<ArrayBuffer> | undefined;
	const work = withDecodedImageHdrOriginalV1({ bytes: literal.bytes }, async view => {
		exposed = view.frame.pixels; literal.bytes.fill(0); structuredClone(literal.bytes.buffer, { transfer: [literal.bytes.buffer] });
		entered.resolve(); await release.promise; assert.deepEqual(bits(view.frame.pixels), bits(frame().pixels)); return view.pixelsSha256;
	});
	try { await entered.promise; assert.equal(await remainsPending(work), true); release.resolve(); assert.equal(typeof await work, 'string');
		assert.ok(exposed); assert.ok(new Uint8Array(exposed.buffer).every(byte => byte === 0));
	} finally { release.resolve(); await work.catch(() => undefined); }
});

test('HDR provenance owns closed, frozen, detached facts and refuses unknown fields, nonfinite values and negative-zero scalars', () => {
	const raw = provenance(), captured = normalizeImageHdrOriginalProvenanceV1(raw); raw.inputs[0]!.original.fileName = 'Changed';
	assert.equal(captured.inputs[0]!.original.fileName, 'Bracket 0.dng'); assert.ok(Object.isFrozen(captured.deghost));
	for (const patch of [{ schemaVersion: 2 }, { operation: 'tone-map' }, { referenceIndex: 2 }, { referenceIndex: -0 }, { alignment: 'auto' }, { extra: true },
		{ deghost: { mode: 'reference-v1', threshold: NaN } }, { deghost: { mode: 'off', threshold: -0 } }, { output: { x: 0, y: 0, width: 1, height: 1 } }])
		assert.throws(() => normalizeImageHdrOriginalProvenanceV1({ ...provenance(), ...patch }));
	for (const patch of [{ exposureMultiplier: 0 }, { exposureMultiplier: Infinity }, { exposureMultiplier: 65537 }, { exposureMultiplier: 1 / 65537 },
		{ revision: -0 }, { offset: { x: 129, y: 0 } }, { alignmentError: 1.01 }, { alignmentSupport: 3 }, { profile: 'float-recovery' },
		{ original: { ...provenance().inputs[0]!.original, byteLength: 64 * 1024 * 1024 + 1 } }]) {
		const changed = provenance(); Object.assign(changed.inputs[0]!, patch); assert.throws(() => normalizeImageHdrOriginalProvenanceV1(changed));
	}
	assert.throws(() => normalizeImageHdrOriginalProvenanceV1({ ...provenance(), inputs: [provenance().inputs[0]] }));
	assert.throws(() => normalizeImageHdrOriginalProvenanceV1({ ...provenance(), inputs: Array.from({ length: 10 }, () => provenance().inputs[0]) }));
	let reads = 0; const hostile = Object.defineProperty(provenance(), 'referenceIndex', { enumerable: true, get() { reads++; return 0; } });
	assert.throws(() => normalizeImageHdrOriginalProvenanceV1(hostile), /data/u); assert.equal(reads, 0);
});

test('HDR body parser refuses header, metadata hash, canonical JSON, extent, padding, payload and trailing-byte corruption', () => {
	const literal = literalBody(); assert.deepEqual(readImageHdrOriginalV1(literal.bytes).provenance, provenance());
	for (const position of [0, 8, 12, 16, 20, 24, 28, 32, 64]) { const bad = literal.bytes.slice(); bad[position] = bad[position]! ^ 1; assert.throws(() => readImageHdrOriginalV1(bad)); }
	assert.throws(() => readImageHdrOriginalV1(literal.bytes.subarray(0, -1)));
	assert.throws(() => readImageHdrOriginalV1(new Uint8Array([...literal.bytes, 0])));
	assert.throws(() => readImageHdrOriginalV1(literalBody(provenance(), values, JSON.stringify(provenance())).bytes), /canonical/u);
	const wrong = provenance(); wrong.output.width = 1; assert.throws(() => readImageHdrOriginalV1(literalBody(wrong).bytes));
	for (const value of [NaN, Infinity, -Infinity]) { const bad = literal.bytes.slice(); new DataView(bad.buffer).setFloat32(literal.payloadOffset, value, true); assert.throws(() => readImageHdrOriginalV1(bad), /finite/u); }
	const padded = Array.from({ length: 4 }, (_, index) => { const metadata = provenance(); metadata.inputs[0]!.original.fileName += 'x'.repeat(index); return literalBody(metadata); })
		.find(value => value.payloadOffset > 64 + value.json.length); assert.ok(padded);
	padded.bytes[64 + padded.json.length] = 1; assert.throws(() => readImageHdrOriginalV1(padded.bytes), /padding/u);
});

test('HDR encoder refuses alpha loss and metadata/geometry/profile violations before touching inaccessible pixels', async () => {
	const source = frame(); source.pixels[3] = .5; await assert.rejects(encodeImageHdrOriginalV1(source, provenance()), /alpha|opaque/u);
	for (const patch of [{ width: 8193 }, { width: 8192, height: 8192 }, { sampleFormat: 'unorm16' }, { transfer: 'srgb' }, { primaries: 'display-p3' }]) {
		let reads = 0; const hostile = { descriptor: { ...descriptor, ...patch }, get pixels(): never { reads++; return assert.fail('metadata refusal must precede pixel access'); } };
		await assert.rejects(encodeImageHdrOriginalV1(hostile, provenance())); assert.equal(reads, 0);
	}
});

test('HDR native codec captures source and provenance before its first yield and preserves caller buffers', async () => {
	const source = frame(), raw = provenance(), expected = literalBody().bytes;
	const work = encodeImageHdrOriginalV1(source, raw); source.pixels.fill(99); raw.inputs[0]!.original.fileName = 'Changed';
	assert.deepEqual(await work, expected); assert.ok(source.pixels.every(value => value === 99));
	const literal = literalBody(), decoding = withDecodedImageHdrOriginalV1({ bytes: literal.bytes }, view => { assert.deepEqual(bits(view.frame.pixels), bits(frame().pixels)); });
	literal.bytes.fill(99); await decoding;
});

test('HDR pre-abort preserves an opaque reason before hostile source reflection and decoded cancellation joins consumer retirement', async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); const stop = new AbortController(); stop.abort(opaque.proxy);
	const hostile = new Proxy({}, { getOwnPropertyDescriptor() { assert.fail('pre-abort must precede source reflection'); } });
	for (const work of [encodeImageHdrOriginalV1(hostile, provenance(), { signal: stop.signal }), withDecodedImageHdrOriginalV1({ bytes: hostile, signal: stop.signal }, () => undefined)]) {
		const outcome = await work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
		assert.equal(outcome.ok, false); if (!outcome.ok) assert.ok(Object.is(outcome.error, opaque.proxy));
	}
	const current = new AbortController(), entered = deferred<void>(), release = deferred<void>(); let backing: ArrayBuffer | undefined;
	const work = withDecodedImageHdrOriginalV1({ bytes: literalBody().bytes, signal: current.signal }, async view => { backing = view.frame.pixels.buffer; entered.resolve(); await release.promise; });
	const observed = work.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	try { await entered.promise; current.abort(opaque.proxy); assert.equal(await remainsPending(work), true); release.resolve();
		const outcome = await observed; assert.equal(outcome.ok, false); if (!outcome.ok) assert.ok(Object.is(outcome.error, opaque.proxy));
		assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	} finally { release.resolve(); await observed; }
});

test('HDR consumer failure preserves its exact opaque primary and independently reports physical decoded-plane retirement failure', async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke(); let backing: ArrayBuffer | undefined;
	const one = withDecodedImageHdrOriginalV1({ bytes: literalBody().bytes }, view => { backing = view.frame.pixels.buffer; throw opaque.proxy; });
	const first = await one.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(first.ok, false); if (!first.ok) assert.ok(Object.is(first.error, opaque.proxy)); assert.ok(backing); assert.ok(new Uint8Array(backing).every(byte => byte === 0));
	const both = withDecodedImageHdrOriginalV1({ bytes: literalBody().bytes }, view => { structuredClone(view.frame.pixels.buffer, { transfer: [view.frame.pixels.buffer] }); throw opaque.proxy; });
	const second = await both.then(() => ({ ok: true as const }), (error: unknown) => ({ ok: false as const, error }));
	assert.equal(second.ok, false); if (second.ok) assert.fail('Detached native output must refuse.');
	assert.ok(second.error instanceof AggregateError); assert.ok(Object.is(second.error.cause, opaque.proxy)); assert.ok(Object.is(second.error.errors[0], opaque.proxy));
	assert.equal(second.error.errors.filter((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof TypeError).length, 1);
});

test('held HDR consumers cannot change authenticated RGB/alpha; integrity failure joins wipe and remains distinct from opaque primary', async () => {
	const opaque = Proxy.revocable({}, {}); opaque.revoke();
	const attempt = async (fail: boolean) => {
		const entered = deferred<void>(), release = deferred<void>(); let exposed: Float32Array<ArrayBuffer> | undefined;
		const work = withDecodedImageHdrOriginalV1({ bytes: literalBody().bytes }, async view => {
			exposed = view.frame.pixels; entered.resolve(); await release.promise;
			if (fail) throw opaque.proxy; return 'completed';
		});
		const observed = work.then(value => ({ ok: true as const, value }), (error: unknown) => ({ ok: false as const, error }));
		try {
			await entered.promise; assert.equal(await remainsPending(work), true); assert.ok(exposed);
			exposed[0] = 4; exposed[3] = .5; release.resolve();
			const outcome = await observed; assert.ok(new Uint8Array(exposed.buffer).every(byte => byte === 0)); return outcome;
		} finally { release.resolve(); await observed; }
	};
	const returned = await attempt(false), rejected = await attempt(true);
	assert.equal(returned.ok, false, 'A changed immutable HDR borrow must refuse after a successful held consumer.');
	if (!returned.ok) assert.match(String(returned.error), /changed|integrity|modified|alpha/iu);
	assert.equal(rejected.ok, false); if (rejected.ok) assert.fail('Changed rejected borrow must preserve both failures.');
	assert.ok(rejected.error instanceof AggregateError); assert.ok(Object.is(rejected.error.cause, opaque.proxy));
	assert.ok(Object.is(rejected.error.errors[0], opaque.proxy));
	assert.equal(rejected.error.errors.filter((error: unknown) => !Object.is(error, opaque.proxy) && error instanceof Error).length, 1);
});
