/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer, normalizeMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { transferMotionCompositionOffer, type MotionLinkTransferTransaction } from '../src/common/editor/motion-link-transfer.ts';
import type { MotionAsset } from '../src/common/editor/motion-asset.ts';
import type { MotionAssetBody } from '../src/common/editor/motion-asset-body.ts';

const bytes = new Uint8Array([1, 2, 3, 4, 5, 6]); const digest = bytesToHex(sha256(bytes));
const asset: MotionAsset = { id: 'image', kind: 'image', name: 'image.png', width: 1, height: 1, hasAlpha: true, mimeType: 'image/png', sha256: digest,
	byteLength: bytes.length, storageKey: `motion-sha256:${digest}` };
const project = { ...createMotionscaperProject({ id: 'source', title: 'Source', compositionId: 'main' }), assets: [asset, { ...asset, id: 'alias' }] };
const offer = () => createMotionCompositionOffer('main', createMotionscaperRevision(project));
function sink() {
	const calls: string[] = []; const chunks: number[][] = [];
	const transaction: MotionLinkTransferTransaction = { async write(value, chunk) { calls.push(`write:${value.id}`); chunks.push([...chunk]); },
		async finish(value) { calls.push(`finish:${value.id}`); }, async commit(value) { calls.push(`commit:${value.revision.digest}`); }, async rollback() { calls.push('rollback'); } };
	return { calls, chunks, transaction, async begin() { calls.push('begin'); return transaction; } };
}
function body(chunks: readonly Uint8Array[], size = bytes.length): MotionAssetBody { return { size, stream() { return new ReadableStream({ start(controller) { chunks.forEach((chunk) => controller.enqueue(chunk)); controller.close(); } }); } }; }

test('M10 composition offers bind stable identity, complete immutable closure and explicit output without local capabilities', () => {
	const value = offer(); assert.equal(value.protocol, 'motionscaper-composition-link'); assert.equal(value.version, 1); assert.equal(value.compositionId, 'main');
	assert.equal(value.output.durationFrames, 300); assert.equal(value.revision.projectId, 'source'); assert.deepEqual(normalizeMotionCompositionOffer(JSON.parse(JSON.stringify(value)) as unknown), value);
	assert.throws(() => normalizeMotionCompositionOffer({ ...value, windowToken: 'secret' }), /field|unsupported/u);
	assert.throws(() => normalizeMotionCompositionOffer({ ...value, output: { ...value.output, width: 1 } }), /output/u);
	assert.throws(() => normalizeMotionCompositionOffer({ ...value, revision: { ...value.revision, assetDigests: [] } }), /closure/u);
	assert.throws(() => createMotionCompositionOffer('deleted', value.revision), /composition/u);
});

test('M10 transfer streams one verified body per digest and publishes the complete revision only after all finishes', async () => {
	const target = sink(); let reads = 0;
	const result = await transferMotionCompositionOffer(offer(), { begin: target.begin, readAsset: async () => { reads++; return body([bytes.slice(0, 2), bytes.slice(2)]); } });
	assert.equal(reads, 1); assert.equal(result.digest, offer().revision.digest);
	assert.deepEqual(target.chunks, [[1, 2], [3, 4, 5, 6]]); assert.deepEqual(target.calls, ['begin', 'write:alias', 'write:alias', 'finish:alias', `commit:${result.digest}`]);
});

test('M10 malformed offers and total-byte admission refuse before receiver/source acquisition', async () => {
	const target = sink(); let reads = 0; const options = { begin: target.begin, async readAsset() { reads++; return body([bytes]); } };
	await assert.rejects(transferMotionCompositionOffer({ ...offer(), version: 2 }, options), /version/u);
	await assert.rejects(transferMotionCompositionOffer(offer(), { ...options, maximumBytes: 5 }), /byte.*budget/u);
	assert.equal(reads, 0); assert.deepEqual(target.calls, []);
});

test('M10 missing, corrupt, short and oversized dependency streams roll back without publishing', async () => {
	for (const input of [null, body([new Uint8Array([9, 2, 3, 4, 5, 6])]), body([bytes.slice(1)]), body([new Uint8Array(7)]), body([bytes], 7)]) {
		const target = sink(); await assert.rejects(transferMotionCompositionOffer(offer(), { begin: target.begin, readAsset: () => Promise.resolve(input) }), /asset|digest|size|length/u);
		assert.equal(target.calls.at(-1), 'rollback'); assert.equal(target.calls.some((call) => call.startsWith('commit:')), false);
	}
});

test('M10 cancellation and publication failure discard staging and retain the previous receiver snapshot', async () => {
	const controller = new AbortController(); const target = sink();
	target.transaction.write = async () => { controller.abort(); };
	await assert.rejects(transferMotionCompositionOffer(offer(), { begin: target.begin, readAsset: () => Promise.resolve(body([bytes])), signal: controller.signal }), { name: 'AbortError' });
	assert.equal(target.calls.at(-1), 'rollback'); assert.equal(target.calls.some((call) => call.startsWith('commit:')), false);
	const failed = sink(); failed.transaction.commit = async () => { throw new Error('Atomic publication failed.'); };
	await assert.rejects(transferMotionCompositionOffer(offer(), { begin: failed.begin, readAsset: () => Promise.resolve(body([bytes])) }), /publication/u); assert.equal(failed.calls.at(-1), 'rollback');
});

test('M10 cancellation releases a stalled dependency reader and failed cleanup preserves both errors', async () => {
	const controller = new AbortController(); const target = sink(); let cancelled = 0;
	const stalled = { size: bytes.length, stream: () => new ReadableStream<Uint8Array>({ cancel() { cancelled++; } }) };
	const pending = transferMotionCompositionOffer(offer(), { begin: target.begin, readAsset: () => Promise.resolve(stalled), signal: controller.signal });
	setTimeout(() => controller.abort(), 0); await assert.rejects(pending, { name: 'AbortError' }); assert.equal(cancelled, 1); assert.equal(target.calls.at(-1), 'rollback');
	const failed = sink(); const publication = new Error('publication'); const cleanup = new Error('cleanup');
	failed.transaction.commit = async () => { throw publication; }; failed.transaction.rollback = async () => { throw cleanup; };
	await assert.rejects(transferMotionCompositionOffer(offer(), { begin: failed.begin, readAsset: () => Promise.resolve(body([bytes])) }), (error: unknown) => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [publication, cleanup]); assert.equal(error.cause, cleanup); return true;
	});
});
