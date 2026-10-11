/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { prepareMotionscaperAeImport, commitMotionscaperAeImport, createMotionscaperAeImportCustody } from '../src/motionscaper/editor-ae-import.ts';
import type { MotionImportedMedia } from '../src/common/editor/motion-media-import.ts';
import type { MotionArchiveImportTransaction } from '../src/motionscaper/editor-scape.ts';
const bytes = new Uint8Array([1, 2, 3, 4]); const sha = createHash('sha256').update(bytes).digest('hex');
function manifest(digest = sha): Blob { return new Blob([JSON.stringify({ format: 'org.motionscaper.ae-exchange', version: 1, transferId: 'transfer',
	producer: { application: 'after-effects', version: 'unqualified', bridgeVersion: '0.1.0' }, source: { name: 'Original.aep', revisionDigest: null },
	color: { workingSpace: '', linearBlending: false, bitsPerChannel: 8 }, footage: [{ id: 'source', name: 'Image', path: 'media/source.png', byteLength: 4,
		sha256: digest, width: 64, height: 64, pixelAspect: 1, frameRate: 1, duration: 0, hasVideo: true, hasAudio: false, still: true }],
	compositions: [{ id: 'comp', name: 'Comp', width: 64, height: 64, pixelAspect: 1, frameRate: 24, duration: 1, displayStartTime: 0, background: [0, 0, 0], layers: [] }], report: [] })]); }
const files = [{ path: 'media/source.png', file: new Blob([bytes]) }];
function options() { let serial = 0; return { projectId: 'new-project', allocateId: () => `new-${String(++serial)}`,
	prepareMedia: async (file: Blob, options: { id: string }): Promise<MotionImportedMedia> => ({ body: file, asset: { kind: 'image', id: options.id, name: 'Image',
		width: 64, height: 64, hasAlpha: true, byteLength: file.size, sha256: sha, storageKey: `motion-sha256:${sha}`, mimeType: 'image/png' } }) }; }
function transaction(operations: string[]): MotionArchiveImportTransaction { return {
	writeAssetChunk: (_asset, chunk) => { operations.push(`write:${String(chunk.length)}`); return Promise.resolve(); },
	finishAsset: () => { operations.push('finish'); return Promise.resolve(); }, commit: () => { operations.push('commit'); return Promise.resolve(); },
	rollback: () => { operations.push('rollback'); return Promise.resolve(); },
}; }
test('AE import prepares a review without writes, then stages verified media before atomic publication', async () => {
	const prepared = await prepareMotionscaperAeImport(manifest(), files, options()); const operations: string[] = [];
	assert.ok(prepared.requiresAcknowledgement); assert.equal(prepared.project.id, 'new-project');
	await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: false }, () => { operations.push('begin'); return transaction(operations); }), /acknowledge/iu);
	assert.equal(operations.length, 0);
	await commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, () => { operations.push('begin'); return transaction(operations); });
	assert.deepEqual(operations, ['begin', 'write:4', 'finish', 'commit']);
	await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, () => transaction(operations)), /already|closed/iu);
	const custody = JSON.parse(await createMotionscaperAeImportCustody(prepared).text()) as { sourceExchange: { source: { name: string } }; report: unknown[] };
	assert.equal(custody.sourceExchange.source.name, 'Original.aep'); assert.ok(custody.report.length > 0);
	assert.deepEqual(new Uint8Array(await files[0]!.file.arrayBuffer()), bytes);
});
test('AE import refuses changed media, path ambiguity, unknown files and pre-aborted preparation', async () => {
	await assert.rejects(prepareMotionscaperAeImport(manifest('b'.repeat(64)), files, options()), /media.*binding/iu);
	await assert.rejects(prepareMotionscaperAeImport(manifest(), [...files, ...files], options()), /duplicate|ambiguous/iu);
	await assert.rejects(prepareMotionscaperAeImport(manifest(), [{ ...files[0]!, path: '../source.png' }], options()), /path/iu);
	await assert.rejects(prepareMotionscaperAeImport(manifest(), [{ ...files[0]!, path: 'media/other.png' }], options()), /referenced/iu);
	await assert.rejects(prepareMotionscaperAeImport(manifest(), [], options()), /Every original AE media/iu);
	await assert.rejects(prepareMotionscaperAeImport(manifest(), files, options(), AbortSignal.abort()), { name: 'AbortError' });
});
test('AE import preserves cancellation and rollback failures together without publishing a partial project', async () => {
	const prepared = await prepareMotionscaperAeImport(manifest(), files, options()), controller = new AbortController(), operations: string[] = [];
	await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, () => ({ ...transaction(operations),
		writeAssetChunk: () => { controller.abort(new Error('cancelled')); return Promise.resolve(); }, rollback: () => Promise.reject(new Error('cleanup denied')),
	}), controller.signal), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.match(String(error.errors[0]), /cancelled/u); assert.match(String(error.errors[1]), /cleanup denied/u); return true;
	});
	assert.deepEqual(operations, []);
});
test('AE import independently verifies staged body bytes even when a decoder port returns mismatched metadata', async () => {
	const settings = options(); const prepared = await prepareMotionscaperAeImport(manifest(), files, { ...settings,
		prepareMedia: async (file, options) => ({ ...await settings.prepareMedia(file, options), body: new Blob([new Uint8Array([4, 3, 2, 1])]) }),
	});
	const operations: string[] = [];
	await assert.rejects(commitMotionscaperAeImport(prepared, { acknowledgeUnsupported: true }, () => transaction(operations)), /digest/u);
	assert.deepEqual(operations, ['write:4', 'rollback']);
});
