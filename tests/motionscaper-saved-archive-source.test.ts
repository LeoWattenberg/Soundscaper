/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { digestScapeBytes } from '../src/common/editor/scape-archive-media.ts';
import { withMotionSavedArchiveSource } from '../src/common/editor/motion-saved-archive-source.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import type { MotionAssetBody } from '../src/common/editor/motion-asset-body.ts';
async function fixture(size = 5 * 1024 * 1024) {
	const bytes = new Uint8Array(size).fill(23), digest = digestScapeBytes(bytes);
	const asset = { kind: 'image' as const, id: 'picture', name: 'Retained original', width: 64, height: 64, hasAlpha: true, mimeType: 'image/png', byteLength: bytes.length, sha256: digest, storageKey: `motion-sha256:${digest}` };
	const project = { ...createMotionscaperProject({ id: 'source', compositionId: 'comp', title: 'Saved source', width: 64, height: 64 }), assets: [asset] };
	const archive = await exportMotionscaperArchive(project, () => new Blob([bytes])); assert.ok(archive); return { bytes, asset, archive };
}
test('saved Motion archive source validates immutable offer metadata and streams a complete bounded retained closure', async () => {
	const f = await fixture(); let escaped: MotionAssetBody | null = null;
	await withMotionSavedArchiveSource(f.archive, async source => {
		const offer = createMotionCompositionOffer('comp', source.revision); assert.equal(offer.revision.project.title, 'Saved source');
		escaped = await source.readAsset(source.revision.project.assets[0]!); assert.ok(escaped); const reader = escaped.stream().getReader(); let bytes = 0;
		try { while (true) { const value = await reader.read(); if (value.done) break; assert.ok(value.value.byteLength <= 4 * 1024 * 1024); assert.equal(value.value[0], 23); bytes += value.value.length; } }
		finally { reader.releaseLock(); }
		assert.equal(bytes, f.bytes.length);
		await assert.rejects(source.readAsset({ ...f.asset, sha256: 'b'.repeat(64), storageKey: `motion-sha256:${'b'.repeat(64)}` }), /closure|descriptor/iu);
	});
	assert.ok(escaped); assert.throws(() => (escaped as MotionAssetBody).stream(), /closed|once|single/iu);
});
test('saved Motion archive source detects body corruption before the consumer can finish its stream', async () => {
	const f = await fixture(4096), bytes = new Uint8Array(await f.archive.arrayBuffer());
	const position = bytes.findIndex((value, index) => value === 23 && bytes[index + 1] === 23 && bytes[index + 2] === 23); assert.ok(position > 0); bytes[position] = 24;
	await assert.rejects(withMotionSavedArchiveSource(new Blob([bytes]), async source => {
		const body = await source.readAsset(source.revision.project.assets[0]!); assert.ok(body); const reader = body.stream().getReader();
		try { while (!(await reader.read()).done) { /* Consume through final independent hash/CRC verification. */ } }
		finally { await reader.cancel(); reader.releaseLock(); }
	}), /digest|signature|CRC|checksum/iu);
});
test('saved Motion archive source cancels backpressure and releases an abandoned reader without deadlock', async () => {
	const f = await fixture(), abort = new AbortController();
	await assert.rejects(withMotionSavedArchiveSource(f.archive, async source => {
		const body = await source.readAsset(source.revision.project.assets[0]!); assert.ok(body); const reader = body.stream().getReader();
		assert.equal((await reader.read()).done, false); abort.abort();
		try { await reader.read(); } finally { await reader.cancel(); reader.releaseLock(); }
	}, abort.signal), { name: 'AbortError' });
	await withMotionSavedArchiveSource(f.archive, async source => { const body = await source.readAsset(source.revision.project.assets[0]!); assert.ok(body); const reader = body.stream().getReader(); await reader.cancel(); reader.releaseLock(); });
});

test('saved-file receive releases the capability and does not revoke a completed publication on late cancellation', async () => {
	const { receiveMotionSavedFileSnapshot } = await import('../src/common/editor/motion-saved-file-source.ts');
	const f = await fixture(4096), bytes = new Uint8Array(await f.archive.arrayBuffer()), abort = new AbortController(); let releases = 0, publications = 0;
	const files = { select: () => Promise.resolve(null), poll: () => Promise.resolve({ state: 'unchanged' as const, generation: 1 }), cancel: () => Promise.resolve(),
		read: ({ offset, length }: { offset: number; length: number }) => Promise.resolve(bytes.slice(offset, offset + length)), release: () => { releases++; return Promise.resolve(); } };
	const receipt = await receiveMotionSavedFileSnapshot(files, { token: 'pinned', name: 'Saved.mscape', byteLength: bytes.length, generation: 1 }, {
		signal: abort.signal, receive: async (offer, assets) => {
			const body = await assets.readAsset(offer.revision.project.assets[0]!); assert.ok(body); const reader = body.stream().getReader();
			try { while (!(await reader.read()).done) { /* Receiver verifies the complete retained closure. */ } } finally { reader.releaseLock(); }
			publications++; abort.abort();
		},
	});
	assert.equal(receipt.projectId, 'source'); assert.equal(receipt.generation, 1); assert.equal(publications, 1); assert.equal(releases, 1);
});

test('saved-file cleanup failure retains the completed publication receipt and primary cause', async () => {
	const { receiveMotionSavedFileSnapshot, MotionSavedFilePostPublicationError } = await import('../src/common/editor/motion-saved-file-source.ts');
	const project = createMotionscaperProject({ id: 'empty-source', compositionId: 'comp', title: 'Saved empty source' });
	const archive = await exportMotionscaperArchive(project, () => null); assert.ok(archive); const bytes = new Uint8Array(await archive.arrayBuffer());
	const cleanup = new Error('Pinned close failed');
	const files = { select: () => Promise.resolve(null), poll: () => Promise.resolve({ state: 'unchanged' as const, generation: 1 }), cancel: () => Promise.resolve(),
		read: ({ offset, length }: { offset: number; length: number }) => Promise.resolve(bytes.slice(offset, offset + length)), release: () => Promise.reject(cleanup) };
	await assert.rejects(receiveMotionSavedFileSnapshot(files, { token: 'pinned', name: 'Saved.mscape', byteLength: bytes.length, generation: 1 }, { receive: () => Promise.resolve() }), error => {
		assert.ok(error instanceof MotionSavedFilePostPublicationError); assert.equal(error.receipt.projectId, 'empty-source'); assert.equal(error.cause, cleanup); return true;
	});
});
