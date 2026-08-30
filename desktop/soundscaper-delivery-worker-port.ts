/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	fingerprintSoundscaperDeliveryPlanV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import { validateSoundscaperPersistentAudioDeliveryPlanV1 } from '../src/common/editor/soundscaper-persistent-delivery-plan-v1.ts';
import { SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL } from './soundscaper-delivery-main-channels.ts';
import { SoundscaperDeliveryService } from './soundscaper-delivery-service.ts';

const PROTOCOL_VERSION = 1;
const MAXIMUM_CHUNK_BYTES = 4 * 1024 * 1024;
const MAXIMUM_CONTROL_BYTES = 1024 * 1024;

type Owner = object;
type Listener = (event: unknown, value?: unknown) => void;

interface MainPort {
	postMessage(value: unknown): void;
	start(): void;
	close(): void;
	on(type: 'message' | 'close', listener: (event: unknown) => void): void;
	removeListener(type: 'message' | 'close', listener: (event: unknown) => void): void;
}

interface Session {
	readonly owner: Owner;
	readonly port: MainPort;
	readonly claimId: string;
	readonly description: SoundscaperDeliveryDescriptionV1;
	readonly plan: ReturnType<typeof validateSoundscaperPersistentAudioDeliveryPlanV1>;
	readonly writes: Set<string>;
	sequence: number;
	activeOperation: Promise<void> | null;
	settled: boolean;
	closed: boolean;
	closing: Promise<void> | null;
	readonly onMessage: (event: unknown) => void;
	readonly onClose: () => void;
}

export interface SoundscaperDeliveryWorkerPortOptions {
	readonly on: (channel: string, listener: Listener) => void;
	readonly removeListener: (channel: string, listener: Listener) => void;
	readonly ownerFor: (event: unknown) => Owner;
	readonly service: SoundscaperDeliveryService;
	readonly admitCurrentAuthority: (
		owner: Owner,
		value: unknown,
	) => PromiseLike<SoundscaperDeliveryCurrentAuthorityV1> | SoundscaperDeliveryCurrentAuthorityV1;
	readonly completionAuthority: (
		owner: Owner,
		description: SoundscaperDeliveryDescriptionV1,
		plan: ReturnType<typeof validateSoundscaperPersistentAudioDeliveryPlanV1>,
	) => PromiseLike<SoundscaperDeliveryCurrentAuthorityV1> | SoundscaperDeliveryCurrentAuthorityV1;
}

/** Own every private renderer claim and its stop-and-wait transferred-port data plane. */
export function registerSoundscaperDeliveryWorkerPort(options: SoundscaperDeliveryWorkerPortOptions) {
	if (!options || typeof options.on !== 'function' || typeof options.removeListener !== 'function'
		|| typeof options.ownerFor !== 'function' || typeof options.admitCurrentAuthority !== 'function'
		|| typeof options.completionAuthority !== 'function') {
		throw new TypeError('Persistent delivery worker transport requires closed Electron seams.');
	}
	const sessions = new Set<Session>();
	const revokedOwners = new WeakSet<Owner>();
	let disposed = false;
	const listener: Listener = (event, value) => {
		const ports = portsFrom(event);
		if (ports.length !== 1) {
			for (const port of ports) safeClose(port);
			return;
		}
		try {
			void accept(options.ownerFor(event), ports[0]!, value).catch(() => {
				safeClosed(ports[0]!, 'claim-refused');
			});
		} catch { safeClosed(ports[0]!, 'owner-refused'); }
	};
	options.on(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL, listener);

	async function accept(owner: Owner, port: MainPort, value: unknown): Promise<void> {
		if (disposed || revokedOwners.has(owner)) {
			safeClosed(port, 'owner-revoked');
			return;
		}
		port.start();
		const request = exactRecord(value, ['jobId', 'currentAuthority'], 'claim request');
		assertPathless(request, 'claim request');
		const currentAuthority = await options.admitCurrentAuthority(owner, request.currentAuthority);
		if (disposed || revokedOwners.has(owner)) {
			safeClosed(port, 'owner-revoked');
			return;
		}
		const claim = await options.service.claimNext(currentAuthority, opaqueId(request.jobId, 'job'));
		if (!claim) {
			port.postMessage(Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: 'unavailable' }));
			safeClose(port);
			return;
		}
		if (disposed || revokedOwners.has(owner)) {
			await Promise.resolve(options.service.releaseClaim(claim.claimId)).catch(() => undefined);
			safeClosed(port, 'owner-revoked');
			return;
		}
		let plan: ReturnType<typeof validateSoundscaperPersistentAudioDeliveryPlanV1>;
		try {
			const revalidated = await options.admitCurrentAuthority(owner, request.currentAuthority);
			if (!sameCurrentAuthority(currentAuthority, revalidated)) {
				throw new Error('The renderer open-project authority changed while its claim was admitted.');
			}
			plan = validateSoundscaperPersistentAudioDeliveryPlanV1(claim.plan);
			if (fingerprintSoundscaperDeliveryPlanV1(plan).sha256 !== claim.description.planFingerprint) {
				throw new Error('The claimed persistent delivery plan is not exact.');
			}
		} catch (error) {
			await Promise.resolve(options.service.releaseClaim(claim.claimId)).catch(() => undefined);
			throw error;
		}
		const session: Session = {
			owner, port, claimId: claim.claimId, description: claim.description, plan,
			writes: new Set(), sequence: 0, activeOperation: null,
			settled: false, closed: false, closing: null,
			onMessage(event: unknown) {
				if (session.activeOperation) {
					void closeProtocol(session, 'backpressure-violation');
					return;
				}
				const operation = dispatch(session, messageData(event));
				session.activeOperation = operation;
				void operation.catch(() => closeProtocol(session, 'operation-refused')).finally(() => {
					if (session.activeOperation === operation) session.activeOperation = null;
					if (session.settled && !session.closed) void closeSession(session);
				});
			},
			onClose() { void closeSession(session); },
		};
		sessions.add(session);
		port.on('message', session.onMessage);
		port.on('close', session.onClose);
		assertPathless(Object.freeze({ ...claim, plan }), 'claim');
		port.postMessage(Object.freeze({
			protocolVersion: PROTOCOL_VERSION,
			type: 'claimed',
			maximumChunkBytes: MAXIMUM_CHUNK_BYTES,
			claim: Object.freeze({ ...claim, plan }),
		}));
	}

	async function dispatch(session: Session, value: unknown): Promise<void> {
		if (session.closed) return;
		const message = exactRecord(
			value, ['protocolVersion', 'type', 'sequence', 'operation', 'payload'], 'worker message',
		);
		if (message.protocolVersion !== PROTOCOL_VERSION || message.type !== 'request'
			|| safeInteger(message.sequence, 'sequence') !== session.sequence) {
			await closeProtocol(session, 'sequence-violation');
			return;
		}
		const operation = operationName(message.operation);
		if (operation !== 'write-chunk') boundedControl(message, 'worker request');
		const sequence = session.sequence;
		try {
			const result = await execute(session, operation, message.payload);
			if (session.closed) return;
			assertPathless(result, 'worker response');
			session.sequence += 1;
			session.port.postMessage(Object.freeze({
				protocolVersion: PROTOCOL_VERSION, type: 'response', sequence, ok: true, value: result,
			}));
		} catch {
			if (session.closed) return;
			session.sequence += 1;
			session.port.postMessage(Object.freeze({
				protocolVersion: PROTOCOL_VERSION, type: 'response', sequence, ok: false,
				errorCode: 'operation-refused',
			}));
		}
	}

	async function execute(session: Session, operation: Operation, value: unknown): Promise<unknown> {
		switch (operation) {
			case 'progress': {
				const request = exactRecord(value, ['progress'], 'progress');
				await options.service.updateProgress(session.claimId, fraction(request.progress));
				return true;
			}
			case 'write-begin': {
				const request = optionalRecord(
					value, ['fileName', 'size', 'maximumSize', 'finalPrefixByteLength'], 'write begin', ['fileName'],
				);
				const result = await options.service.beginWrite({
					claimId: session.claimId, fileName: leaf(request.fileName),
					...(request.size === undefined ? {} : { size: safeInteger(request.size, 'write size') }),
					...(request.maximumSize === undefined ? {}
						: { maximumSize: safeInteger(request.maximumSize, 'maximum write size') }),
					...(request.finalPrefixByteLength === undefined ? {}
						: { finalPrefixByteLength: safeInteger(request.finalPrefixByteLength, 'final prefix size') }),
				});
				session.writes.add(result.writeId);
				return result;
			}
			case 'write-chunk': {
				const request = exactRecord(value, ['writeId', 'offset', 'bytes'], 'write chunk');
				const writeId = ownedWrite(session, request.writeId);
				return options.service.writeChunk({
					writeId, offset: safeInteger(request.offset, 'write offset'), bytes: chunk(request.bytes),
				});
			}
			case 'write-prefix': {
				const request = exactRecord(value, ['writeId', 'bytes'], 'write prefix');
				return options.service.patchFinalPrefix({
					writeId: ownedWrite(session, request.writeId), bytes: chunk(request.bytes),
				});
			}
			case 'write-finish': {
				const request = exactRecord(value, ['writeId'], 'write finish');
				const writeId = ownedWrite(session, request.writeId);
				const result = await options.service.finishWrite(writeId);
				session.writes.delete(writeId);
				return result;
			}
			case 'write-abort': {
				const request = exactRecord(value, ['writeId'], 'write abort');
				const writeId = ownedWrite(session, request.writeId);
				await options.service.abortWrite(writeId);
				session.writes.delete(writeId);
				return true;
			}
			case 'complete': {
				const request = exactRecord(value, ['report'], 'completion');
				if (session.writes.size) throw new Error('Persistent delivery has an unfinished write.');
				boundedControl(request.report, 'delivery report');
				const currentAuthority = await options.completionAuthority(
					session.owner, session.description, session.plan,
				);
				const result = await options.service.complete({
					claimId: session.claimId, report: request.report as never, currentAuthority,
					revalidateAuthority: () => options.completionAuthority(
						session.owner, session.description, session.plan,
					),
				});
				session.settled = true;
				return result;
			}
			case 'fail': {
				const request = exactRecord(value, ['failureCode', 'report'], 'failure');
				if (request.report !== null) boundedControl(request.report, 'failure report');
				await options.service.fail(session.claimId,
					failureCode(request.failureCode), request.report);
				session.settled = true;
				return true;
			}
			case 'release': {
				optionalRecord(value, [], 'release');
				await abortWrites(session);
				await options.service.releaseClaim(session.claimId);
				session.settled = true;
				return true;
			}
		}
	}

	async function closeProtocol(session: Session, code: string): Promise<void> {
		if (!session.closed) safeClosed(session.port, code);
		await closeSession(session);
	}

	async function closeSession(session: Session): Promise<void> {
		if (session.closing) return session.closing;
		session.closing = (async () => {
			session.closed = true;
			const activeOperation = session.activeOperation;
			if (activeOperation) await activeOperation.catch(() => undefined);
			sessions.delete(session);
			session.port.removeListener('message', session.onMessage);
			session.port.removeListener('close', session.onClose);
			safeClose(session.port);
			if (!session.settled) {
				await abortWrites(session);
				await Promise.resolve(options.service.releaseClaim(session.claimId)).catch(() => undefined);
			}
		})();
		return session.closing;
	}

	async function abortWrites(session: Session): Promise<void> {
		for (const writeId of [...session.writes]) {
			await Promise.resolve(options.service.abortWrite(writeId)).catch(() => undefined);
			session.writes.delete(writeId);
		}
	}

	return Object.freeze({
		async bindOwnerProject(
			owner: Owner,
			current: SoundscaperDeliveryCurrentAuthorityV1['projectIdentity'] | null,
		): Promise<void> {
			if (revokedOwners.has(owner)) return;
			const stale = [...sessions].filter((session) => session.owner === owner
				&& (current === null || !sameProject(session.description.projectIdentity, current)));
			for (const session of stale) {
				safeClosed(session.port, 'open-project-changed');
				await closeSession(session);
			}
		},
		async revokeOwner(owner: Owner): Promise<void> {
			revokedOwners.add(owner);
			const owned = [...sessions].filter((session) => session.owner === owner);
			for (const session of owned) {
				safeClosed(session.port, 'owner-revoked');
				await closeSession(session);
			}
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true;
			options.removeListener(SOUNDSCAPER_DELIVERY_WORKER_PORT_CHANNEL, listener);
			for (const session of [...sessions]) {
				safeClosed(session.port, 'transport-disposed');
				await closeSession(session);
			}
		},
	});
}

function sameCurrentAuthority(
	left: SoundscaperDeliveryCurrentAuthorityV1,
	right: SoundscaperDeliveryCurrentAuthorityV1,
): boolean {
	return left.planFingerprint === right.planFingerprint
		&& sameProject(left.projectIdentity, right.projectIdentity);
}

function sameProject(
	left: SoundscaperDeliveryCurrentAuthorityV1['projectIdentity'],
	right: SoundscaperDeliveryCurrentAuthorityV1['projectIdentity'],
): boolean {
	return left.projectId === right.projectId
		&& left.projectRevision === right.projectRevision
		&& left.projectSha256 === right.projectSha256;
}

const OPERATIONS = [
	'progress', 'write-begin', 'write-chunk', 'write-prefix', 'write-finish',
	'write-abort', 'complete', 'fail', 'release',
] as const;
type Operation = typeof OPERATIONS[number];

function operationName(value: unknown): Operation {
	if (typeof value !== 'string' || !(OPERATIONS as readonly string[]).includes(value)) {
		throw new TypeError('Persistent delivery worker operation is invalid.');
	}
	return value as Operation;
}

function portsFrom(event: unknown): MainPort[] {
	const ports = event && typeof event === 'object'
		? (event as Readonly<{ ports?: unknown }>).ports : null;
	if (!Array.isArray(ports)) return [];
	return ports.filter(isMainPort);
}

function isMainPort(value: unknown): value is MainPort {
	return Boolean(value && typeof value === 'object'
		&& typeof (value as MainPort).postMessage === 'function'
		&& typeof (value as MainPort).start === 'function'
		&& typeof (value as MainPort).close === 'function'
		&& typeof (value as MainPort).on === 'function'
		&& typeof (value as MainPort).removeListener === 'function');
}

function messageData(event: unknown): unknown {
	return event && typeof event === 'object' && 'data' in event
		? (event as Readonly<{ data: unknown }>).data : event;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Record<string, unknown> {
	return optionalRecord(value, fields, label, fields);
}

function optionalRecord(
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

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) {
		throw new TypeError(`Persistent delivery ${label} id is invalid.`);
	}
	return value;
}

function ownedWrite(session: Session, value: unknown): string {
	const writeId = opaqueId(value, 'write');
	if (!session.writes.has(writeId)) throw new Error('Persistent delivery write belongs to another claim port.');
	return writeId;
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

function failureCode(value: unknown): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(value)) {
		throw new TypeError('Persistent delivery failure code is invalid.');
	}
	return value;
}

function chunk(value: unknown): Uint8Array {
	const bytes = value instanceof Uint8Array ? Uint8Array.from(value)
		: value instanceof ArrayBuffer ? new Uint8Array(value.slice(0)) : null;
	if (!bytes || bytes.byteLength < 1 || bytes.byteLength > MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Persistent delivery chunk is outside the bounded transport.');
	}
	return bytes;
}

function boundedControl(value: unknown, label: string): void {
	let encoded: string;
	try { encoded = JSON.stringify(value); }
	catch { throw new TypeError(`Persistent delivery ${label} must be serializable.`); }
	if (new TextEncoder().encode(encoded).byteLength > MAXIMUM_CONTROL_BYTES) {
		throw new RangeError(`Persistent delivery ${label} is too large.`);
	}
	assertPathless(value, label);
}

function assertPathless(value: unknown, label: string, seen = new Set<object>()): void {
	if (typeof value === 'string' && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u.test(value)) {
		throw new TypeError(`Persistent delivery ${label} must be pathless.`);
	}
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return;
	if (seen.has(value)) throw new TypeError(`Persistent delivery ${label} must be acyclic.`);
	seen.add(value);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string' || /(?:^|_)(?:root|staging|absolute|file)?path$/iu.test(key)) {
			throw new TypeError(`Persistent delivery ${label} must not carry a path field.`);
		}
		assertPathless((value as Record<string, unknown>)[key], label, seen);
	}
	seen.delete(value);
}

function safeClosed(port: MainPort, code: string): void {
	try { port.postMessage(Object.freeze({ protocolVersion: PROTOCOL_VERSION, type: 'closed', code })); }
	catch { /* already transferred away */ }
	safeClose(port);
}

function safeClose(port: MainPort): void {
	try { port.close(); } catch { /* already closed */ }
}
