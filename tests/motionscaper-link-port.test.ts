/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createMotionscaperProject } from '../src/motionscaper/editor-project.ts';
import { createMotionscaperRevision } from '../src/common/editor/motion-project-revision.ts';
import { createMotionCompositionOffer } from '../src/common/editor/motion-link-protocol.ts';
import { transferMotionCompositionOffer } from '../src/common/editor/motion-link-transfer.ts';
import { receiveMotionCompositionPort, sendMotionCompositionPort } from '../src/common/editor/controller/composition/motion-link-port.ts';
import type { MotionAssetBody } from '../src/common/editor/motion-asset-body.ts';

const session = 'ab'.repeat(32); const bytes = Uint8Array.from({ length: 64 }, (_, i) => i); const digest = bytesToHex(sha256(bytes));
function offer() {
	const project = createMotionscaperProject({ id: 'source', title: 'Source', compositionId: 'main' });
	return createMotionCompositionOffer('main', createMotionscaperRevision({ ...project, assets: [{ id: 'asset', kind: 'image', name: 'sample.png', width: 1, height: 1, hasAlpha: true, mimeType: 'image/png', byteLength: bytes.length, sha256: digest, storageKey: `motion-sha256:${digest}` }] }));
}
function body(chunks = [bytes.slice(0, 32), bytes.slice(32)], onPull = () => {}, onCancel = () => {}): MotionAssetBody {
	return { size: bytes.length, stream: () => new ReadableStream<Uint8Array>({ pull(controller) { onPull(); const chunk = chunks.shift(); if (chunk) controller.enqueue(chunk); else controller.close(); }, cancel: onCancel }, { highWaterMark: 0 }) };
}

test('M10 port transfer verifies closure with one source chunk outstanding until private staging acknowledges', async () => {
	const { port1, port2 } = new MessageChannel(); let pulls = 0; let writes = 0; let committed = false;
	const received = receiveMotionCompositionPort({ port: port2, session, async receive(value, options) {
		await transferMotionCompositionOffer(value, { ...options, async begin() { return {
			async write(_asset, chunk) { writes++; assert.equal(pulls, writes); assert.deepEqual([...chunk], [...bytes.slice((writes - 1) * 32, writes * 32)]); await new Promise((resolve) => setTimeout(resolve, 5)); assert.equal(pulls, writes); },
			async finish() {}, async commit() { committed = true; }, async rollback() { assert.fail('unexpected rollback'); },
		}; } });
	} });
	const sent = sendMotionCompositionPort({ port: port1, session, offer: offer(), readAsset: async () => body(undefined, () => { pulls++; }) });
	assert.deepEqual(await Promise.all([sent, received]), [offer().revision.digest, offer().revision.digest]); assert.equal(committed, true); assert.equal(writes, 2); assert.equal(pulls, 3);
});

test('M10 port refusal rolls back corrupt bytes and cannot announce an incomplete closure', async () => {
	for (const consume of [true, false]) {
		const { port1, port2 } = new MessageChannel(); let rollback = 0; let committed = 0;
		const received = receiveMotionCompositionPort({ port: port2, session, async receive(value, options) {
			if (!consume) return;
			await transferMotionCompositionOffer(value, { ...options, async begin() { return { async write() {}, async finish() {}, async commit() { committed++; }, async rollback() { rollback++; } }; } });
		} });
		const corrupted = bytes.slice(); corrupted[1] = 0;
		const sent = sendMotionCompositionPort({ port: port1, session, offer: offer(), readAsset: async () => body([corrupted]) });
		const results = await Promise.allSettled([sent, received]); assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected'); assert.equal(committed, 0); assert.equal(rollback, consume ? 1 : 0);
	}
});

test('M10 port cancellation releases a stalled source and awaiting receiver staging', async () => {
	const { port1, port2 } = new MessageChannel(); const cancellation = new AbortController(); let sourceCancelled = 0; let rolledBack = 0;
	let opened!: () => void; const ready = new Promise<void>((resolve) => { opened = resolve; });
	const received = receiveMotionCompositionPort({ port: port2, session, async receive(value, options) { await transferMotionCompositionOffer(value, { ...options, async begin() { return { async write() {}, async finish() {}, async commit() { assert.fail('published cancelled transfer'); }, async rollback() { rolledBack++; } }; } }); } });
	const sent = sendMotionCompositionPort({ port: port1, session, offer: offer(), signal: cancellation.signal, readAsset: async () => ({ size: bytes.length, stream: () => new ReadableStream({ start() { opened(); }, cancel() { sourceCancelled++; } }) }) });
	await ready; cancellation.abort(); const results = await Promise.allSettled([sent, received]);
	assert.equal(results[0].status, 'rejected'); assert.equal(results[1].status, 'rejected'); assert.equal(sourceCancelled, 1); assert.equal(rolledBack, 1);
});

test('M10 port timeout and a wrong-session packet fail before storage or source access', async () => {
	for (const forged of [false, true]) {
		const { port1, port2 } = new MessageChannel(); let acquired = 0;
		const received = receiveMotionCompositionPort({ port: port2, session, idleTimeoutMs: 25, async receive() { acquired++; } });
		if (forged) port1.postMessage({ protocol: 'motion-link-port', version: 1, session: 'cd'.repeat(32), type: 'request', id: 1, request: { kind: 'offer-start', byteLength: 1 } });
		await assert.rejects(received, /session|timeout/u); assert.equal(acquired, 0); port1.close();
	}
});

test('M10 port metadata allocation refuses declared excess before receiving chunks', async () => {
	const { port1, port2 } = new MessageChannel();
	const received = receiveMotionCompositionPort({ port: port2, session, async receive() { assert.fail('admitted oversized offer'); } });
	port1.postMessage({ protocol: 'motion-link-port', version: 1, session, type: 'request', id: 1, request: { kind: 'offer-start', byteLength: 32 * 1024 * 1024 + 1 } });
	await assert.rejects(received, /offer|range/u); port1.close();
});

test('M10 established port session serializes saved updates, survives idle and pins project/composition identity', async () => {
	const { createMotionCompositionPortSender } = await import('../src/common/editor/controller/composition/motion-link-port.ts');
	const { port1, port2 } = new MessageChannel(); const received: string[] = [];
	const receiving = receiveMotionCompositionPort({ port: port2, session, persistent: true, idleTimeoutMs: 20, async receive(value, options) {
		await transferMotionCompositionOffer(value, { ...options, async begin() { return { async write() {}, async finish() {}, async commit() { received.push(value.revision.digest); }, async rollback() {} }; } });
	} });
	const sender = createMotionCompositionPortSender({ port: port1, session, idleTimeoutMs: 20, readAsset: async () => body() });
	const first = offer(); assert.equal(await sender.send(first), first.revision.digest);
	await new Promise((resolve) => setTimeout(resolve, 65));
	const next = createMotionCompositionOffer('main', createMotionscaperRevision({ ...first.revision.project, revision: 2, title: 'Saved update' }));
	const update = sender.send(next); await assert.rejects(sender.send(first), /one|flight/u); assert.equal(await update, next.revision.digest);
	const other = createMotionCompositionOffer('main', createMotionscaperRevision({ ...first.revision.project, id: 'different-project' }));
	await assert.rejects(sender.send(other), /identity|project/u); assert.deepEqual(received, [first.revision.digest, next.revision.digest]);
	await sender.dispose(); assert.equal(await receiving, next.revision.digest); await sender.closed;
});
