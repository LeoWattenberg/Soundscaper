/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { crc32, deflateSync } from 'node:zlib';
import test from 'node:test';
import type { Page } from '@playwright/test';
import { motionSustainedOpfsSource, readMotionSustainedDestination } from '../scripts/performance/motionscaper-sustained-opfs.ts';
import { verifyMotionSustainedPng } from '../scripts/performance/motionscaper-sustained-png.ts';
import { motionTarFileHeader, motionTarPadding } from '../src/common/editor/motion-tar.ts';

const selection = { frames: 300 as const, projectId: 'sustained', compositionId: 'main', revisionDigest: 'a'.repeat(64) };
function pngChunk(type: string, body: Uint8Array): Buffer {
	const bytes = Buffer.alloc(body.byteLength + 12); bytes.writeUInt32BE(body.byteLength); bytes.write(type, 4); bytes.set(body, 8);
	bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
}
function png(): Buffer {
	const header = Buffer.alloc(13); header.writeUInt32BE(160); header.writeUInt32BE(90, 4); header[8] = 8; header[9] = 6;
	const rows = Buffer.alloc(90 * 641, 127); for (let y = 0; y < 90; y++) rows[y * 641] = 0;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0))]);
}
async function archive(path: string, mode = 'valid', frames: 300 | 1200 = 300): Promise<void> {
	const file = await open(path, 'wx'); const image = png();
	try {
		for (let i = 0; i < frames; i++) {
			const name = `frames/frame${String(i + 1 + (mode === 'order' && i === 150 ? 1 : 0)).padStart(12, '0')}.png`;
			const header = motionTarFileHeader(name, image.length); if (mode === 'header' && i === 150) header[100] = 0;
			const body = Buffer.from(image); if (mode === 'png' && i === 100) body[body.length - 1]! ^= 1;
			await file.write(header); await file.write(body); await file.write(motionTarPadding(body.length));
		}
		const metadata = Buffer.from(JSON.stringify({ format: 'motionscaper-png-sequence', version: 1,
			identity: { projectId: selection.projectId, compositionId: selection.compositionId, revisionDigest: mode === 'identity' ? 'b'.repeat(64) : selection.revisionDigest },
			width: 160, height: 90, frameRate: { num: 30, den: 1 }, firstFrame: 0, frameCount: frames,
			colorSpace: 'srgb', alphaMode: 'straight', pattern: 'frames/frame%012d.png' }));
		await file.write(motionTarFileHeader('sequence.json', metadata.length)); await file.write(metadata); await file.write(motionTarPadding(metadata.length));
		await file.write(Buffer.alloc(mode === 'truncated' ? 700 : mode === 'trailing' ? 1025 : 1024));
	} finally { await file.close(); }
}
test('Motion sustained TAR verification streams all exact frames and retains only first, middle and last PNGs', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-sustained-tar-')); const path = join(root, 'sequence.tar');
	try {
		for (const frames of [300, 1200] as const) {
			await archive(path, 'valid', frames); const result = await verifyMotionSustainedPng(path, { ...selection, frames });
			assert.equal(result.frames, frames); assert.deepEqual(result.selected.map(frame => frame.index), [0, frames / 2, frames - 1]);
			for (const frame of result.selected) assert.deepEqual(frame.png, png());
			assert.equal(result.sha256, createHash('sha256').update(await readFile(path)).digest('hex'));
			assert.ok(result.maximumReadBytes <= 65536); assert.ok(result.retainedPngBytes <= 3 * 151936); await rm(path);
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion sustained OPFS transfer bounds each awaited read and removes a corrupt partial Node destination', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-sustained-transfer-')); let corrupt = false, active = 0, maximum = 0, maximumRead = 0;
	const size = 180001;
	const page = { async evaluate(_callback: unknown, request?: { name: string; offset: number; length: number }) {
		if (!request) return { name: 'sequence.tar', suggestedName: 'actual.tar', bytes: size, writes: 3, maxOutstandingWrites: 1, closed: true, aborted: false, removed: false, events: ['close'] };
		active++; maximum = Math.max(maximum, active); maximumRead = Math.max(maximumRead, request.length);
		await new Promise(resolve => setTimeout(resolve, 1)); active--;
		return { size, bytes: Array.from({ length: request.length - (corrupt ? 1 : 0) }, (_, index) => (request.offset + index) % 251) };
	} } as unknown as Page;
	try {
		const path = join(root, 'sequence.tar'); const receipt = await readMotionSustainedDestination(page, 'sequence.tar', path);
		assert.equal(receipt.byteLength, size); assert.equal(receipt.readCalls, 3); assert.equal(maximum, 1); assert.equal(maximumRead, 65536);
		assert.equal(receipt.sha256, createHash('sha256').update(await readFile(path)).digest('hex'));
		corrupt = true; await assert.rejects(readMotionSustainedDestination(page, 'sequence.tar', join(root, 'partial.tar')), /read changed/u);
		await assert.rejects(readFile(join(root, 'partial.tar')), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
test('Motion sustained TAR refuses corrupt nonselected PNGs, headers, order, identity, truncation and trailing bytes', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-sustained-invalid-'));
	try {
		for (const mode of ['png', 'header', 'order', 'identity', 'truncated', 'trailing']) {
			const path = join(root, mode); await archive(path, mode);
			await assert.rejects(verifyMotionSustainedPng(path, selection), /PNG|TAR|sequence/u, mode);
		}
	} finally { await rm(root, { recursive: true, force: true }); }
});

test('Motion serialized OPFS adapter awaits one real file write, records close, and abort removes its owned file', async () => {
	const root = await mkdtemp(join(tmpdir(), 'motion-sustained-opfs-')); let active = 0, maximum = 0, directoryCreated = false;
	const removed: string[] = [];
	const directory = {
		async getFileHandle(name: string, options?: { create?: boolean }) {
			if (!options?.create) { try { const handle = await open(join(root, name)); await handle.close(); } catch { throw new DOMException('missing fixture file', 'NotFoundError'); } }
			return { name, async createWritable() {
				const handle = await open(join(root, name), 'w');
				return { async write(bytes: Uint8Array) { if (name === 'failed.tar') throw new Error('fixture disk full'); active++; maximum = Math.max(maximum, active); await new Promise(resolve => setTimeout(resolve, 1)); await handle.write(bytes); active--; },
					async close() { if (name === 'close-failed.tar') throw new Error('fixture close failed'); await handle.close(); }, async abort() { await handle.close(); } };
			} };
		},
		async removeEntry(name: string) { removed.push(name); await rm(join(root, name), { force: true }); },
	};
	const context = createContext({ navigator: { storage: { async getDirectory() { return {
		async getDirectoryHandle(_name: string, options?: { create?: boolean }) { if (!directoryCreated && !options?.create) throw new DOMException('missing directory', 'NotFoundError'); directoryCreated = true; return directory; },
		async removeEntry() { await rm(root, { recursive: true }); },
	}; } } }, WritableStream, Uint8Array, DOMException });
	try {
		runInContext(motionSustainedOpfsSource({ directoryName: 'motion-owned' }), context);
		await runInContext(`(async()=>{await __motionSustainedDestination.prepare('sequence.tar'); const h=await showSaveFilePicker({suggestedName:'actual.tar'}); const w=(await h.createWritable()).getWriter(); await w.write(new Uint8Array(150000)); await w.close();})()`, context);
		const first = runInContext('__motionSustainedDestination.snapshot()', context) as { bytes: number; writes: number; closed: boolean; maxOutstandingWrites: number };
		assert.equal(first.bytes, 150000); assert.equal(first.writes, 3); assert.equal(first.closed, true); assert.equal(first.maxOutstandingWrites, 1); assert.equal(maximum, 1);
		assert.equal((await readFile(join(root, 'sequence.tar'))).byteLength, 150000);
		await runInContext(`(async()=>{await __motionSustainedDestination.prepare('aborted.tar'); const h=await showSaveFilePicker({}); const w=(await h.createWritable()).getWriter(); await w.write(new Uint8Array(10)); await w.abort('cancel');})()`, context);
		const aborted = runInContext('__motionSustainedDestination.snapshot()', context) as { aborted: boolean; removed: boolean; closed: boolean };
		assert.equal(aborted.aborted, true); assert.equal(aborted.removed, true); assert.equal(aborted.closed, false); assert.deepEqual(removed, ['aborted.tar']);
		await assert.rejects(readFile(join(root, 'aborted.tar')), /ENOENT/u);
		await assert.rejects(runInContext(`(async()=>{await __motionSustainedDestination.prepare('failed.tar'); const h=await showSaveFilePicker({}); const w=(await h.createWritable()).getWriter(); await w.write(new Uint8Array(10));})()`, context) as Promise<void>, /fixture disk full/u);
		const failed = runInContext('__motionSustainedDestination.snapshot()', context) as { aborted: boolean; removed: boolean; events: string[] };
		assert.equal(failed.aborted, true); assert.equal(failed.removed, true); assert.ok(failed.events.includes('write-failed'));
		await assert.rejects(readFile(join(root, 'failed.tar')), /ENOENT/u);
		await assert.rejects(runInContext(`(async()=>{await __motionSustainedDestination.prepare('close-failed.tar'); const h=await showSaveFilePicker({}); const w=(await h.createWritable()).getWriter(); await w.write(new Uint8Array(10)); await w.close();})()`, context) as Promise<void>, /fixture close failed/u);
		const closeFailed = runInContext('__motionSustainedDestination.snapshot()', context) as { closed: boolean; aborted: boolean; removed: boolean };
		assert.equal(closeFailed.closed, false); assert.equal(closeFailed.aborted, true); assert.equal(closeFailed.removed, true);
		await assert.rejects(readFile(join(root, 'close-failed.tar')), /ENOENT/u);
		await runInContext(`__motionSustainedDestination.prepare('unopened.tar')`, context);
		await runInContext(`__motionSustainedDestination.cleanup()`, context);
		await assert.rejects(readFile(join(root, 'sequence.tar')), /ENOENT/u);
	} finally { await rm(root, { recursive: true, force: true }); }
});
