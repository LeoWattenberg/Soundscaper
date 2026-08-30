/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DeliveryReport } from '../delivery-report.ts';
import type {
	SoundscaperDeliveryCurrentAuthorityV1,
} from '../soundscaper-delivery-contract-v1.ts';

const CONNECT_TYPE = 'soundscaper-persistent-delivery-worker-connect-v1';
const PROTOCOL_VERSION = 1;
const HARD_MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;

interface RendererMessagePort {
	postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void;
	start(): void;
	close(): void;
	addEventListener?: (type: 'message' | 'close', listener: (event: unknown) => void) => void;
	removeEventListener?: (type: 'message' | 'close', listener: (event: unknown) => void) => void;
	on?: (type: 'message' | 'close', listener: (event: unknown) => void) => void;
	removeListener?: (type: 'message' | 'close', listener: (event: unknown) => void) => void;
}

interface RendererMessageChannel {
	readonly port1: RendererMessagePort;
	readonly port2: RendererMessagePort;
}

interface RendererScope {
	postMessage(
		message: Readonly<{ type: string; request: unknown }>,
		targetOrigin: string,
		transfer: readonly RendererMessagePort[],
	): void;
}

export interface SoundscaperPersistentDeliveryClaimCapability {
	readonly jobId: string;
	readonly claimId: string;
	readonly plan: unknown;
	progress(progress: number): Promise<unknown>;
	beginWrite(value: Readonly<{
		fileName: string; size?: number; maximumSize?: number; finalPrefixByteLength?: number;
	}>): Promise<unknown>;
	writeChunk(value: Readonly<{ writeId: string; offset: number; bytes: Uint8Array }>): Promise<unknown>;
	patchFinalPrefix(value: Readonly<{ writeId: string; bytes: Uint8Array }>): Promise<unknown>;
	finishWrite(writeId: string): Promise<unknown>;
	abortWrite(writeId: string): Promise<unknown>;
	complete(report: DeliveryReport): Promise<unknown>;
	fail(failureCode: string, report: DeliveryReport | null): Promise<unknown>;
	release(): Promise<unknown>;
}

export interface SoundscaperPersistentDeliveryPrivateTransport {
	claimNext(value: Readonly<{
		jobId: string;
		currentAuthority: SoundscaperDeliveryCurrentAuthorityV1;
	}>): Promise<SoundscaperPersistentDeliveryClaimCapability | null>;
}

export interface SoundscaperPersistentDeliveryPrivateTransportOptions {
	readonly scope?: RendererScope;
	readonly createMessageChannel?: () => RendererMessageChannel;
}

/**
 * Request an exact-job claim through the isolated preload and retain only its
 * transferred, owner-bound capability. No worker method is put on contextBridge.
 */
export function createSoundscaperPersistentDeliveryPrivateTransport(
	options: SoundscaperPersistentDeliveryPrivateTransportOptions = {},
): SoundscaperPersistentDeliveryPrivateTransport {
	const scope = options.scope ?? defaultScope();
	const createMessageChannel = options.createMessageChannel ?? defaultMessageChannel;
	if (!scope || typeof scope.postMessage !== 'function' || typeof createMessageChannel !== 'function') {
		throw new TypeError('Persistent delivery private transport is unavailable.');
	}
	return Object.freeze({
		async claimNext(value: Readonly<{
			jobId: string; currentAuthority: SoundscaperDeliveryCurrentAuthorityV1;
		}>): Promise<SoundscaperPersistentDeliveryClaimCapability | null> {
			const request = claimRequest(value);
			const channel = createMessageChannel();
			assertPort(channel?.port1);
			assertPort(channel?.port2);
			channel.port1.start();
			try {
				const message = await receiveAfter(channel.port1, () => {
					scope.postMessage(Object.freeze({ type: CONNECT_TYPE, request }), '*', [channel.port2]);
				});
				if (isUnavailable(message)) {
					channel.port1.close();
					return null;
				}
				const offer = claimOffer(message, request.jobId);
				return createCapability(channel.port1, offer);
			} catch (error) {
				channel.port1.close();
				channel.port2.close();
				throw error;
			}
		},
	});
}

interface ClaimOffer {
	readonly jobId: string;
	readonly claimId: string;
	readonly plan: unknown;
	readonly maximumChunkBytes: number;
}

function createCapability(
	port: RendererMessagePort,
	offer: ClaimOffer,
): SoundscaperPersistentDeliveryClaimCapability {
	let sequence = 0;
	let closed = false;
	let tail = Promise.resolve();
	const request = (operation: string, payload: unknown, transfer: readonly ArrayBuffer[] = []): Promise<unknown> => {
		if (closed) return Promise.reject(new Error('Persistent delivery claim port is closed.'));
		const selectedSequence = sequence;
		sequence += 1;
		const run = tail.then(async () => {
			const response = await receiveAfter(port, () => {
				port.postMessage(Object.freeze({
					protocolVersion: PROTOCOL_VERSION, type: 'request', sequence: selectedSequence,
					operation, payload,
				}), transfer);
			});
			return responseValue(response, selectedSequence);
		});
		tail = run.then(() => undefined, () => undefined);
		return run;
	};
	const settle = async (operation: string, payload: unknown): Promise<unknown> => {
		try { return await request(operation, payload); }
		finally { closed = true; port.close(); }
	};
	return Object.freeze({
		jobId: offer.jobId,
		claimId: offer.claimId,
		plan: offer.plan,
		progress: (progress: number) => request('progress', Object.freeze({ progress: fraction(progress) })),
		beginWrite: (value) => request('write-begin', writeDeclaration(value)),
		writeChunk: (value) => {
			const bytes = copiedChunk(value?.bytes, offer.maximumChunkBytes);
			return request('write-chunk', Object.freeze({
				writeId: opaqueId(value?.writeId, 'write'), offset: safeInteger(value?.offset, 'write offset'), bytes,
			}), [bytes.buffer]);
		},
		patchFinalPrefix: (value) => {
			const bytes = copiedChunk(value?.bytes, offer.maximumChunkBytes);
			return request('write-prefix', Object.freeze({ writeId: opaqueId(value?.writeId, 'write'), bytes }),
				[bytes.buffer]);
		},
		finishWrite: (writeId: string) => request('write-finish', Object.freeze({
			writeId: opaqueId(writeId, 'write'),
		})),
		abortWrite: (writeId: string) => request('write-abort', Object.freeze({
			writeId: opaqueId(writeId, 'write'),
		})),
		complete: (report: DeliveryReport) => settle('complete', Object.freeze({ report: safeClone(report) })),
		fail: (failureCode: string, report: DeliveryReport | null) => settle('fail', Object.freeze({
			failureCode: safeFailureCode(failureCode),
			report: report === null ? null : safeClone(report),
		})),
		release: () => settle('release', Object.freeze({})),
	});
}

function claimRequest(value: unknown): Readonly<{
	jobId: string; currentAuthority: SoundscaperDeliveryCurrentAuthorityV1;
}> {
	const row = exactRecord(value, ['jobId', 'currentAuthority'], 'claim request');
	const current = exactRecord(
		row.currentAuthority, ['projectIdentity', 'planFingerprint'], 'current authority',
	);
	const project = exactRecord(
		current.projectIdentity, ['projectId', 'projectRevision', 'projectSha256'], 'project identity',
	);
	return Object.freeze({
		jobId: opaqueId(row.jobId, 'job'),
		currentAuthority: Object.freeze({
			projectIdentity: Object.freeze({
				projectId: projectId(project.projectId),
				projectRevision: safeInteger(project.projectRevision, 'project revision'),
				projectSha256: digest(project.projectSha256),
			}),
			planFingerprint: digest(current.planFingerprint),
		}),
	});
}

function claimOffer(value: unknown, jobId: string): ClaimOffer {
	const row = exactRecord(
		value, ['protocolVersion', 'type', 'maximumChunkBytes', 'claim'], 'claim offer',
	);
	if (row.protocolVersion !== PROTOCOL_VERSION || row.type !== 'claimed') {
		throw new Error('Persistent delivery private transport returned no authenticated claim.');
	}
	const claim = allowedRecord(row.claim, ['jobId', 'claimId', 'description', 'plan'], 'claim');
	if (claim.jobId !== jobId) throw new Error('Persistent delivery private transport changed the exact job.');
	const maximumChunkBytes = safeInteger(row.maximumChunkBytes, 'maximum chunk bytes');
	if (maximumChunkBytes < 1 || maximumChunkBytes > HARD_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Persistent delivery private transport advertised an unsafe chunk size.');
	}
	return Object.freeze({
		jobId, claimId: opaqueId(claim.claimId, 'claim'), plan: safeClone(claim.plan), maximumChunkBytes,
	});
}

function isUnavailable(value: unknown): boolean {
	if (!value || typeof value !== 'object') return false;
	const row = value as Readonly<{ protocolVersion?: unknown; type?: unknown }>;
	if (row.protocolVersion !== PROTOCOL_VERSION) return false;
	if (row.type === 'closed') throw new Error('Persistent delivery private claim was refused.');
	return row.type === 'unavailable';
}

function responseValue(value: unknown, sequence: number): unknown {
	const row = allowedRecord(
		value, ['protocolVersion', 'type', 'sequence', 'ok', 'value', 'errorCode'], 'worker response',
	);
	if (row.protocolVersion !== PROTOCOL_VERSION || row.type !== 'response'
		|| safeInteger(row.sequence, 'response sequence') !== sequence) {
		throw new Error('Persistent delivery private response lost synchronization.');
	}
	if (row.ok !== true) {
		throw new Error(typeof row.errorCode === 'string' ? row.errorCode : 'operation-refused');
	}
	return safeClone(row.value);
}

function writeDeclaration(value: unknown): Readonly<Record<string, unknown>> {
	const row = allowedRecord(
		value, ['fileName', 'size', 'maximumSize', 'finalPrefixByteLength'], 'write declaration', ['fileName'],
	);
	return Object.freeze({
		fileName: leaf(row.fileName),
		...(row.size === undefined ? {} : { size: safeInteger(row.size, 'write size') }),
		...(row.maximumSize === undefined ? {} : { maximumSize: safeInteger(row.maximumSize, 'maximum write size') }),
		...(row.finalPrefixByteLength === undefined ? {}
			: { finalPrefixByteLength: safeInteger(row.finalPrefixByteLength, 'final prefix size') }),
	});
}

function receiveAfter(port: RendererMessagePort, send: () => void): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const message = (event: unknown) => { cleanup(); resolve(messageData(event)); };
		const close = () => { cleanup(); reject(new Error('Persistent delivery claim port closed unexpectedly.')); };
		const cleanup = () => {
			remove(port, 'message', message);
			remove(port, 'close', close);
		};
		add(port, 'message', message);
		add(port, 'close', close);
		try { send(); }
		catch (error) { cleanup(); reject(error); }
	});
}

function add(port: RendererMessagePort, type: 'message' | 'close', listener: (event: unknown) => void): void {
	if (typeof port.addEventListener === 'function') port.addEventListener(type, listener);
	else if (typeof port.on === 'function') port.on(type, listener);
	else throw new TypeError('Persistent delivery requires an evented MessagePort.');
}

function remove(port: RendererMessagePort, type: 'message' | 'close', listener: (event: unknown) => void): void {
	if (typeof port.removeEventListener === 'function') port.removeEventListener(type, listener);
	else port.removeListener?.(type, listener);
}

function messageData(value: unknown): unknown {
	return value && typeof value === 'object' && 'data' in value
		? (value as Readonly<{ data: unknown }>).data : value;
}

function assertPort(value: unknown): asserts value is RendererMessagePort {
	if (!value || typeof value !== 'object' || typeof (value as RendererMessagePort).postMessage !== 'function'
		|| typeof (value as RendererMessagePort).start !== 'function'
		|| typeof (value as RendererMessagePort).close !== 'function') {
		throw new TypeError('Persistent delivery private transport requires a MessagePort pair.');
	}
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	return allowedRecord(value, fields, label, fields);
}

function allowedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
	required: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Persistent delivery ${label} must be a record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| required.some((field) => !keys.includes(field))) {
		throw new TypeError(`Persistent delivery ${label} has unsupported or missing fields.`);
	}
	return value as Record<string, unknown>;
}

function safeClone<Value>(value: Value): Value {
	return structuredClone(value);
}

function copiedChunk(value: unknown, maximum: number): Uint8Array<ArrayBuffer> {
	if (!(value instanceof Uint8Array) || value.byteLength < 1 || value.byteLength > maximum) {
		throw new RangeError('Persistent delivery chunk is outside the negotiated bound.');
	}
	const copy = new Uint8Array(new ArrayBuffer(value.byteLength));
	copy.set(value);
	return copy;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`Persistent delivery ${label} id is invalid.`);
	}
	return value;
}

function digest(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) {
		throw new TypeError('Persistent delivery digest is invalid.');
	}
	return value;
}

function projectId(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('Persistent delivery project id is invalid.');
	}
	return value;
}

function safeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new RangeError(`Persistent delivery ${label} is invalid.`);
	}
	return Number(value);
}

function fraction(value: unknown): number {
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new RangeError('Persistent delivery progress is invalid.');
	}
	return value;
}

function leaf(value: unknown): string {
	if (typeof value !== 'string' || !value || value === '.' || value === '..'
		|| /[\0-\x1f/\\]/u.test(value) || new TextEncoder().encode(value).byteLength > 220) {
		throw new TypeError('Persistent delivery file name is invalid.');
	}
	return value;
}

function safeFailureCode(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('Persistent delivery failure code is invalid.');
	}
	return value;
}

function defaultScope(): RendererScope {
	const scope = globalThis.window as unknown as RendererScope | undefined;
	if (!scope) throw new Error('Persistent delivery private transport requires a renderer window.');
	return scope;
}

function defaultMessageChannel(): RendererMessageChannel {
	return new MessageChannel() as unknown as RendererMessageChannel;
}
