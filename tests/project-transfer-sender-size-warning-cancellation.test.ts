/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFileSizeWarningConfirmation } from '../src/common/editor/controller/shared/file-size-warning-confirmation.ts';
import { envelopeFor } from '../src/common/transfer/project-transfer-handshake-channel.ts';
import type { ProjectTransferInboundMessage, ProjectTransferPort } from '../src/common/transfer/project-transfer-handshake.ts';
import { sendTransferArchives, streamTransferArchives } from '../src/common/transfer/transfer-session.ts';
import * as Watch from '../src/common/transfer/transfer-send-watch.ts';
import { createFakeArchive, FakeStore } from './project-transfer-bundle-fixture.ts';
import { runtimeFor } from './project-transfer-runtime-fixture.ts';

const PEER = 'https://peer.example';

test('peer abort dismisses a sender collection warning before the handshake starts', async () => {
	const wire = createWire(), decisions = createFileSizeWarningConfirmation();
	let handshakes = 0;
	const runtime = { ...runtimeFor(createFakeArchive()), sendTransfer: async () => {
		handshakes += 1; throw new Error('The stopped export must not start a handshake.');
	} };
	const sending = sendTransferArchives({ runtime, port: wire.port, targetOrigin: PEER, allowedOrigins: [PEER],
		maximumTotalBytes: 1, confirmFileSizeWarning: decisions.confirm,
		collection: { total: 1, byteLength: 2, failures: [], entries: [{
			projectId: 'project', title: 'Project', fileName: 'project.scape', mimeType: 'application/x-scape',
			byteLength: 2, bytes: new Uint8Array(2), conversionReportSidecar: null,
		}] },
	});
	const result = Promise.allSettled([sending]);
	try {
		await tick();
		assert.ok(decisions.getSnapshot());
		wire.abort();
		await tick();
		assert.equal(decisions.getSnapshot(), null);
		const [stopped] = await result;
		assert.equal(stopped?.status, 'rejected');
		assert.equal(handshakes, 0);
	} finally { decisions.dispose(); await result; }
});

test('the sender archive factory gets the private peer lifetime before a Blob size warning', async () => {
	const wire = createWire(), decisions = createFileSizeWarningConfirmation();
	const blob = new Blob(['archive']);
	let reads = 0, handshakes = 0;
	const arrayBuffer = blob.arrayBuffer.bind(blob);
	blob.arrayBuffer = () => { reads += 1; return arrayBuffer(); };
	const runtime = { ...runtimeFor(createFakeArchive()), exportProject: async () => ({ blob }),
		sendTransfer: async () => { handshakes += 1; throw new Error('No handshake after abort.'); } };
	let signal: AbortSignal | undefined;
	const sending = sendTransferArchives({ runtime, port: wire.port, targetOrigin: PEER, allowedOrigins: [PEER],
		confirmFileSizeWarning: decisions.confirm,
		archiveFactory: (lifetime: AbortSignal) => {
			signal = lifetime;
			return streamTransferArchives({ runtime, signal: lifetime, maximumEntryBytes: 1,
				confirmFileSizeWarning: decisions.confirm, store: new FakeStore([{ id: 'project', title: 'Project' }]) });
		},
	});
	const result = Promise.allSettled([sending]);
	try {
		await tick();
		assert.ok(decisions.getSnapshot());
		wire.abort();
		await tick();
		assert.equal(signal?.aborted, true);
		assert.equal(decisions.getSnapshot(), null);
		const [stopped] = await result;
		assert.equal(stopped?.status, 'rejected');
		assert.equal(reads, 0);
		assert.equal(handshakes, 0);
	} finally { decisions.dispose(); await result; }
});

test('pre-export abort observation preserves origin, protocol and session fences without consuming ready', () => {
	assert.equal(typeof Watch.watchSenderTransferAbort, 'function');
	const wire = createWire();
	const watch = Watch.watchSenderTransferAbort({ port: wire.port, targetOrigin: PEER, allowedOrigins: [PEER] });
	try {
		wire.send({ ...envelopeFor('session'), kind: 'ready', maxEntries: 1, maxEntryBytes: 1 });
		wire.send({ ...envelopeFor('session'), kind: 'abort', reason: 'foreign' }, 'https://foreign.example');
		wire.send({ ...envelopeFor('session'), protocolVersion: 2, kind: 'abort', reason: 'old protocol' });
		wire.send({ ...envelopeFor('other'), kind: 'abort', reason: 'other session' });
		assert.equal(watch.signal.aborted, false);
		const inbound: ProjectTransferInboundMessage[] = [];
		const stop = watch.port.subscribe((message) => inbound.push(message));
		assert.equal((inbound[0]?.data as { kind: string }).kind, 'ready');
		wire.abort();
		assert.equal(watch.signal.aborted, true);
		assert.equal((watch.signal.reason as { code: string }).code, 'PEER_ABORTED');
		stop();
	} finally { watch.close(); }
});

function createWire() {
	const listeners = new Set<(message: ProjectTransferInboundMessage) => void>();
	const send = (data: unknown, origin = PEER) => {
		for (const listener of listeners) listener({ origin, data });
	};
	const port: ProjectTransferPort = {
		post: () => undefined,
		subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
	};
	return { port, send, abort: () => send({ ...envelopeFor(''), kind: 'abort', reason: 'Peer closed the transfer.' }) };
}

async function tick(): Promise<void> { await new Promise<void>((resolve) => setImmediate(resolve)); }
