/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodePhotoDevelopPresetPackV1, readPhotoDevelopPresetPackV1, PHOTO_DEVELOP_PRESET_PACK_LIMITS_V1 as LIMITS } from '../src/lightscaper/archive/develop-preset-pack-v1.ts';
import { createImageDevelopPresetV1 } from '../src/common/editor/imaging/image-develop-preset-v1.ts';
import { copyImageDevelopSettingsV1 } from '../src/common/editor/imaging/image-develop-settings-v1.ts';
import { defaultImageDevelopStateV1 } from '../src/common/editor/imaging/image-develop-state-v1.ts';
import { normalizePhotoDevelopPresetRowV1 } from '../src/lightscaper/storage/photo-develop-presets-v1.ts';

const encoder = new TextEncoder();
function row(partial = false) {
	const preset = createImageDevelopPresetV1({ schemaVersion: 1, id: 'preset', name: 'Evening 界 📷',
		settings: copyImageDevelopSettingsV1({ schemaVersion: 1, develop: defaultImageDevelopStateV1(),
			selection: { effectTypes: partial ? ['tone-ladder-v1'] : 'all', geometry: !partial, localAdjustments: !partial } }) });
	return { schemaVersion: 1, kind: 'photo-develop-presets', catalogId: 'catalog', revision: 37, presets: [preset] };
}
async function* chunks(bytes: Uint8Array, width = 7) {
	for (let offset = 0; offset < bytes.byteLength; offset += width) yield bytes.slice(offset, offset + width);
}
async function collect(source: AsyncIterable<Uint8Array>) {
	const parts: Uint8Array[] = []; let length = 0;
	for await (const bytes of source) { assert.ok(bytes.byteLength <= LIMITS.maximumChunkBytes); parts.push(bytes); length += bytes.byteLength; }
	const result = new Uint8Array(length); let offset = 0;
	for (const bytes of parts) { result.set(bytes, offset); offset += bytes.byteLength; } return result;
}

test('Full and partial preset packs preserve process bytes, selection, digest, name and revision across UTF8 boundaries', async () => {
	for (const partial of [false, true]) {
		const expected = normalizePhotoDevelopPresetRowV1(row(partial), 'catalog');
		const encoded = await collect(encodePhotoDevelopPresetPackV1(expected, 'catalog'));
		assert.equal(new TextDecoder().decode(encoded), JSON.stringify(expected));
		const reopened = await readPhotoDevelopPresetPackV1(chunks(encoded, 1), 'catalog');
		assert.deepEqual(reopened, expected); assert.notEqual(reopened, expected);
		assert.ok(Object.isFrozen(reopened.presets[0]?.settings));
	}
});

test('An empty positive revision remains a real pack and does not become an absent preset store', async () => {
	const expected = { ...row(), revision: 91, presets: [] };
	assert.deepEqual(await readPhotoDevelopPresetPackV1(encodePhotoDevelopPresetPackV1(expected, 'catalog'), 'catalog'), expected);
});

test('Encoder admission detaches before a caller can mutate input across the first asynchronous yield', async () => {
	const input = { ...row(), presets: [structuredClone(row().presets[0]!)] }, expected = structuredClone(input);
	const encoded = encodePhotoDevelopPresetPackV1(input, 'catalog');
	Object.assign(input.presets[0]!.identity, { name: 'Later' }); input.revision = 99;
	assert.deepEqual(await readPhotoDevelopPresetPackV1(encoded, 'catalog'), expected);
	let inspected = 0;
	assert.throws(() => encodePhotoDevelopPresetPackV1(Object.defineProperty(row(), 'presets', {
		enumerable: true, get() { inspected++; throw new Error('Caller getter ran'); } }), 'catalog'));
	assert.equal(inspected, 0);
});

test('Malformed UTF8, trailing JSON, foreign rows, future processes and digest substitution refuse', async () => {
	const foreign = { ...row(), catalogId: 'foreign' }, future = structuredClone(row()), digest = structuredClone(row());
	Object.assign(future.presets[0]!.settings.develop, { processVersion: 2 });
	Object.assign(digest.presets[0]!.identity, { authoredStateSha256: '0'.repeat(64) });
	for (const bytes of [new Uint8Array([0xff]), encoder.encode(`${JSON.stringify(row())} null`),
		encoder.encode(JSON.stringify(foreign)), encoder.encode(JSON.stringify(future)), encoder.encode(JSON.stringify(digest))]) {
		await assert.rejects(readPhotoDevelopPresetPackV1(chunks(bytes), 'catalog'));
	}
});

test('Pack and emission ceilings refuse before JSON admission and join the borrowed iterator return', async () => {
	for (const oversizedEmission of [false, true]) {
		let borrowed = 0, returned = 0;
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { borrowed++;
			return { async next() { return { done: false, value: new Uint8Array(oversizedEmission ? LIMITS.maximumChunkBytes + 1 : LIMITS.maximumChunkBytes) }; },
				async return() { returned++; return { done: true, value: undefined }; } }; } };
		await assert.rejects(readPhotoDevelopPresetPackV1(source, 'catalog'), /byte|chunk|bound/iu);
		assert.equal(borrowed, 1); assert.equal(returned, 1);
	}
});

test('Native opaque cancellation joins held input and refuses publication without inspecting the reason', async () => {
	let release!: () => void; const held = new Promise<void>(resolve => { release = resolve; });
	let enter!: () => void; const entered = new Promise<void>(resolve => { enter = resolve; });
	let returned = 0, reflected = 0;
	const reason = new Proxy({}, { get() { reflected++; throw new Error('Opaque reason inspected'); } });
	const stop = new AbortController();
	const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
		async next() { enter(); await held; return { done: false, value: encoder.encode(JSON.stringify(row())) }; },
		async return() { returned++; return { done: true, value: undefined }; },
	}; } };
	const work = readPhotoDevelopPresetPackV1(source, 'catalog', { signal: stop.signal });
	let failure: unknown;
	// Capturing a rejection avoids Promise resolution probing the opaque value for then.
	const settled = work.catch((error: unknown) => { failure = error; });
	await entered; stop.abort(reason); release(); await settled; assert.equal(failure, reason);
	assert.equal(returned, 1); assert.equal(reflected, 0);
	let borrowed = false;
	await assert.rejects(readPhotoDevelopPresetPackV1({ [Symbol.asyncIterator]() { borrowed = true; throw new Error('Borrowed'); } }, 'catalog', { signal: AbortSignal.abort() }));
	assert.equal(borrowed, false);
});

test('Borrowed intrinsic chunks are decoded before another await and nonintrinsic buffers refuse', async () => {
	const bytes = encoder.encode(JSON.stringify(row()));
	async function* reused() { yield bytes; bytes.fill(0); }
	assert.deepEqual(await readPhotoDevelopPresetPackV1(reused(), 'catalog'), row());
	const resizable = Reflect.construct(ArrayBuffer, [5, { maxByteLength: 10 }]) as ArrayBuffer;
	for (const value of [new Uint8Array(new SharedArrayBuffer(5)), new Uint8Array(resizable)]) {
		async function* intrinsicRefusal() { yield value; }
		await assert.rejects(readPhotoDevelopPresetPackV1(intrinsicRefusal(), 'catalog'));
	}
});

test('Native AbortError and observed opaque cancellation retain classification beside a distinct source cleanup failure', async () => {
	for (const opaque of [false, true]) {
		let inspected = 0; const stop = new AbortController(), cleanup = { retirement: 'failed' };
		const primary = opaque ? new Proxy({}, { get() { inspected++; throw new Error('Opaque get'); },
			getPrototypeOf() { inspected++; throw new Error('Opaque prototype'); } }) : new DOMException('Source cancelled', 'AbortError');
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() { return {
			async next() { if (opaque) stop.abort(primary); throw primary; }, async return() { throw cleanup; },
		}; } };
		let failure: unknown;
		await readPhotoDevelopPresetPackV1(source, 'catalog', { signal: stop.signal }).catch((error: unknown) => { failure = error; });
		assert.ok(failure instanceof AggregateError); assert.equal(failure.name, 'AbortError');
		assert.deepEqual(failure.errors, [primary, cleanup]); assert.equal(inspected, 0);
	}
});
