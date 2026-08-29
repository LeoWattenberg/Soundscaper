/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The wire half of the cross-origin project transfer handshake: the vocabulary
 * a Soundscaper origin and a Framescaper origin agree on while .scape archives
 * cross between them, and the closed-schema validator that stands between the
 * two. It is separated from the role drivers in project-transfer-handshake.ts
 * because a peer window's first message reaches this validator before any
 * transfer state exists to corrupt.
 *
 * Browser storage is partitioned per top-level site, so archives can only
 * cross inside a top-level context the peer origin controls. That makes the
 * peer's origin the only authority either side has: a message is admitted
 * because it arrived from an allowlisted origin, never because it claimed one.
 */

import {
	admitCrossProductHandoffReportSidecar,
	type CrossProductHandoffReportSidecarV1,
} from './cross-product-handoff-report-sidecar.ts';

export const PROJECT_TRANSFER_PROTOCOL_ID = 'kw-project-transfer';
export const PROJECT_TRANSFER_PROTOCOL_VERSION = 2;
export const PROJECT_TRANSFER_MAX_PROTOCOL_VERSION = 0xffff;
export const PROJECT_TRANSFER_MAX_ENTRIES = 512;
export const PROJECT_TRANSFER_MAX_ENTRY_BYTES = 256 * 1024 * 1024;
export const PROJECT_TRANSFER_MAX_ID_LENGTH = 256;
export const PROJECT_TRANSFER_MAX_TEXT_LENGTH = 512;
export const PROJECT_TRANSFER_DEFAULT_TIMEOUT_MILLISECONDS = 30_000;
export const PROJECT_TRANSFER_MAX_PENDING_MESSAGES = 8;

export const PROJECT_TRANSFER_ERROR_CODES = Object.freeze([
	'ABORTED', 'INVALID_FIELD', 'INVALID_ORIGIN', 'PAYLOAD_TOO_LARGE', 'PEER_ABORTED',
	'PROTOCOL_VERSION', 'QUEUE_OVERFLOW', 'SEQUENCE_MISMATCH', 'SESSION_MISMATCH',
	'SHARED_MEMORY_FORBIDDEN', 'TIMEOUT', 'TOO_MANY_ENTRIES', 'UNEXPECTED_MESSAGE',
	'UNKNOWN_KEY', 'UNKNOWN_KIND',
] as const);

export type ProjectTransferErrorCode = (typeof PROJECT_TRANSFER_ERROR_CODES)[number];
export type ProjectTransferStatus = 'stored' | 'failed';

export class ProjectTransferProtocolError extends Error {
	readonly code: ProjectTransferErrorCode;
	readonly field: string;

	constructor(code: ProjectTransferErrorCode, message: string, field = '') {
		super(message);
		this.name = 'ProjectTransferProtocolError';
		this.code = code;
		this.field = field;
	}
}

export function projectTransferError(
	code: ProjectTransferErrorCode,
	message: string,
	field = '',
): ProjectTransferProtocolError {
	return new ProjectTransferProtocolError(code, message, field);
}

/** Keeps a thrown cause typed, so no close path has to discard why it closed. */
export function asProjectTransferError(error: unknown): ProjectTransferProtocolError {
	if (error instanceof ProjectTransferProtocolError) return error;
	return projectTransferError('INVALID_FIELD', describeProjectTransferValue(error));
}

/** One archive on the wire. The bundle slice supplies these structurally. */
export interface ProjectTransferEntry {
	readonly entryId: string;
	readonly name: string;
	readonly byteLength: number;
	readonly payload: Uint8Array;
	readonly conversionReportSidecar: Readonly<CrossProductHandoffReportSidecarV1> | null;
}

export interface ProjectTransferOutcome {
	readonly entryId: string;
	readonly name: string;
	readonly byteLength: number;
	readonly status: ProjectTransferStatus;
	readonly reason: string;
}

export interface ProjectTransferReport {
	readonly sessionId: string;
	readonly protocolVersion: number;
	readonly entryCount: number;
	readonly storedCount: number;
	readonly failedCount: number;
	readonly entries: readonly ProjectTransferOutcome[];
}

type Envelope = Readonly<{
	protocol: typeof PROJECT_TRANSFER_PROTOCOL_ID;
	protocolVersion: number;
	sessionId: string;
}>;

export type ProjectTransferReadyMessage = Envelope
	& Readonly<{ kind: 'ready'; maxEntries: number; maxEntryBytes: number }>;
export type ProjectTransferBeginMessage = Envelope
	& Readonly<{ kind: 'begin'; entryCount: number }>;
export type ProjectTransferEntryMessage = Envelope & Readonly<{
	kind: 'entry'; sequence: number; entryId: string;
	name: string; byteLength: number; payload: Uint8Array;
	conversionReportSidecar: Readonly<CrossProductHandoffReportSidecarV1> | null;
}>;
export type ProjectTransferAckMessage = Envelope & Readonly<{
	kind: 'ack'; sequence: number; entryId: string;
	status: ProjectTransferStatus; reason: string;
}>;
export type ProjectTransferCompleteMessage = Envelope & Readonly<{ kind: 'complete' }>;
export type ProjectTransferReportMessage = Envelope
	& Readonly<{ kind: 'report'; outcomes: readonly ProjectTransferOutcome[] }>;
export type ProjectTransferAbortMessage = Envelope
	& Readonly<{ kind: 'abort'; reason: string }>;

export type ProjectTransferMessage =
	| ProjectTransferReadyMessage
	| ProjectTransferBeginMessage
	| ProjectTransferEntryMessage
	| ProjectTransferAckMessage
	| ProjectTransferCompleteMessage
	| ProjectTransferReportMessage
	| ProjectTransferAbortMessage;

export type ProjectTransferMessageKind = ProjectTransferMessage['kind'];

const MESSAGE_KEYS = Object.freeze({
	ready: ['kind', 'maxEntries', 'maxEntryBytes', 'protocol', 'protocolVersion', 'sessionId'],
	begin: ['entryCount', 'kind', 'protocol', 'protocolVersion', 'sessionId'],
	entry: [
		'byteLength', 'conversionReportSidecar', 'entryId', 'kind', 'name', 'payload',
		'protocol', 'protocolVersion', 'sequence', 'sessionId',
	],
	ack: ['entryId', 'kind', 'protocol', 'protocolVersion', 'reason', 'sequence', 'sessionId', 'status'],
	complete: ['kind', 'protocol', 'protocolVersion', 'sessionId'],
	report: ['kind', 'outcomes', 'protocol', 'protocolVersion', 'sessionId'],
	abort: ['kind', 'protocol', 'protocolVersion', 'reason', 'sessionId'],
} as const);

const OUTCOME_KEYS = Object.freeze(['byteLength', 'entryId', 'name', 'reason', 'status']);
const ENTRY_KEYS = Object.freeze([
	'byteLength', 'conversionReportSidecar', 'entryId', 'name', 'payload',
]);

const MESSAGE_KEY_SETS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze(
	Object.fromEntries(
		Object.entries(MESSAGE_KEYS).map(([kind, keys]) => [kind, new Set<string>(keys)]),
	),
);

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/u;
const CONTROL_CHARACTERS_GLOBAL = /[\u0000-\u001f\u007f]/gu;

/**
 * Admits one inbound wire message. A value that does not carry this protocol's
 * tag as a plain data property is not a peer message at all — extensions, dev
 * tooling and the framework itself all post into the same window — so it is
 * refused by returning null for the caller to drop in silence. Once the tag
 * matches, the peer is speaking to us and every deviation from the closed
 * schema below is a named protocol failure.
 */
export function admitProjectTransferMessage(value: unknown): ProjectTransferMessage | null {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return null;
	const record = value as Readonly<Record<string, unknown>>;
	if (peekProjectTransferField(record, 'protocol') !== PROJECT_TRANSFER_PROTOCOL_ID) return null;
	const kind = requireProjectTransferField(record, 'kind');
	if (!isMessageKind(kind)) {
		throw projectTransferError('UNKNOWN_KIND', `Unknown transfer message kind ${describeProjectTransferValue(kind)}.`, 'kind');
	}
	assertClosedKeySet(record, MESSAGE_KEY_SETS[kind]);
	const fields: Record<string, unknown> = {
		protocol: PROJECT_TRANSFER_PROTOCOL_ID,
		kind,
		// The version is bounded here but never compared here: refusing a
		// version this build does not implement is the role's decision, and
		// the sender must be able to read the number it is refusing.
		protocolVersion: admitProjectTransferInteger(
			requireProjectTransferField(record, 'protocolVersion'),
			'protocolVersion', 1, PROJECT_TRANSFER_MAX_PROTOCOL_VERSION,
		),
		// An abort may be raised before a session exists, so only that kind may
		// name an empty session; every other kind must be inside one.
		sessionId: admitSessionId(requireProjectTransferField(record, 'sessionId'), kind === 'abort'),
	};
	admitMessageBody(kind, record, fields);
	return Object.freeze(fields) as unknown as ProjectTransferMessage;
}

function admitMessageBody(
	kind: ProjectTransferMessageKind,
	record: Readonly<Record<string, unknown>>,
	fields: Record<string, unknown>,
): void {
	const read = (key: string): unknown => requireProjectTransferField(record, key);
	if (kind === 'ready') {
		fields.maxEntries = admitProjectTransferInteger(read('maxEntries'), 'maxEntries', 1, PROJECT_TRANSFER_MAX_ENTRIES);
		fields.maxEntryBytes = admitProjectTransferInteger(read('maxEntryBytes'), 'maxEntryBytes', 1, PROJECT_TRANSFER_MAX_ENTRY_BYTES);
	} else if (kind === 'begin') {
		fields.entryCount = admitProjectTransferInteger(read('entryCount'), 'entryCount', 0, PROJECT_TRANSFER_MAX_ENTRIES);
	} else if (kind === 'entry') {
		fields.sequence = admitSequence(read('sequence'));
		const entryId = admitProjectTransferId(read('entryId'), 'entryId');
		fields.entryId = entryId;
		fields.name = admitProjectTransferText(read('name'), 'name');
		const byteLength = admitProjectTransferInteger(read('byteLength'), 'byteLength', 0, PROJECT_TRANSFER_MAX_ENTRY_BYTES);
		fields.byteLength = byteLength;
		const payload = admitProjectTransferPayload(read('payload'), byteLength, 'payload');
		fields.payload = payload;
		fields.conversionReportSidecar = admitWireConversionReportSidecar(
			read('conversionReportSidecar'), entryId, payload,
		);
	} else if (kind === 'ack') {
		fields.sequence = admitSequence(read('sequence'));
		fields.entryId = admitProjectTransferId(read('entryId'), 'entryId');
		fields.status = admitStatus(read('status'));
		fields.reason = admitProjectTransferText(read('reason'), 'reason');
	} else if (kind === 'report') {
		fields.outcomes = admitOutcomes(read('outcomes'));
	} else if (kind === 'abort') {
		fields.reason = admitProjectTransferText(read('reason'), 'reason');
	}
}

/**
 * Admits one entry a caller offers for transfer. The payload must tightly
 * cover its own backing store: a view onto a larger buffer would carry every
 * unrelated byte of that buffer across the origin boundary when it is cloned.
 */
export function admitProjectTransferEntry(value: unknown, maximumBytes: number): ProjectTransferEntry {
	const record = asClosedRecord(value, 'transfer entry', ENTRY_KEYS);
	const entryId = admitProjectTransferId(record.entryId, 'entryId');
	const name = admitProjectTransferText(record.name, 'name');
	const byteLength = admitProjectTransferInteger(record.byteLength, 'byteLength', 0, PROJECT_TRANSFER_MAX_ENTRY_BYTES);
	if (byteLength > maximumBytes) {
		throw projectTransferError('PAYLOAD_TOO_LARGE', `Entry ${entryId} is ${byteLength} bytes, over the ${maximumBytes} byte limit.`, 'byteLength');
	}
	const payload = admitProjectTransferPayload(record.payload, byteLength, 'payload');
	return Object.freeze({
		entryId,
		name,
		byteLength,
		payload,
		conversionReportSidecar: admitWireConversionReportSidecar(
			record.conversionReportSidecar, entryId, payload,
		),
	});
}

function admitWireConversionReportSidecar(
	value: unknown,
	entryId: string,
	payload: Uint8Array,
): Readonly<CrossProductHandoffReportSidecarV1> | null {
	if (value === null) return null;
	try {
		return admitCrossProductHandoffReportSidecar(value, { entryId, archive: payload });
	} catch (error) {
		throw projectTransferError(
			'INVALID_FIELD',
			`conversionReportSidecar is invalid: ${describeProjectTransferReason(error)}`,
			'conversionReportSidecar',
		);
	}
}

export function admitProjectTransferPayload(
	value: unknown,
	byteLength: number,
	field: string,
): Uint8Array {
	if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
		throw projectTransferError('INVALID_FIELD', `${field} must be an ordinary Uint8Array.`, field);
	}
	const buffer: ArrayBufferLike = value.buffer;
	if (typeof SharedArrayBuffer !== 'undefined' && buffer instanceof SharedArrayBuffer) {
		throw projectTransferError('SHARED_MEMORY_FORBIDDEN', `${field} must not be backed by SharedArrayBuffer.`, field);
	}
	if (!(buffer instanceof ArrayBuffer)) {
		throw projectTransferError('INVALID_FIELD', `${field} must be backed by an ordinary ArrayBuffer.`, field);
	}
	if (value.byteOffset !== 0 || buffer.byteLength !== value.byteLength) {
		throw projectTransferError('INVALID_FIELD', `${field} must tightly cover its backing buffer.`, field);
	}
	if (value.byteLength > PROJECT_TRANSFER_MAX_ENTRY_BYTES) {
		throw projectTransferError('PAYLOAD_TOO_LARGE', `${field} exceeds ${PROJECT_TRANSFER_MAX_ENTRY_BYTES} bytes.`, field);
	}
	if (value.byteLength !== byteLength) {
		throw projectTransferError('INVALID_FIELD', `${field} holds ${value.byteLength} bytes but declares ${byteLength}.`, field);
	}
	return value;
}

function admitOutcomes(value: unknown): readonly ProjectTransferOutcome[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw projectTransferError('INVALID_FIELD', 'outcomes must be an ordinary array.', 'outcomes');
	}
	if (value.length > PROJECT_TRANSFER_MAX_ENTRIES) {
		throw projectTransferError('TOO_MANY_ENTRIES', `outcomes may not exceed ${PROJECT_TRANSFER_MAX_ENTRIES} entries.`, 'outcomes');
	}
	const outcomes: ProjectTransferOutcome[] = [];
	for (const [index, held] of (value as readonly unknown[]).entries()) {
		const record = asClosedRecord(held, `outcomes[${index}]`, OUTCOME_KEYS);
		outcomes.push(Object.freeze({
			entryId: admitProjectTransferId(record.entryId, `outcomes[${index}].entryId`),
			name: admitProjectTransferText(record.name, `outcomes[${index}].name`),
			byteLength: admitProjectTransferInteger(record.byteLength, `outcomes[${index}].byteLength`, 0, PROJECT_TRANSFER_MAX_ENTRY_BYTES),
			status: admitStatus(record.status),
			reason: admitProjectTransferText(record.reason, `outcomes[${index}].reason`),
		}));
	}
	return Object.freeze(outcomes);
}

/**
 * Normalizes one explicit peer origin. Wildcards are refused outright: a
 * transfer that posted archives to "*" would hand every project to whatever
 * document happens to hold the window.
 */
export function admitProjectTransferOrigin(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > PROJECT_TRANSFER_MAX_ID_LENGTH) {
		throw projectTransferError('INVALID_ORIGIN', `${field} must be an explicit origin string.`, field);
	}
	if (value === 'null' || value.includes('*')) {
		throw projectTransferError('INVALID_ORIGIN', `${field} must name one origin; wildcards are forbidden.`, field);
	}
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw projectTransferError('INVALID_ORIGIN', `${field} is not a parsable origin: ${describeProjectTransferValue(value)}.`, field);
	}
	if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
		throw projectTransferError('INVALID_ORIGIN', `${field} must use http or https.`, field);
	}
	if (parsed.origin !== value) {
		throw projectTransferError('INVALID_ORIGIN', `${field} must be exactly ${parsed.origin}, not ${describeProjectTransferValue(value)}.`, field);
	}
	return parsed.origin;
}

export function admitProjectTransferOrigins(value: unknown, field: string): ReadonlySet<string> {
	if (!Array.isArray(value) || value.length === 0) {
		throw projectTransferError('INVALID_ORIGIN', `${field} must list at least one permitted origin.`, field);
	}
	if (value.length > PROJECT_TRANSFER_MAX_ENTRIES) {
		throw projectTransferError('INVALID_ORIGIN', `${field} lists too many origins.`, field);
	}
	const origins = new Set<string>();
	for (const [index, held] of (value as readonly unknown[]).entries()) {
		origins.add(admitProjectTransferOrigin(held, `${field}[${index}]`));
	}
	return origins;
}

export function admitProjectTransferId(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > PROJECT_TRANSFER_MAX_ID_LENGTH
		|| value !== value.trim() || CONTROL_CHARACTERS.test(value)) {
		throw projectTransferError('INVALID_FIELD', `${field} must be a trimmed, printable identifier of 1 to ${PROJECT_TRANSFER_MAX_ID_LENGTH} characters.`, field);
	}
	return value;
}

export function admitProjectTransferText(value: unknown, field: string): string {
	if (typeof value !== 'string' || value.length > PROJECT_TRANSFER_MAX_TEXT_LENGTH || CONTROL_CHARACTERS.test(value)) {
		throw projectTransferError('INVALID_FIELD', `${field} must be printable text of at most ${PROJECT_TRANSFER_MAX_TEXT_LENGTH} characters.`, field);
	}
	return value;
}

export function admitProjectTransferInteger(
	value: unknown,
	field: string,
	minimum: number,
	maximum: number,
): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw projectTransferError('INVALID_FIELD', `${field} must be a safe integer in [${minimum}, ${maximum}], received ${describeProjectTransferValue(value)}.`, field);
	}
	return value;
}

/** Truncates a rejection cause to something the peer is allowed to be told. */
export function describeProjectTransferReason(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	const printable = message.replace(CONTROL_CHARACTERS_GLOBAL, ' ').trim();
	return printable.length > PROJECT_TRANSFER_MAX_TEXT_LENGTH
		? printable.slice(0, PROJECT_TRANSFER_MAX_TEXT_LENGTH)
		: printable;
}

export function describeProjectTransferValue(value: unknown): string {
	if (typeof value === 'string') return JSON.stringify(value);
	if (typeof value === 'object' && value !== null) return Object.prototype.toString.call(value);
	return String(value);
}

function admitSequence(value: unknown): number {
	return admitProjectTransferInteger(value, 'sequence', 1, PROJECT_TRANSFER_MAX_ENTRIES);
}

function admitStatus(value: unknown): ProjectTransferStatus {
	if (value !== 'stored' && value !== 'failed') {
		throw projectTransferError('INVALID_FIELD', `status must be "stored" or "failed", received ${describeProjectTransferValue(value)}.`, 'status');
	}
	return value;
}

function admitSessionId(value: unknown, allowUnbound: boolean): string {
	if (allowUnbound && value === '') return '';
	return admitProjectTransferId(value, 'sessionId');
}

function asClosedRecord(
	value: unknown,
	subject: string,
	keys: readonly string[],
): Readonly<Record<string, unknown>> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw projectTransferError('INVALID_FIELD', `A ${subject} must be a plain object, received ${describeProjectTransferValue(value)}.`, subject);
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw projectTransferError('INVALID_FIELD', `A ${subject} must not carry a class prototype.`, subject);
	}
	const record = value as Readonly<Record<string, unknown>>;
	assertClosedKeySet(record, new Set(keys));
	const fields: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) fields[key] = requireProjectTransferField(record, key);
	return fields;
}

function assertClosedKeySet(record: Readonly<Record<string, unknown>>, allowed: ReadonlySet<string>): void {
	if (Object.getOwnPropertySymbols(record).length > 0) {
		throw projectTransferError('UNKNOWN_KEY', 'A transfer message must not carry symbol keys.');
	}
	for (const key of Object.getOwnPropertyNames(record)) {
		if (!allowed.has(key)) {
			throw projectTransferError('UNKNOWN_KEY', `Unknown transfer message key ${JSON.stringify(key)}.`, key);
		}
	}
	for (const key of allowed) {
		if (!Object.hasOwn(record, key)) throw projectTransferError('INVALID_FIELD', `${key} is required.`, key);
	}
}

/** Reads a data property without invoking a peer-supplied accessor. */
export function peekProjectTransferField(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

export function requireProjectTransferField(record: Readonly<Record<string, unknown>>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor) throw projectTransferError('INVALID_FIELD', `${key} is required.`, key);
	if (!('value' in descriptor)) {
		throw projectTransferError('INVALID_FIELD', `${key} must be a data property, not an accessor.`, key);
	}
	return descriptor.value;
}

function isMessageKind(value: unknown): value is ProjectTransferMessageKind {
	return typeof value === 'string' && Object.hasOwn(MESSAGE_KEYS, value);
}
