/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { planPhotoPreviewV1, normalizePhotoPreviewPlanV1 } from '../src/lightscaper/preview/photo-preview-plan-v1.ts';
import { preparePhotoPreviewV1 } from '../src/lightscaper/preview/photo-preview-preparation-v1.ts';

const binding = (width = 2, height = 3) => ({ catalogId: 'catalog', photoId: 'photo', originalId: 'original', storageKey: 'photo-original', contentSha256: 'a'.repeat(64), byteLength: 123, width, height });
const descriptor = (width = 2, height = 3) => ({ schemaVersion: 1, width, height, sampleFormat: 'unorm8', primaries: 'srgb', transfer: 'srgb' });
const frame = () => ({ descriptor: descriptor(), pixels: Uint8Array.from([1, 11, 21, 31, 2, 12, 22, 32, 3, 13, 23, 33, 4, 14, 24, 34, 5, 15, 25, 35, 6, 16, 26, 36]) });
const plan = () => planPhotoPreviewV1({ binding: binding(), source: descriptor(), tier: 'thumbnail' });

test('preview plans enforce fixed tier budgets, rounded fit geometry and no upscaling', () => {
	const thumbnail = planPhotoPreviewV1({ binding: binding(8192, 2048), source: descriptor(8192, 2048), tier: 'thumbnail' });
	assert.equal(thumbnail.output.width, 512); assert.equal(thumbnail.output.height, 128); assert.equal(thumbnail.byteLength, 262_144);
	const fit = planPhotoPreviewV1({ binding: binding(4096, 4096), source: descriptor(4096, 4096), tier: 'fit-screen' });
	assert.equal(fit.output.width, 2048); assert.equal(fit.output.height, 2048); assert.equal(fit.byteLength, 16_777_216);
	assert.deepEqual(plan().output, descriptor()); assert.equal(plan().byteLength, 24);
	assert.throws(() => planPhotoPreviewV1({ binding: binding(8192, 8192), source: descriptor(8192, 8192), tier: 'thumbnail' }), RangeError);
	assert.throws(() => planPhotoPreviewV1({ binding: binding(), source: { ...descriptor(), transfer: 'linear' }, tier: 'thumbnail' }), RangeError);
	assert.throws(() => planPhotoPreviewV1({ binding: binding(), source: { ...descriptor(), sampleFormat: 'unorm16' }, tier: 'thumbnail' }), RangeError);
});

test('persisted plan normalization accepts JSON goldens and rejects changed recipe, output, identity and future versions', () => {
	const current = plan(); assert.deepEqual(normalizePhotoPreviewPlanV1(JSON.parse(JSON.stringify(current))), current);
	for (const changed of [ { ...current, schemaVersion: 2 }, { ...current, kind: 'photo' }, { ...current, key: 'b'.repeat(64) }, { ...current, recipe: { ...current.recipe, version: 2 } }, { ...current, output: descriptor(1, 1) }, { ...current, byteLength: 1 }, { ...current, extra: true } ]) assert.throws(() => normalizePhotoPreviewPlanV1(changed));
	assert.equal(Object.isFrozen(current), true); assert.equal(Object.isFrozen(current.binding), true); assert.equal(Object.isFrozen(current.source), true); assert.equal(Object.isFrozen(current.output), true);
	assert.notEqual(planPhotoPreviewV1({ binding: { ...binding(), contentSha256: 'b'.repeat(64) }, source: descriptor(), tier: 'thumbnail' }).key, current.key);
	assert.notEqual(planPhotoPreviewV1({ binding: binding(), source: descriptor(), tier: 'fit-screen' }).key, current.key);
});

test('strict plan and original bindings refuse before hostile source fields are traversed', async () => {
	let invoked = 0; const hostile = Object.defineProperty({}, 'pixels', { get() { invoked += 1; throw new Error('pixels ran'); } });
	await assert.rejects(preparePhotoPreviewV1({ plan: plan(), binding: { ...binding(), storageKey: 'other' }, frame: hostile }), /binding/u);
	const source = Object.defineProperty({}, 'width', { get() { invoked += 1; throw new Error('geometry ran'); } });
	assert.throws(() => planPhotoPreviewV1({ binding: binding(), source, tier: 'thumbnail' }), TypeError);
	await assert.rejects(preparePhotoPreviewV1({ plan: { ...plan(), schemaVersion: 2 }, binding: binding(), frame: hostile }));
	assert.equal(invoked, 0);
});

test('prepared bodies contain exactly golden RGBA and an independent output digest, with no original bytes', async () => {
	const source = frame(), before = source.pixels.slice();
	const prepared = await preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: source });
	const output = new Uint8Array(await prepared.body.arrayBuffer());
	assert.deepEqual(output, before); assert.equal(output.length, 24); assert.equal(prepared.body.size, prepared.byteLength);
	assert.equal(prepared.outputSha256, createHash('sha256').update(output).digest('hex'));
	assert.equal(prepared.binding.byteLength, 123); assert.equal(prepared.body.size < prepared.binding.byteLength, true);
	assert.deepEqual(source.pixels, before); source.pixels.fill(0);
	assert.deepEqual(new Uint8Array(await prepared.body.arrayBuffer()), before, 'published immutable body is independent of caller pixels');
	assert.deepEqual(prepared.descriptor, descriptor()); assert.equal(Object.hasOwn(prepared, 'original'), false);
});

test('a rectangular thumbnail evaluates its complete independent nearest-sample golden', async () => {
	const source = new Uint8Array(1024 * 2 * 4);
	for (let y = 0; y < 2; y += 1) for (let x = 0; x < 1024; x += 1) source.set([x % 251, y + 17, x % 113, 255], (y * 1024 + x) * 4);
	const original = binding(1024, 2), preview = planPhotoPreviewV1({ binding: original, source: descriptor(1024, 2), tier: 'thumbnail' });
	const prepared = await preparePhotoPreviewV1({ plan: preview, binding: original, frame: { descriptor: descriptor(1024, 2), pixels: source } });
	const expected = new Uint8Array(512 * 4);
	for (let x = 0; x < 512; x += 1) expected.set([(x * 2) % 251, 17, (x * 2) % 113, 255], x * 4);
	assert.deepEqual(prepared.descriptor, descriptor(512, 1));
	assert.deepEqual(new Uint8Array(await prepared.body.arrayBuffer()), expected);
});

test('bounded source dimensions and both tiers retain their planning invariants over a pinned corpus', () => {
	let state = 0x618d75;
	for (let index = 0; index < 512; index += 1) {
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const width = 1 + state % 4096;
		state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const height = 1 + state % 4096;
		for (const tier of ['thumbnail', 'fit-screen'] as const) {
			const planned = planPhotoPreviewV1({ binding: binding(width, height), source: descriptor(width, height), tier });
			assert.ok(planned.output.width <= width && planned.output.height <= height);
			assert.ok(planned.output.width <= (tier === 'thumbnail' ? 512 : 2048) && planned.output.height <= (tier === 'thumbnail' ? 512 : 2048));
			assert.equal(planned.byteLength, planned.output.width * planned.output.height * 4);
			assert.deepEqual(normalizePhotoPreviewPlanV1(JSON.parse(JSON.stringify(planned))), planned);
		}
	}
});

test('preparation snapshots intrinsic samples without executing own methods and resists caller mutation at its task yield', async () => {
	const source = frame(), expected = source.pixels.slice(); let invoked = 0;
	for (const key of ['slice', 'constructor', Symbol.iterator]) Object.defineProperty(source.pixels, key, { get() { invoked += 1; throw new Error('sample accessor ran'); } });
	const pending = preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: source });
	Uint8Array.prototype.fill.call(source.pixels, 0);
	assert.deepEqual(new Uint8Array(await (await pending).body.arrayBuffer()), expected);
	assert.equal(invoked, 0);
});

test('source profile/geometry changes refuse and caller cancellation publishes no body', async () => {
	await assert.rejects(preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: { ...frame(), descriptor: descriptor(3, 2) } }), /source/u);
	await assert.rejects(preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: { ...frame(), descriptor: { ...descriptor(), primaries: 'display-p3' } } }), /profile/u);
	await assert.rejects(preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: { descriptor: { ...descriptor(), sampleFormat: 'float32', transfer: 'linear' }, pixels: new Float32Array(24).fill(NaN) } }), /profile/u, 'refuse an unsupported descriptor before scanning its samples');
	const controller = new AbortController(), reason = new Error('abort preview task');
	const timer = setTimeout(() => { controller.abort(reason); }, 0);
	try { await assert.rejects(preparePhotoPreviewV1({ plan: plan(), binding: binding(), frame: frame(), signal: controller.signal }), error => error === reason); }
	finally { clearTimeout(timer); }
});
