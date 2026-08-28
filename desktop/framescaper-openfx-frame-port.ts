/* SPDX-License-Identifier: AGPL-3.0-only */

/** One-frame-at-a-time, pathless renderer/main OpenFX bulk transport. */

import { createHash } from 'node:crypto';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneReceiver,
	HelperDataPlaneSender,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import {
	admitFramescaperOpenFxFrameControlV1,
	type FramescaperOpenFxFrameControlV1,
	type FramescaperOpenFxFrameExecutionService,
} from './framescaper-openfx-frame-execution.ts';

export const FRAMESCAPER_OPENFX_FRAME_PORT_CHANNEL =
	'framescaper:v1:native-services:openfx:frame-port';
export const FRAMESCAPER_OPENFX_FRAME_OFFER_CHANNEL =
	'framescaper:v1:native-services:openfx:frame-offer';

const ID = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const PLANE_ID = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u;
const MAXIMUM_FRAME_SET_BYTES = 512 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

interface MainPort {
	postMessage(message: unknown, transfer?: readonly unknown[]): void;
	on(event: 'message' | 'close', listener: (value: unknown) => void): unknown;
	off?(event: 'message' | 'close', listener: (value: unknown) => void): unknown;
	removeListener?(event: 'message' | 'close', listener: (value: unknown) => void): unknown;
	start?(): void;
	close(): void;
}

interface OpenFxFrameInputDescriptor {
	readonly name: string;
	readonly sourceRef: string;
	readonly width: number;
	readonly height: number;
	readonly offset: number;
	readonly byteLength: number;
	readonly sha256: string;
}

export interface FramescaperOpenFxFramePortRequestV1 extends FramescaperOpenFxFrameControlV1 {
	readonly requestNonce: string;
	readonly inputs: readonly OpenFxFrameInputDescriptor[];
	readonly inputBinding: HelperDataPlaneBinding | null;
}

export interface FramescaperOpenFxFramePortBroker {
	open(owner: object, sender: Readonly<{
		postMessage(channel: string, value: unknown, ports: readonly MainPort[]): void;
	}>, request: FramescaperOpenFxFramePortRequestV1): Readonly<{
		readonly protocolVersion: 1;
		readonly sessionId: string;
		readonly requestNonce: string;
	}>;
	disposeOwner(owner: object): number;
	dispose(): void;
}

export function createFramescaperOpenFxFramePortBroker(options: Readonly<{
	readonly service: FramescaperOpenFxFrameExecutionService;
	readonly createMessageChannel: () => Readonly<{ readonly hostPort: MainPort; readonly helperPort: MainPort }>;
	readonly mintOpaqueId: () => string;
	readonly reportError?: (error: unknown) => void;
}>): FramescaperOpenFxFramePortBroker {
	if (!options || typeof options.service?.execute !== 'function'
		|| typeof options.createMessageChannel !== 'function' || typeof options.mintOpaqueId !== 'function'
		|| (options.reportError !== undefined && typeof options.reportError !== 'function')) {
		throw new TypeError('OpenFX frame-port broker requires exact main-owned authority seams.');
	}
	const active = new Map<object, Readonly<{ abort: AbortController; port: MainPort }>>();
	let disposed = false;

	function open(
		owner: object,
		sender: Parameters<FramescaperOpenFxFramePortBroker['open']>[1],
		requestValue: FramescaperOpenFxFramePortRequestV1,
	) {
		if (disposed) throw new Error('OpenFX frame-port broker is disposed.');
		if (!owner || typeof owner !== 'object' || typeof sender?.postMessage !== 'function') {
			throw new TypeError('OpenFX frame execution requires its authorized renderer owner.');
		}
		if (active.has(owner)) throw new Error('OpenFX frame backpressure permits one active owner session.');
		const request = admitPortRequest(requestValue);
		const sessionId = opaqueId(options.mintOpaqueId());
		const channel = options.createMessageChannel();
		const abort = new AbortController();
		const rendererClosed = (): void => abort.abort(new Error('The OpenFX renderer frame port closed.'));
		const rendererMessage = (event: unknown): void => {
			const value = data(event);
			if (value && typeof value === 'object' && !Array.isArray(value)
				&& Reflect.ownKeys(value).length === 3
				&& (value as Record<string, unknown>).protocolVersion === 1
				&& (value as Record<string, unknown>).type === 'cancel'
				&& (value as Record<string, unknown>).sessionId === sessionId) {
				abort.abort(new Error('The OpenFX renderer cancelled frame execution.'));
			}
		};
		channel.hostPort.on('close', rendererClosed);
		channel.hostPort.on('message', rendererMessage);
		active.set(owner, Object.freeze({ abort, port: channel.hostPort }));
		const offer = Object.freeze({
			protocolVersion: 1 as const, sessionId, requestNonce: request.requestNonce,
		});
		void runSession(options.service, channel.hostPort, sessionId, request, abort.signal)
			.catch((error: unknown) => {
				reportFailure(channel.hostPort, sessionId, error);
				options.reportError?.(error);
			})
			.finally(() => {
				remove(channel.hostPort, 'close', rendererClosed);
				remove(channel.hostPort, 'message', rendererMessage);
				if (active.get(owner)?.abort === abort) active.delete(owner);
				channel.hostPort.close();
			});
		try {
			sender.postMessage(FRAMESCAPER_OPENFX_FRAME_OFFER_CHANNEL, offer, [channel.helperPort]);
		} catch (error) {
			abort.abort(error); active.delete(owner); channel.hostPort.close(); channel.helperPort.close();
			throw error;
		}
		return offer;
	}

	function disposeOwner(owner: object): number {
		const session = active.get(owner);
		if (!session) return 0;
		active.delete(owner); session.abort.abort(); session.port.close(); return 1;
	}

	return Object.freeze({
		open,
		disposeOwner,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const owner of [...active.keys()]) disposeOwner(owner);
		},
	});
}

async function runSession(
	service: FramescaperOpenFxFrameExecutionService,
	port: MainPort,
	sessionId: string,
	request: ReturnType<typeof admitPortRequest>,
	signal: AbortSignal,
): Promise<void> {
	const bytes = request.inputBinding === null
		? new Uint8Array(0) as Uint8Array<ArrayBuffer>
		: await receiveInput(port, request.inputBinding, signal);
	const inputs = request.inputs.map((input) => {
		const rgba = bytes.slice(input.offset, input.offset + input.byteLength);
		if (sha256(rgba) !== input.sha256) throw new Error('An OpenFX named plane changed within its bound frame set.');
		return Object.freeze({
			name: input.name, sourceRef: input.sourceRef, width: input.width, height: input.height,
			rgba: rgba as Uint8Array<ArrayBuffer>,
		});
	});
	const result = await service.execute(Object.freeze({
		protocolVersion: request.protocolVersion, schemaFamily: request.schemaFamily,
		schemaVersion: request.schemaVersion, planPayload: request.planPayload,
		planFingerprint: request.planFingerprint, instanceId: request.instanceId,
		outputOrdinal: request.outputOrdinal, requestedBackend: request.requestedBackend,
		transitionProgress: request.transitionProgress, inputs: Object.freeze(inputs), signal,
	}));
	signal.throwIfAborted();
	if (result.mode !== 'render') {
		port.postMessage(Object.freeze({
			protocolVersion: 1, type: 'result', sessionId, mode: result.mode,
			availability: result.availability, reportsDegradation: result.reportsDegradation,
			...(result.mode === 'frozen' ? { frozenFallback: result.frozenFallback } : {}),
		}));
		return;
	}
	const pixels = result.rgba.pixels;
	const outputBinding = Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION, transport: 'message-port' as const,
		streamId: sessionId, direction: 'helper-to-host' as const,
		byteLength: pixels.byteLength, sha256: sha256(pixels),
		maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES, maximumInFlightChunks: 1,
	});
	port.postMessage(Object.freeze({
		protocolVersion: 1, type: 'result', sessionId, mode: 'render',
		width: result.rgba.width, height: result.rgba.height,
		backend: result.backend, retriedOnCpu: result.retriedOnCpu,
		reportsDegradation: result.reportsDegradation, outputBinding,
	}));
	await sendOutput(port, outputBinding, pixels, signal);
}

function receiveInput(port: MainPort, binding: HelperDataPlaneBinding, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	return new Promise((resolve, reject) => {
		const receiver = new HelperDataPlaneReceiver(binding);
		const bytes = new Uint8Array(binding.byteLength);
		listen(port, signal, (value) => {
			const message = validateHelperDataPlaneMessage(value);
			if (message.type === 'chunk') {
				const ack = receiver.acceptChunk(message); bytes.set(message.bytes, message.offset);
				port.postMessage(ack); return null;
			}
			if (message.type === 'complete') {
				receiver.acceptComplete(message); return bytes;
			}
			throw new TypeError('OpenFX frame ingress accepts only bound chunks and completion.');
		}).then(resolve, reject);
	});
}

async function sendOutput(
	port: MainPort,
	binding: HelperDataPlaneBinding,
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<void> {
	const sender = new HelperDataPlaneSender(binding);
	for (let offset = 0; offset < bytes.byteLength; offset += binding.maximumChunkBytes) {
		const message = sender.createChunk(bytes.slice(offset, offset + binding.maximumChunkBytes));
		port.postMessage(message, [message.bytes.buffer]);
		const reply = await once(port, signal);
		sender.acceptAck(reply);
	}
	port.postMessage(sender.complete());
}

function listen<Result>(
	port: MainPort,
	signal: AbortSignal,
	accept: (message: unknown) => Result | null,
): Promise<Result> {
	return new Promise((resolve, reject) => {
		const finish = (error: unknown, result?: Result): void => {
			clearTimeout(timeout); signal.removeEventListener('abort', aborted);
			remove(port, 'message', message); remove(port, 'close', closed);
			if (error !== null) reject(error); else resolve(result as Result);
		};
		const message = (event: unknown): void => {
			try { const result = accept(data(event)); if (result !== null) finish(null, result); }
			catch (error) { finish(error); }
		};
		const closed = (): void => finish(new Error('OpenFX frame MessagePort closed.'));
		const aborted = (): void => finish(signal.reason ?? new Error('OpenFX frame execution cancelled.'));
		const timeout = setTimeout(() => finish(new Error('OpenFX frame MessagePort timed out.')), TIMEOUT_MS);
		signal.addEventListener('abort', aborted, { once: true });
		port.on('message', message); port.on('close', closed); port.start?.();
	});
}

function once(port: MainPort, signal: AbortSignal): Promise<unknown> {
	return listen(port, signal, (value) => value);
}

function admitPortRequest(value: unknown): FramescaperOpenFxFramePortRequestV1 {
	const row = closed(value, [
		'protocolVersion', 'schemaFamily', 'schemaVersion', 'planPayload', 'planFingerprint', 'instanceId', 'outputOrdinal',
		'requestedBackend', 'transitionProgress', 'inputs', 'inputBinding', 'requestNonce',
	], 'OpenFX frame-port request');
	const control = admitFramescaperOpenFxFrameControlV1({
		protocolVersion: row.protocolVersion, schemaFamily: row.schemaFamily,
		schemaVersion: row.schemaVersion, planPayload: row.planPayload,
		planFingerprint: row.planFingerprint, instanceId: row.instanceId,
		outputOrdinal: row.outputOrdinal, requestedBackend: row.requestedBackend,
		transitionProgress: row.transitionProgress,
	});
	const requestNonce = opaqueId(row.requestNonce);
	if (!Array.isArray(row.inputs) || row.inputs.length > 16) {
		throw new RangeError('OpenFX frame-port input binding exceeds its exact bounded domain.');
	}
	const binding = row.inputBinding === null ? null : validateHelperDataPlaneBinding(row.inputBinding);
	if ((row.inputs.length === 0) !== (binding === null)
		|| (binding !== null && (binding.direction !== 'host-to-helper'
			|| binding.maximumInFlightChunks !== 1 || binding.byteLength < 1
			|| binding.byteLength > MAXIMUM_FRAME_SET_BYTES))) {
		throw new RangeError('OpenFX frame-port input binding exceeds its exact bounded domain.');
	}
	let offset = 0;
	const inputs = row.inputs.map((value_, index) => {
		const input = closed(value_, [
			'name', 'sourceRef', 'width', 'height', 'offset', 'byteLength', 'sha256',
		], `OpenFX frame-port input ${String(index)}`);
		if (typeof input.name !== 'string' || !PLANE_ID.test(input.name)
			|| typeof input.sourceRef !== 'string' || !PLANE_ID.test(input.sourceRef)
			|| input.offset !== offset || input.width !== control.plan.output.canvas.width
			|| input.height !== control.plan.output.canvas.height
			|| input.byteLength !== Number(input.width) * Number(input.height) * 4
			|| typeof input.sha256 !== 'string' || !SHA256.test(input.sha256)) {
			throw new TypeError('OpenFX frame-port input descriptor is invalid.');
		}
		offset += Number(input.byteLength);
		return Object.freeze({
			name: String(input.name), sourceRef: String(input.sourceRef),
			width: Number(input.width), height: Number(input.height),
			offset: Number(input.offset), byteLength: Number(input.byteLength), sha256: input.sha256,
		});
	});
	if (offset !== (binding?.byteLength ?? 0)) throw new Error('OpenFX frame-port descriptors do not cover exact input bytes.');
	return Object.freeze({
		protocolVersion: control.protocolVersion, schemaFamily: control.schemaFamily,
		schemaVersion: control.schemaVersion, planPayload: control.planPayload,
		planFingerprint: control.planFingerprint, instanceId: control.instanceId,
		requestNonce,
		outputOrdinal: control.outputOrdinal, requestedBackend: control.requestedBackend,
		transitionProgress: control.transitionProgress,
		inputs: Object.freeze(inputs), inputBinding: binding,
	});
}

function closed(value: unknown, fields: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length
		|| Reflect.ownKeys(value).some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} must be one closed plain record.`);
	}
	for (const key of Reflect.ownKeys(value)) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an own data field.`);
		}
	}
	return value as Record<string, unknown>;
}

function data(value: unknown): unknown {
	return value && typeof value === 'object' && Object.hasOwn(value, 'data')
		? (value as Readonly<{ data: unknown }>).data : value;
}
function remove(port: MainPort, event: 'message' | 'close', listener: (value: unknown) => void): void {
	if (port.off) port.off(event, listener); else port.removeListener?.(event, listener);
}
function reportFailure(port: MainPort, sessionId: string, error: unknown): void {
	try { port.postMessage(Object.freeze({ protocolVersion: 1, type: 'failure', sessionId,
		message: (error instanceof Error ? error.message : String(error)).slice(0, 512) })); } catch { /* lost */ }
}
function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('OpenFX frame session ID is invalid.');
	return value;
}
function sha256(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
