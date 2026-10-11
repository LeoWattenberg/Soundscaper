/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createMotionscaperDeliveryAuthority } from '../desktop/motionscaper-delivery-authority.ts';
import { createMotionNativeFrameWriter } from '../src/common/editor/motion-native-frame-carrier-v1.ts';
import type { MotionDesktopDelivery } from '../src/motionscaper/desktop-delivery-contract.ts';
const plan = { identity: { projectId: 'p', revisionDigest: 'a'.repeat(64), compositionId: 'c' }, width: 1, height: 1,
	frameRate: { num: 24, den: 1 }, firstFrame: 0, frameCount: 1 };
async function upload(authority: MotionDesktopDelivery, token: string) {
	let offset = 0;
	const writer = await createMotionNativeFrameWriter(plan, new WritableStream<Uint8Array>({ async write(bytes) {
		await authority.write({ token, offset, bytes }); offset += bytes.length;
	} }));
	await writer.write(0, { width: 1, height: 1, colorSpace: 'linear-rec709-d65', alphaMode: 'premultiplied', pixels: new Float32Array([0.1, 0.2, 0.3, 0.5]) });
	return writer.finish();
}
await test('Motionscaper native delivery commits atomically only after exact carrier verification', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-delivery-')); const path = join(root, 'output.mov');
	await writeFile(path, 'original'); let runs = 0;
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: async () => path, encoder: { async encode(request) {
		runs++; const bytes = Buffer.from('verified movie'); await writeFile(request.output, bytes);
		return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), frameCount: 1, audioSamples: 0 };
	} } });
	try {
		await assert.rejects(authority.begin({ plan: { ...plan, frameCount: 32_769 }, suggestedName: 'too-long.mov' }), /bounded/u);
		const first = await authority.begin({ plan, suggestedName: 'x.mov' }); assert.ok(first);
		await assert.rejects(authority.begin({ plan, suggestedName: 'y.mov' }), /active/u);
		await assert.rejects(authority.write({ token: 'foreign', offset: 0, bytes: new Uint8Array([1]) }), /capability/u);
		const receipt = await upload(authority, first.token);
		await assert.rejects(authority.commit({ token: first.token, ...receipt, sha256: '0'.repeat(64) }), /digest/u);
		assert.equal(await readFile(path, 'utf8'), 'original'); assert.equal(runs, 0);
		const second = await authority.begin({ plan, suggestedName: 'x.mov' }); assert.ok(second);
		const valid = await upload(authority, second.token);
		assert.equal(await readFile(path, 'utf8'), 'original');
		const saved = await authority.commit({ token: second.token, ...valid });
		assert.equal(saved.name, 'output.mov'); assert.equal(saved.profile.encoderInputBits, 10);
		assert.deepEqual(saved.identity, plan.identity); assert.equal(await readFile(path, 'utf8'), 'verified movie');
		assert.deepEqual(await readdir(root), ['output.mov']);
	} finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
await test('Motionscaper native delivery rejects concurrent destination edits and cancels in-flight encoding', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-delivery-cancel-')); const path = join(root, 'output.mov');
	await writeFile(path, 'original'); let start!: () => void; const started = new Promise<void>(resolve => { start = resolve; });
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: async () => path, encoder: { async encode(request) {
		start(); await new Promise<void>((_resolve, reject) => { request.signal.addEventListener('abort', () => { reject(new Error('cancelled')); }, { once: true }); });
		throw new Error('unreachable');
	} } });
	try {
		const selected = await authority.begin({ plan, suggestedName: 'x.mov' }); assert.ok(selected);
		const uploaded = await upload(authority, selected.token);
		const committing = authority.commit({ token: selected.token, ...uploaded });
		const rejected = assert.rejects(committing, /cancelled/u); await started;
		await authority.cancel({ token: selected.token }); await rejected;
		assert.equal(await readFile(path, 'utf8'), 'original'); assert.deepEqual(await readdir(root), ['output.mov']);
	} finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
	const unavailable = createMotionscaperDeliveryAuthority({ chooseOutput: async () => null, encoder: null });
	assert.equal(await unavailable.getProfile(), null); await assert.rejects(unavailable.begin({ plan, suggestedName: 'x.mov' }), /unavailable/u); await unavailable.dispose();
});
await test('Motionscaper native delivery preserves an output edited while the encoder runs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motionscaper-delivery-conflict-')); const path = join(root, 'output.mov');
	await writeFile(path, 'original');
	const authority = createMotionscaperDeliveryAuthority({ chooseOutput: async () => path, encoder: { async encode(request) {
		await writeFile(path, 'external edit'); const bytes = Buffer.from('new movie'); await writeFile(request.output, bytes);
		return { byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), frameCount: 1, audioSamples: 0 };
	} } });
	try {
		const selected = await authority.begin({ plan, suggestedName: 'x.mov' }); assert.ok(selected);
		const uploaded = await upload(authority, selected.token);
		await assert.rejects(authority.commit({ token: selected.token, ...uploaded }), /destination changed/u);
		assert.equal(await readFile(path, 'utf8'), 'external edit'); assert.deepEqual(await readdir(root), ['output.mov']);
	} finally { await authority.dispose(); await rm(root, { recursive: true, force: true }); }
});
