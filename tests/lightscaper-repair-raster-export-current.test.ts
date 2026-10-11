/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { PhotoRasterExportCurrentV1 as PhotoRasterExport } from '../src/lightscaper/controller/photo-raster-export-current-v1.ts';
import { createFileSystemPreparedSave } from '../src/common/editor/file-save-stream.ts';
import { createVideoEffect } from '../src/common/editor/video-effects.js';
import { gradientGraph } from './helpers/lightscaper-masked-frame-fixture.ts';
import { remainsPending } from './helpers/async-test-control.ts';
import { repairRasterFixture, repairRecipe, decodePng, heldNativeWrite, type RepairRasterRequest } from './helpers/lightscaper-repair-raster-export-current-fixture.ts';

// Initial RED reached the strict2 owner with these same honest capabilities.
// Qualification now uses the explicit named Current owner.
function start(owner: PhotoRasterExport, request: RepairRasterRequest) {
	return Reflect.apply(owner.start, owner, [request]) as ReturnType<PhotoRasterExport['start']>;
}

test('Current PNG exports actual authenticated Clone pixels and preserves native original/catalog custody', async () => {
	const f = await repairRasterFixture(), before = await f.inspect(), owner = new PhotoRasterExport('png');
	try {
		const work = start(owner, f.request()); assert.deepEqual(f.events, ['picker']); const receipt = await work;
		assert.equal(receipt.status, 'download-started');
		assert.deepEqual([receipt.width, receipt.height], [3, 1]);
		assert.deepEqual([...decodePng(f.outputs[0]!.bytes).pixels], [255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]);
		assert.ok(f.events.indexOf('download') > f.events.indexOf('original-settled'));
		assert.equal(f.codecs.calls.opens, 1); assert.equal(f.codecs.calls.closes, 1);
		assert.ok(f.borrowed.every(bytes => bytes.every(value => value === 0))); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
		assert.deepEqual(await f.inspect(), before); assert.deepEqual(before[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current PNG Heal uses authenticated original context and source movement changes independent literal solutions', async () => {
	const pixels: number[] = [];
	for (let y = 0; y < 3; y++) for (let x = 0; x < 11; x++) { const gray = x < 3 ? 32 : x >= 4 && x < 7 ? 64 : x >= 8 ? 128 : 0; pixels.push(gray, gray, gray, 255); }
	pixels.splice(12 * 4, 4, 64, 64, 64, 255); pixels.splice(16 * 4, 4, 192, 192, 192, 255); pixels.splice(20 * 4, 4, 0, 0, 0, 255);
	for (const [sourceX, expected] of [[1.5 / 11, 138], [5.5 / 11, 217]] as const) {
		const base = repairRecipe(11), recipe = { ...base, repairs: { schemaVersion: 1, spots: [{ ...base.repairs.spots[0]!, mode: 'heal', radius: 0.2,
			target: { x: 9.5 / 11, y: 0.5 }, source: { x: sourceX, y: 0.5 } }] } };
		const f = await repairRasterFixture(recipe, pixels, 1, 3), owner = new PhotoRasterExport('png');
		try { await start(owner, f.request()); const literal = [...pixels]; literal.splice(20 * 4, 4, expected, expected, expected, 255);
			assert.deepEqual([...decodePng(f.outputs[0]!.bytes).pixels], literal); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
		} finally { await owner.cancelAndJoin(); await f.close(); }
	}
});

test('Current export applies Clone before actual crop, masked linear-light color and suffix flip while preserving alpha', async () => {
	const pixels = [255, 255, 255, 255, 0, 0, 0, 128, 0, 0, 0, 255, 0, 0, 0, 255], base = repairRecipe(4);
	const recipe = { ...base, effects: [createVideoEffect('develop-geometry-v1', { id: 'crop', params: { cropWidth: 0.5 } }),
		createVideoEffect('point-curves-v1', { id: 'invert', params: { master: [{ x: 0, y: 1 }, { x: 1, y: 0 }] } }),
		createVideoEffect('develop-geometry-v1', { id: 'flip', params: { flipHorizontal: 1 } })], masks: [gradientGraph()], maskBindings: [{ effectId: 'invert', maskId: 'mask' }] };
	const f = await repairRasterFixture(recipe, pixels), owner = new PhotoRasterExport('png');
	try { const receipt = await start(owner, f.request()); assert.ok(receipt.status !== 'cancelled'); assert.deepEqual([receipt.width, receipt.height], [2, 1]);
		assert.deepEqual([...decodePng(f.outputs[0]!.bytes).pixels], [137, 137, 137, 128, 224, 224, 224, 255]);
		assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current JPEG adapter gives the real native encoder wrapper literal repaired pixels without claiming Node native codec bytes', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExport('jpeg');
	try { const receipt = await start(owner, f.request('jpeg')); assert.ok(receipt.status !== 'cancelled'); assert.equal(receipt.fileName, 'Photo-1.jpg');
		assert.deepEqual(f.codecs.encodedInputs, [[255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 0, 255]]);
		assert.equal(f.outputs[0]!.mimeType, 'image/jpeg'); assert.deepEqual([...f.outputs[0]!.bytes.subarray(0, 2)], [255, 216]);
		assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0))); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current paired export retains native raster ACK and retries only exact Sidecar2 JSON without another picker, Original or render', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExport('png'), request = f.request(), save = request.saveFile, failure = Symbol('JSON refusal'); let json = 0;
	try {
		const receipt = await start(owner, { ...request, sidecar: { read: f.readSidecar }, saveFile: async value => {
			if (value.mimeType === 'application/json' && ++json === 1) throw failure; return save(value);
		} });
		assert.ok(receipt.status !== 'cancelled'); assert.equal(receipt.sidecar?.status, 'failed');
		assert.ok(receipt.sidecar && 'cause' in receipt.sidecar); assert.equal(receipt.sidecar.cause, failure);
		const before = [...f.events], retried = await owner.retrySidecar(); assert.ok(retried.status !== 'cancelled'); assert.equal(retried.sidecar?.status, 'download-started');
		assert.deepEqual(f.events.filter(value => value !== 'download'), before.filter(value => value !== 'download'));
		const sidecar = JSON.parse(new TextDecoder().decode(f.outputs[1]!.bytes)) as { schemaVersion: number; photoSchemaVersion: number; version: { develop: unknown } };
		assert.equal(sidecar.schemaVersion, 2); assert.equal(sidecar.photoSchemaVersion, 3); assert.deepEqual(sidecar.version.develop, f.photos[0]!.versions[0]!.develop);
		assert.equal(f.outputs[1]!.name, 'Photo-1.png.lightscaper.json');
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current final revision drift refuses destination commit after real encoding and leaves the Original unchanged', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExport('png'), request = f.request(), encode = request.encode, target = heldNativeWrite(); let retirements = 0;
	target.write.resolve(); target.closing.resolve();
	try {
		await assert.rejects(start(owner, { ...request, prepareSave: value => {
			const prepared = createFileSystemPreparedSave({ target: target.target, fileName: 'Photo-1.png', signal: value.signal });
			return { ...prepared, abort: (reason?: unknown) => { retirements++; return Reflect.apply(prepared.abort, prepared, [reason]) as Promise<void>; } };
		},
			encode: async (frame, options) => { const bytes = await encode(frame, options); await f.session.applyMetadata(f.photos[0]!.id, f.photos[0]!.revision, { title: 'Changed during export' }); return bytes; } }));
		assert.equal(retirements, 1); assert.deepEqual(target.events, []);
		assert.equal(f.encoded.length, 1); assert.ok(f.encoded.every(bytes => bytes.every(value => value === 0)));
		const observed = await f.inspect(); assert.equal(observed[0]!.photo.metadata.title, 'Changed during export'); assert.deepEqual(observed[0]!.bytes, f.bytes);
	} finally { await owner.cancelAndJoin(); await f.close(); }
});

test('Current cancellation joins held native write, keeps encoded custody live and preserves a revoked opaque primary', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExport('png'), target = heldNativeWrite(), primary = Proxy.revocable({}, {}); primary.revoke();
	const work = start(owner, { ...f.request(), prepareSave: value => createFileSystemPreparedSave({ target: target.target, fileName: 'Photo-1.png', signal: value.signal }) });
	const outcome = work.then(value => ({ value }), (error: unknown) => ({ error }));
	try {
		await Promise.race([target.entered.promise, work.then(() => assert.fail('Write never entered'))]);
		const close = owner.cancelAndJoin(primary.proxy); assert.equal(await remainsPending(close), true); assert.ok(f.encoded[0]!.some(value => value !== 0));
		target.write.resolve(); await close; const observed = await outcome; assert.ok('error' in observed); assert.equal(observed.error, primary.proxy);
		assert.equal(target.events.includes('close'), false); assert.ok(f.encoded[0]!.every(value => value === 0));
	} finally { target.write.resolve(); target.closing.resolve(); await outcome; await owner.cancelAndJoin(); await f.close(); }
});

test('Current irreversible native Close ACK survives cancellation during the authentic destination close', async () => {
	const f = await repairRasterFixture(), owner = new PhotoRasterExport('png'), target = heldNativeWrite(); target.write.resolve();
	const work = start(owner, { ...f.request(), prepareSave: value => createFileSystemPreparedSave({ target: target.target, fileName: 'Photo-1.png', signal: value.signal }) });
	void work.catch(() => undefined);
	try { await Promise.race([target.closed.promise, work.then(() => assert.fail('Native Close never entered'))]);
		const close = owner.cancelAndJoin(Symbol('late cancellation')); assert.equal(await remainsPending(close), true); target.closing.resolve();
		const result = await work; await close; assert.equal(result.status, 'saved'); assert.equal(target.events.includes('abort'), false);
		assert.ok(f.encoded[0]!.every(value => value === 0)); assert.deepEqual((await f.inspect())[0]!.bytes, f.bytes);
	} finally { target.closing.resolve(); await work.catch(() => undefined); await owner.cancelAndJoin(); await f.close(); }
});
