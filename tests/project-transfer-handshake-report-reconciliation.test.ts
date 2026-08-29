/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_TRANSFER_PROTOCOL_ID,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	ProjectTransferProtocolError,
	sendProjectTransfer,
	type ProjectTransferInboundMessage,
	type ProjectTransferPort,
} from '../src/common/transfer/project-transfer-handshake.ts';

const SENDER_ORIGIN = 'https://soundscaper.org';
const RECEIVER_ORIGIN = 'https://framescaper.org';
const SESSION = 'report-reconciliation-session';
type WireMessage = Record<string, unknown>;

test('a final report cannot rewrite an acknowledged name, byte length, or reason', async () => {
	for (const replacement of [
		{ name: 'renamed.scape' },
		{ byteLength: 3 },
		{ reason: 'rewritten after acknowledgement' },
	]) {
		const { peer, sender } = senderAgainstPeer();
		peer.post({ ...envelope(), kind: 'ready', maxEntries: 4, maxEntryBytes: 1024 });
		await peer.next();
		await peer.next();
		peer.post({ ...envelope(), kind: 'ack', sequence: 1, entryId: 'alpha', status: 'stored', reason: '' });
		assert.equal((await peer.next()).kind, 'complete');
		peer.post({
			...envelope(), kind: 'report', outcomes: [{
				entryId: 'alpha', name: 'alpha.scape', byteLength: 4,
				status: 'stored', reason: '', ...replacement,
			}],
		});
		const failure = await failureFrom(sender);
		assert.equal(failure.code, 'INVALID_FIELD');
		assert.match(failure.message, /does not exactly match its acknowledgement/u);
	}
});

function senderAgainstPeer() {
	const senderListeners = new Set<(message: ProjectTransferInboundMessage) => void>();
	const receiverListeners = new Set<(message: ProjectTransferInboundMessage) => void>();
	const port = (
		origin: string,
		peerOrigin: string,
		own: Set<(message: ProjectTransferInboundMessage) => void>,
		other: Set<(message: ProjectTransferInboundMessage) => void>,
	): ProjectTransferPort => ({
		post(message, targetOrigin) {
			if (targetOrigin !== peerOrigin) return;
			queueMicrotask(() => other.forEach((listener) => listener({ origin, data: message })));
		},
		subscribe(listener) { own.add(listener); return () => own.delete(listener); },
	});
	const senderPort = port(SENDER_ORIGIN, RECEIVER_ORIGIN, senderListeners, receiverListeners);
	const receiverPort = port(RECEIVER_ORIGIN, SENDER_ORIGIN, receiverListeners, senderListeners);
	const peer = handDrivenPeer(receiverPort);
	const sender = sendProjectTransfer({
		port: senderPort, targetOrigin: RECEIVER_ORIGIN, allowedOrigins: [RECEIVER_ORIGIN],
		entries: [{
			entryId: 'alpha', name: 'alpha.scape', byteLength: 4,
			payload: Uint8Array.of(1, 1, 1, 1), conversionReportSidecar: null,
		}],
	});
	return { peer, sender };
}

function handDrivenPeer(port: ProjectTransferPort) {
	const inbox: WireMessage[] = [];
	let notify: (() => void) | null = null;
	port.subscribe((message) => {
		inbox.push(message.data as WireMessage);
		const waiting = notify;
		notify = null;
		waiting?.();
	});
	return {
		post: (message: WireMessage) => port.post(message, SENDER_ORIGIN),
		async next(): Promise<WireMessage> {
			while (inbox.length === 0) await new Promise<void>((resolve) => { notify = resolve; });
			return inbox.shift() as WireMessage;
		},
	};
}

function envelope() {
	return {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		sessionId: SESSION,
	};
}

async function failureFrom(promise: Promise<unknown>): Promise<ProjectTransferProtocolError> {
	const [result] = await Promise.allSettled([promise]);
	assert.equal(result.status, 'rejected');
	const reason = (result as PromiseRejectedResult).reason as unknown;
	assert.ok(reason instanceof ProjectTransferProtocolError);
	return reason;
}
