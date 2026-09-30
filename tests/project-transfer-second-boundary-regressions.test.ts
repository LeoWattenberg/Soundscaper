/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	PROJECT_TRANSFER_PROTOCOL_ID,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	type ProjectTransferEntry,
	type ProjectTransferInboundMessage,
} from '../src/common/transfer/project-transfer-handshake.ts';
import { importTransferArchiveFiles, type TransferArchiveSource } from
	'../src/common/transfer/transfer-manual-import.ts';
import {
	bufferTransferPort,
	observeTransferAcknowledgements,
} from '../src/common/transfer/transfer-send-watch.ts';
import type { TransferRuntime } from '../src/common/transfer/transfer-session.ts';
import {
	createWindowTransferPort,
	openTransferPopup,
	type TransferMessageEventLike,
} from '../src/common/transfer/transfer-window-port.ts';

const PEER_ORIGIN = 'https://framescaper.org';

function entry(entryId = 'entry-1'): ProjectTransferEntry {
	return {
		entryId,
		name: `${entryId}.sscape`,
		byteLength: 3,
		payload: new Uint8Array([1, 2, 3]),
		conversionReportSidecar: null,
	};
}

function entryMessage(sessionId: string, sequence = 1): Record<string, unknown> {
	return {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		sessionId,
		kind: 'entry',
		sequence,
		...entry(),
	};
}

function acknowledgement(
	sessionId: string,
	overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		sessionId,
		kind: 'ack',
		sequence: 1,
		entryId: 'entry-1',
		status: 'stored',
		reason: '',
		...overrides,
	};
}

function rawPort() {
	let receive: ((message: ProjectTransferInboundMessage) => void) | null = null;
	let subscriptions = 0;
	let stops = 0;
	return {
		port: {
			post: (_message: unknown, _targetOrigin: string): void => undefined,
			subscribe: (listener: (message: ProjectTransferInboundMessage) => void): (() => void) => {
				receive = listener;
				subscriptions += 1;
				return () => { stops += 1; };
			},
		},
		dispatch: (message: ProjectTransferInboundMessage): void => { receive?.(message); },
		counts: (): { subscriptions: number; stops: number } => ({ subscriptions, stops }),
	};
}

test('buffering the same raw transfer port twice returns one wrapper and one source subscription', () => {
	const raw = rawPort();
	const first = bufferTransferPort(raw.port);
	const second = bufferTransferPort(raw.port);
	assert.equal(second, first);
	assert.equal(raw.counts().subscriptions, 1);
});

test('a buffered transfer port refuses a dead second subscription after its source was stopped', () => {
	const raw = rawPort();
	const buffered = bufferTransferPort(raw.port);
	const stop = buffered.subscribe(() => undefined);
	stop();
	assert.throws(() => buffered.subscribe(() => undefined), /only be subscribed once/u);
	assert.equal(raw.counts().stops, 1);
});

test('an acknowledgement watch refuses duplicate offered entry identities', () => {
	const raw = rawPort();
	assert.throws(
		() => observeTransferAcknowledgements(raw.port, [entry('same'), entry('same')], [PEER_ORIGIN]),
		/duplicate entry id same/u,
	);
});

test('an acknowledgement belongs only to the session carried by the posted entry', () => {
	const raw = rawPort();
	const watch = observeTransferAcknowledgements(raw.port, [entry()], [PEER_ORIGIN]);
	watch.port.subscribe(() => undefined);
	raw.dispatch({ origin: PEER_ORIGIN, data: acknowledgement('session-right') });
	assert.deepEqual(watch.outcomes, []);
	assert.deepEqual(watch.unsent.map(({ entryId }) => entryId), ['entry-1']);
	watch.port.post(entryMessage('session-right'), PEER_ORIGIN);
	for (const sessionId of ['session-wrong', undefined]) {
		raw.dispatch({ origin: PEER_ORIGIN, data: acknowledgement('session-right', { sessionId }) });
	}
	assert.deepEqual(watch.outcomes, []);
	raw.dispatch({ origin: PEER_ORIGIN, data: acknowledgement('session-right') });
	assert.equal(watch.outcomes.length, 1);
	assert.equal(watch.sessionId, 'session-right');
});

test('an acknowledgement watch does not retain protocol-invalid peer claims', () => {
	const raw = rawPort();
	const watch = observeTransferAcknowledgements(raw.port, [entry()], [PEER_ORIGIN]);
	watch.port.subscribe(() => undefined);
	watch.port.post(entryMessage('session-1'), PEER_ORIGIN);
	for (const overrides of [
		{ status: 'maybe' },
		{ status: 'failed', reason: 'x'.repeat(513) },
		{ reason: 'control\u0000character' },
		{ protocol: 'obsolete-project-transfer' },
		{ protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION + 1 },
		{ sequence: 2 },
		{ unexpected: true },
	]) {
		raw.dispatch({ origin: PEER_ORIGIN, data: acknowledgement('session-1', overrides) });
	}
	assert.deepEqual(watch.outcomes, []);
	assert.deepEqual(watch.unanswered.map(({ entryId }) => entryId), ['entry-1']);
});

test('window transfer ports reject allowlist entries that are URLs rather than exact origins', () => {
	const peer = { postMessage: (_message: unknown, _targetOrigin: string): void => undefined };
	const listener = {
		addEventListener: (_type: 'message', _listener: (event: TransferMessageEventLike) => void): void => undefined,
		removeEventListener: (_type: 'message', _listener: (event: TransferMessageEventLike) => void): void => undefined,
	};
	for (const origin of [`${PEER_ORIGIN}/transfer/receive/`, 'HTTPS://Framescaper.ORG', 'relative']) {
		assert.throws(
			() => createWindowTransferPort({ peer, listener, allowedOrigins: [origin] }),
			/one exact origin/u,
		);
	}
});

test('popup admission parses its URL before asking the browser to open anything', () => {
	let opens = 0;
	const scope = {
		open: (): null => { opens += 1; return null; },
	};
	for (const url of ['https://', 'http://[invalid', 'https://user:secret@framescaper.org/transfer/receive/']) {
		assert.throws(() => openTransferPopup({ scope, url }), /absolute http\(s\) URL/u);
	}
	assert.equal(opens, 0);
});

test('manual file admission snapshots name and length before an asynchronous read can mutate them', async () => {
	let name = 'Mix.sscape';
	let byteLength = 3;
	const source: TransferArchiveSource = {
		get name() { return name; },
		get byteLength() { return byteLength; },
		read: async () => {
			name = 'renamed.txt';
			byteLength = 30_000;
			return new Uint8Array([1, 2, 3]);
		},
	};
	const seen: unknown[] = [];
	const result = await importTransferArchiveFiles({
		runtime: manualRuntime(seen),
		store: {} as never,
		files: [source],
	});
	assert.equal(result.completed, true);
	assert.deepEqual(seen, [{ projectId: undefined, title: 'Mix', byteLength: 3 }]);
});

test('manual import observes an abort that happens while a file read is pending', async () => {
	const controller = new AbortController();
	const reason = new Error('stop after read');
	const source: TransferArchiveSource = {
		name: 'Mix.sscape',
		byteLength: 3,
		read: async () => {
			controller.abort(reason);
			return new Uint8Array([1, 2, 3]);
		},
	};
	const seen: unknown[] = [];
	await assert.rejects(
		() => importTransferArchiveFiles({
			runtime: manualRuntime(seen),
			store: {} as never,
			files: [source],
			signal: controller.signal,
		}),
		(error: unknown) => error === reason,
	);
	assert.deepEqual(seen, []);
});

function manualRuntime(seen: unknown[]): TransferRuntime {
	const unavailable = (): never => { throw new Error('not used by this boundary test'); };
	return {
		exportProject: unavailable,
		inspectProject: unavailable,
		importProject: unavailable,
		exportBundle: unavailable,
		importBundle: async (request) => {
			for await (const value of request.entries) {
				const candidate = value as { projectId?: unknown; title?: unknown; bytes?: unknown };
				seen.push({
					projectId: candidate.projectId,
					title: candidate.title,
					byteLength: candidate.bytes instanceof Uint8Array ? candidate.bytes.byteLength : null,
				});
			}
			return Object.freeze({
				entries: Object.freeze([]), total: 0, imported: 0, skipped: 0, failed: 0,
				completed: true, stopped: null,
			});
		},
		sendTransfer: unavailable,
		receiveTransfer: unavailable,
	};
}
