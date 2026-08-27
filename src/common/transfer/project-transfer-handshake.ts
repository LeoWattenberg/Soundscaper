/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The two roles of the cross-origin project transfer handshake. Soundscaper
 * and Framescaper each read their own IndexedDB and OPFS first-party, so a
 * project only crosses between the origins as a .scape archive carried by a
 * top-level context of the receiving origin — in practice a popup, the one
 * cross-origin window that still gets ordinary first-party storage.
 *
 * Nothing here touches the DOM. Both roles are driven through an injected
 * port, so a fake channel exercises the same code the real window plumbing
 * runs, and the wiring slice owns window.open and the message listener.
 *
 * The shape is the one chunk-stream.js established for bounded port traffic:
 * one item in flight, an acknowledgement that correlates by id and monotonic
 * sequence, hard ceilings on count and bytes, and a refusal of shared memory.
 */

import {
	type ProjectTransferChannel,
	type ProjectTransferChannelOptions,
	envelopeFor,
	expectProjectTransferKind,
	normalizeProjectTransferChannel,
	openProjectTransferChannel,
	runProjectTransferRole,
} from './project-transfer-handshake-channel.ts';
import {
	PROJECT_TRANSFER_MAX_ENTRIES,
	PROJECT_TRANSFER_MAX_ENTRY_BYTES,
	PROJECT_TRANSFER_PROTOCOL_VERSION,
	type ProjectTransferEntry,
	type ProjectTransferOutcome,
	type ProjectTransferReport,
	type ProjectTransferStatus,
	admitProjectTransferEntry,
	admitProjectTransferId,
	admitProjectTransferInteger,
	describeProjectTransferReason,
	projectTransferError,
} from './project-transfer-handshake-wire.ts';

export * from './project-transfer-handshake-wire.ts';
export {
	PROJECT_TRANSFER_MAX_TIMEOUT_MILLISECONDS,
} from './project-transfer-handshake-channel.ts';
export type {
	ProjectTransferChannelOptions,
	ProjectTransferClock,
	ProjectTransferInboundMessage,
	ProjectTransferPort,
} from './project-transfer-handshake-channel.ts';

export interface ProjectTransferSenderOptions extends ProjectTransferChannelOptions {
	readonly entries: readonly ProjectTransferEntry[];
}

export interface ProjectTransferReceiverOptions extends ProjectTransferChannelOptions {
	readonly sessionId: string;
	readonly acceptEntry: (entry: ProjectTransferEntry) => Promise<void> | void;
	readonly maxEntries?: number;
	readonly maxEntryBytes?: number;
}

/**
 * Offers every entry to the peer origin, one at a time, and resolves with the
 * receiver's final per-entry report. A transfer that lands with failures
 * resolves and names them; only a protocol failure rejects.
 */
export async function sendProjectTransfer(
	options: ProjectTransferSenderOptions,
): Promise<ProjectTransferReport> {
	const settings = normalizeProjectTransferChannel(options);
	const entries = normalizeOfferedEntries(options?.entries);
	const channel = openProjectTransferChannel(settings);
	return runProjectTransferRole(channel, async () => {
		const ready = await expectProjectTransferKind(channel, 'ready');
		if (ready.protocolVersion !== PROJECT_TRANSFER_PROTOCOL_VERSION) {
			throw projectTransferError(
				'PROTOCOL_VERSION',
				`The peer announced project transfer protocol version ${ready.protocolVersion}; this build implements ${PROJECT_TRANSFER_PROTOCOL_VERSION}.`,
				'protocolVersion',
			);
		}
		channel.expectVersion(PROJECT_TRANSFER_PROTOCOL_VERSION);
		channel.expectSession(ready.sessionId);
		assertOfferFitsPeer(entries, ready.maxEntries, ready.maxEntryBytes);
		channel.send({ ...envelopeFor(ready.sessionId), kind: 'begin', entryCount: entries.length });
		const acknowledged: ProjectTransferOutcome[] = [];
		for (const [index, entry] of entries.entries()) {
			acknowledged.push(await sendOneEntry(channel, ready.sessionId, entry, index + 1));
		}
		channel.send({ ...envelopeFor(ready.sessionId), kind: 'complete' });
		const report = await expectProjectTransferKind(channel, 'report');
		return reconcileFinalReport(ready.sessionId, acknowledged, report.outcomes);
	});
}

/**
 * Announces readiness on the peer's channel, stores whatever the sender
 * offers through `acceptEntry`, and hands the sender a final report of what
 * actually landed. An entry `acceptEntry` rejects is one failed entry, not a
 * failed transfer.
 */
export async function receiveProjectTransfer(
	options: ProjectTransferReceiverOptions,
): Promise<ProjectTransferReport> {
	const settings = normalizeProjectTransferChannel(options);
	const sessionId = admitProjectTransferId(options?.sessionId, 'sessionId');
	const acceptEntry = options?.acceptEntry;
	if (typeof acceptEntry !== 'function') {
		throw new TypeError('A project transfer receiver requires an acceptEntry function.');
	}
	const maxEntries = admitProjectTransferInteger(
		options.maxEntries ?? PROJECT_TRANSFER_MAX_ENTRIES, 'maxEntries', 1, PROJECT_TRANSFER_MAX_ENTRIES,
	);
	const maxEntryBytes = admitProjectTransferInteger(
		options.maxEntryBytes ?? PROJECT_TRANSFER_MAX_ENTRY_BYTES, 'maxEntryBytes', 1, PROJECT_TRANSFER_MAX_ENTRY_BYTES,
	);
	const channel = openProjectTransferChannel(settings);
	channel.expectVersion(PROJECT_TRANSFER_PROTOCOL_VERSION);
	channel.expectSession(sessionId);
	return runProjectTransferRole(channel, async () => {
		channel.send({ ...envelopeFor(sessionId), kind: 'ready', maxEntries, maxEntryBytes });
		const begin = await expectProjectTransferKind(channel, 'begin');
		if (begin.entryCount > maxEntries) {
			throw projectTransferError(
				'TOO_MANY_ENTRIES',
				`The peer offered ${begin.entryCount} entries, over the ${maxEntries} announced.`,
				'entryCount',
			);
		}
		const outcomes: ProjectTransferOutcome[] = [];
		const seen = new Set<string>();
		for (let index = 0; index < begin.entryCount; index += 1) {
			outcomes.push(await receiveOneEntry({
				channel, sessionId, sequence: index + 1, seen, maxEntryBytes, acceptEntry,
			}));
		}
		await expectProjectTransferKind(channel, 'complete');
		channel.send({ ...envelopeFor(sessionId), kind: 'report', outcomes });
		return buildTransferReport(sessionId, outcomes);
	});
}

async function sendOneEntry(
	channel: ProjectTransferChannel,
	sessionId: string,
	entry: ProjectTransferEntry,
	sequence: number,
): Promise<ProjectTransferOutcome> {
	channel.send({
		...envelopeFor(sessionId),
		kind: 'entry',
		sequence,
		entryId: entry.entryId,
		name: entry.name,
		byteLength: entry.byteLength,
		payload: entry.payload,
	});
	const ack = await expectProjectTransferKind(channel, 'ack');
	// One entry is in flight at a time, so the only acknowledgement that can
	// be answered is this one. A repeat, a skip or a stale id means the peer
	// is not tracking the same transfer and nothing further can be trusted.
	if (ack.sequence !== sequence || ack.entryId !== entry.entryId) {
		throw projectTransferError(
			'SEQUENCE_MISMATCH',
			`Expected an acknowledgement of entry ${sequence} (${entry.entryId}), received ${ack.sequence} (${ack.entryId}).`,
			'sequence',
		);
	}
	return outcomeFor(entry, ack.status, ack.reason);
}

interface ReceiveEntryContext {
	readonly channel: ProjectTransferChannel;
	readonly sessionId: string;
	readonly sequence: number;
	readonly seen: Set<string>;
	readonly maxEntryBytes: number;
	readonly acceptEntry: (entry: ProjectTransferEntry) => Promise<void> | void;
}

async function receiveOneEntry(context: ReceiveEntryContext): Promise<ProjectTransferOutcome> {
	const { channel, sessionId, sequence, seen, maxEntryBytes } = context;
	const message = await expectProjectTransferKind(channel, 'entry');
	if (message.sequence !== sequence) {
		throw projectTransferError(
			'SEQUENCE_MISMATCH',
			`Expected entry ${sequence}, received ${message.sequence}.`,
			'sequence',
		);
	}
	if (seen.has(message.entryId)) {
		throw projectTransferError('INVALID_FIELD', `Entry ${message.entryId} arrived twice.`, 'entryId');
	}
	seen.add(message.entryId);
	if (message.byteLength > maxEntryBytes) {
		throw projectTransferError(
			'PAYLOAD_TOO_LARGE',
			`Entry ${message.entryId} is ${message.byteLength} bytes, over the ${maxEntryBytes} announced.`,
			'byteLength',
		);
	}
	const entry: ProjectTransferEntry = Object.freeze({
		entryId: message.entryId,
		name: message.name,
		byteLength: message.byteLength,
		payload: message.payload,
	});
	let status: ProjectTransferStatus = 'stored';
	let reason = '';
	try {
		await context.acceptEntry(entry);
	} catch (error) {
		status = 'failed';
		reason = describeProjectTransferReason(error) || 'The entry could not be stored.';
	}
	channel.send({
		...envelopeFor(sessionId), kind: 'ack', sequence, entryId: entry.entryId, status, reason,
	});
	return outcomeFor(entry, status, reason);
}

function normalizeOfferedEntries(value: unknown): readonly ProjectTransferEntry[] {
	if (!Array.isArray(value)) throw new TypeError('A project transfer requires an array of entries.');
	if (value.length > PROJECT_TRANSFER_MAX_ENTRIES) {
		throw projectTransferError(
			'TOO_MANY_ENTRIES',
			`A transfer may offer at most ${PROJECT_TRANSFER_MAX_ENTRIES} entries, received ${value.length}.`,
			'entries',
		);
	}
	const entries: ProjectTransferEntry[] = [];
	const seen = new Set<string>();
	for (const held of value as readonly unknown[]) {
		const entry = admitProjectTransferEntry(held, PROJECT_TRANSFER_MAX_ENTRY_BYTES);
		if (seen.has(entry.entryId)) {
			throw projectTransferError('INVALID_FIELD', `Entry ${entry.entryId} is offered twice.`, 'entryId');
		}
		seen.add(entry.entryId);
		entries.push(entry);
	}
	return Object.freeze(entries);
}

function assertOfferFitsPeer(
	entries: readonly ProjectTransferEntry[],
	maxEntries: number,
	maxEntryBytes: number,
): void {
	if (entries.length > maxEntries) {
		throw projectTransferError(
			'TOO_MANY_ENTRIES',
			`The peer accepts ${maxEntries} entries; this transfer offers ${entries.length}.`,
			'entries',
		);
	}
	for (const entry of entries) {
		if (entry.byteLength > maxEntryBytes) {
			throw projectTransferError(
				'PAYLOAD_TOO_LARGE',
				`Entry ${entry.entryId} is ${entry.byteLength} bytes; the peer accepts ${maxEntryBytes}.`,
				'byteLength',
			);
		}
	}
}

/**
 * The receiver's report is the last word on what landed, but it may not
 * rewrite the transfer: it has to cover exactly the entries that were
 * acknowledged, in order, with the outcomes it already gave for them.
 */
function reconcileFinalReport(
	sessionId: string,
	acknowledged: readonly ProjectTransferOutcome[],
	reported: readonly ProjectTransferOutcome[],
): ProjectTransferReport {
	if (reported.length !== acknowledged.length) {
		throw projectTransferError(
			'INVALID_FIELD',
			`The final report covers ${reported.length} entries, not the ${acknowledged.length} that were sent.`,
			'outcomes',
		);
	}
	const entries = acknowledged.map((acked, index) => {
		const outcome = reported[index];
		if (outcome.entryId !== acked.entryId) {
			throw projectTransferError(
				'SEQUENCE_MISMATCH',
				`The final report names ${outcome.entryId} where entry ${index + 1} was ${acked.entryId}.`,
				'outcomes',
			);
		}
		if (outcome.status !== acked.status) {
			throw projectTransferError(
				'INVALID_FIELD',
				`The final report reports ${acked.entryId} as ${outcome.status} after acknowledging it as ${acked.status}.`,
				'outcomes',
			);
		}
		return Object.freeze({ ...acked, reason: outcome.reason });
	});
	return buildTransferReport(sessionId, entries);
}

function buildTransferReport(
	sessionId: string,
	entries: readonly ProjectTransferOutcome[],
): ProjectTransferReport {
	let storedCount = 0;
	for (const entry of entries) {
		if (entry.status === 'stored') storedCount += 1;
	}
	return Object.freeze({
		sessionId,
		protocolVersion: PROJECT_TRANSFER_PROTOCOL_VERSION,
		entryCount: entries.length,
		storedCount,
		failedCount: entries.length - storedCount,
		entries: Object.freeze([...entries]),
	});
}

function outcomeFor(
	entry: ProjectTransferEntry,
	status: ProjectTransferStatus,
	reason: string,
): ProjectTransferOutcome {
	return Object.freeze({
		entryId: entry.entryId,
		name: entry.name,
		byteLength: entry.byteLength,
		status,
		reason,
	});
}
