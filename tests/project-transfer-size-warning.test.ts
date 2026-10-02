/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { receiveProjectTransfer, sendProjectTransfer, type ProjectTransferPort,
	type ProjectTransferInboundMessage } from '../src/common/transfer/project-transfer-handshake.ts';
import { exportProjectTransferBundle } from '../src/common/transfer/project-transfer-bundle.ts';
import { importTransferArchiveFiles } from '../src/common/transfer/transfer-manual-import.ts';
import { archiveBytes, collectExport, createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { runtimeFor } from './project-transfer-runtime-fixture.ts';
import { receiveTransferArchives } from '../src/common/transfer/transfer-session.ts';
import { confirmFileSizeWarning } from '../src/common/editor/controller/shared/file-size-warning.ts';
import { negotiateTransferSizeOffer } from '../src/common/transfer/project-transfer-size-warning.ts';
import { PROJECT_TRANSFER_MAX_ENTRY_BYTES } from '../src/common/transfer/project-transfer-handshake-wire.ts';

function wire() {
	const subscribers = [new Set<(message: ProjectTransferInboundMessage) => void>(), new Set<(message: ProjectTransferInboundMessage) => void>()];
	const sent: string[] = [];
	const port = (index: number): ProjectTransferPort => ({
		post: (data, targetOrigin) => { sent.push((data as { kind: string }).kind); queueMicrotask(() => {
			for (const listener of subscribers[1 - index]!) listener({ origin: 'https://peer.example', data });
		}); assert.equal(targetOrigin, 'https://peer.example'); },
		subscribe: (listener) => { subscribers[index]!.add(listener); return () => { subscribers[index]!.delete(listener); }; },
	});
	return { sender: port(0), receiver: port(1), sent };
}

const entry = { entryId: 'project', name: 'project.scape', byteLength: 9, payload: new Uint8Array(9), conversionReportSidecar: null };

test('large transfer negotiation asks both origins before sending payload bytes', async () => {
	const ports = wire();
	let approve!: (accepted: boolean) => void;
	const pending = new Promise<boolean>((resolve) => { approve = resolve; });
	let accepted = 0, senderPrompts = 0;
	const receiving = receiveProjectTransfer({ port: ports.receiver, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], sessionId: 'session', maxEntryBytes: 8,
		confirmFileSizeWarning: () => pending, acceptEntry: () => { accepted += 1; } });
	const sending = sendProjectTransfer({ port: ports.sender, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], entries: [entry],
		confirmFileSizeWarning: async () => { senderPrompts += 1; return true; } });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(senderPrompts, 1);
	assert.deepEqual(ports.sent, ['ready', 'size-offer']);
	assert.equal(accepted, 0);
	approve(true);
	const [received, sent] = await Promise.all([receiving, sending]);
	assert.equal(received.storedCount, 1); assert.equal(sent.storedCount, 1);
	assert.deepEqual(ports.sent.slice(0, 4), ['ready', 'size-offer', 'size-accept', 'begin']);
});

test('declining target transfer admission sends no archive payload and publishes nothing', async () => {
	const ports = wire(); let accepted = 0;
	const receiving = receiveProjectTransfer({ port: ports.receiver, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], sessionId: 'session', maxEntryBytes: 8,
		confirmFileSizeWarning: async () => false, acceptEntry: () => { accepted += 1; } });
	const sending = sendProjectTransfer({ port: ports.sender, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], entries: [entry], confirmFileSizeWarning: async () => true });
	const results = await Promise.allSettled([receiving, sending]);
	assert.ok(results.every((result) => result.status === 'rejected'));
	assert.equal(accepted, 0); assert.ok(!ports.sent.includes('entry'));
});

test('peer abort cancels a downstream archive warning before project publication', async () => {
	const ports = wire(), senderLifetime = new AbortController();
	const baseRuntime = runtimeFor(createFakeArchive());
	let approve!: (accepted: boolean) => void, published = 0;
	let importSignal: AbortSignal | undefined;
	const bytes = archiveBytes({ id: 'project', title: 'Project' });
	const receiving = receiveTransferArchives({ runtime: { ...baseRuntime, importBundle: async (request) => {
		importSignal = request.signal;
		await confirmFileSizeWarning(bytes.byteLength, 1, 'Project document', {
			signal: request.signal, confirmFileSizeWarning: () => new Promise<boolean>((resolve) => { approve = resolve; }),
		});
		published += 1; return baseRuntime.importBundle(request);
	} }, store: new FakeStore(), port: ports.receiver, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], sessionId: 'session' });
	const sending = sendProjectTransfer({ port: ports.sender, targetOrigin: 'https://peer.example',
		allowedOrigins: ['https://peer.example'], signal: senderLifetime.signal,
		entries: [{ ...entry, byteLength: bytes.byteLength, payload: bytes }] });
	const results = Promise.allSettled([receiving, sending]);
	await new Promise<void>((resolve) => setImmediate(resolve));
	senderLifetime.abort();
	await new Promise<void>((resolve) => setImmediate(resolve));
	approve(true);
	const [received] = await results;
	assert.equal(importSignal?.aborted, true); assert.equal(published, 0);
	assert.equal(received?.status, 'fulfilled');
	if (received?.status === 'fulfilled') assert.equal(received.value.completed, false);
});

test('a larger peer admission cannot suppress the sending origin size warning', async () => {
	const lifetime = new AbortController(); let prompts = 0;
	await negotiateTransferSizeOffer({ signal: lifetime.signal, expectVersion() {}, expectSession() {},
		next: async () => { throw new Error('No increased peer admission is needed.'); },
		send: () => { throw new Error('No size offer is needed.'); }, endWith() {}, close() {},
	}, 'session', [{ ...entry, byteLength: PROJECT_TRANSFER_MAX_ENTRY_BYTES + 1 }],
	PROJECT_TRANSFER_MAX_ENTRY_BYTES * 2, { confirmFileSizeWarning: async (warning) => {
		assert.equal(warning.thresholdBytes, PROJECT_TRANSFER_MAX_ENTRY_BYTES); prompts += 1; return true;
	} });
	assert.equal(prompts, 1);
});

test('transfer archive export confirms before materializing whole Blob bytes', async () => {
	let reads = 0, prompts = 0;
	const blob = new Blob(['archive']);
	const arrayBuffer = blob.arrayBuffer.bind(blob);
	blob.arrayBuffer = () => { reads += 1; return arrayBuffer(); };
	const store = new FakeStore([{ id: 'project', title: 'Project' }]);
	const canceled = await collectExport(exportProjectTransferBundle({ store, maximumEntryBytes: 1,
		exportProject: async () => ({ blob }), confirmFileSizeWarning: async () => false }));
	assert.equal(reads, 0); assert.equal(canceled.entries.length, 0);
	const accepted = await collectExport(exportProjectTransferBundle({ store, maximumEntryBytes: 1,
		exportProject: async (_project, _store, options) => {
			assert.equal(typeof options.confirmFileSizeWarning, 'function'); return { blob };
		}, confirmFileSizeWarning: async () => { prompts += 1; return true; } }));
	assert.equal(prompts, 1); assert.equal(reads, 1); assert.equal(accepted.entries[0]?.byteLength, blob.size);
});

test('manual transfer warnings precede reads and accepted files retain exact body integrity', async () => {
	let reads = 0;
	const bytes = archiveBytes({ id: 'project', title: 'Project' });
	const archive = createFakeArchive(), runtime = runtimeFor(archive), store = new FakeStore();
	const file = { name: 'project.scape', byteLength: bytes.byteLength, read: async () => { reads += 1; return bytes; } };
	await assert.rejects(importTransferArchiveFiles({ runtime, store, files: [file], maximumEntryBytes: 1,
		confirmFileSizeWarning: async () => false }), { name: 'AbortError' });
	assert.equal(reads, 0); assert.equal(store.projects.size, 0);
	const accepted = await importTransferArchiveFiles({ runtime, store, files: [file], maximumEntryBytes: 1,
		confirmFileSizeWarning: async () => true });
	assert.equal(reads, 1); assert.equal(accepted.imported, 1);
	const invalid = await importTransferArchiveFiles({ runtime, store, files: [{ ...file, byteLength: bytes.byteLength + 1 }],
		maximumEntryBytes: 1, confirmFileSizeWarning: async () => true });
	assert.equal(invalid.completed, false); assert.match(invalid.stopped?.reason ?? '', /declared.*but read/);
});
