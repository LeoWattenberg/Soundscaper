/* SPDX-License-Identifier: AGPL-3.0-only */

/** Renderer half of the bounded, pathless baseline OpenFX frame port. */

import {
	canonicalizeNativeMediaPlan,
	fingerprintNativeMediaPlan,
} from '../native-media-plan-canonical-form.ts';
import type {
	FramescaperOpenFxFrameExecutionRequestNativeMedia,
	FramescaperOpenFxFrameExecutionResultNativeMedia,
} from '../../../framescaper/editor-openfx-frame-graph-native-media.ts';

const MAXIMUM_CHUNK_BYTES = 16 * 1024 * 1024;
const MAXIMUM_FRAME_SET_BYTES = 512 * 1024 * 1024;
const SESSION = /^[a-f\d]{40}$/u;
const SHA256 = /^[a-f\d]{64}$/u;
const TIMEOUT_MS = 30_000;

export interface FramescaperOpenFxRendererMessagePort {
	postMessage(message: unknown, transfer?: Transferable[]): void;
	start(): void;
	close(): void;
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	onmessageerror: ((event: MessageEvent<unknown>) => void) | null;
}

export interface FramescaperOpenFxFramePortOfferV1 {
	readonly protocolVersion: 1;
	readonly sessionId: string;
	readonly requestNonce: string;
}

export interface FramescaperOpenFxFramePortClient {
	execute(
		request: FramescaperOpenFxFrameExecutionRequestNativeMedia,
	): Promise<FramescaperOpenFxFrameExecutionResultNativeMedia>;
	dispose(): void;
}

export function createFramescaperOpenFxFramePortClient(options: Readonly<{
	readonly openSession: (request: unknown) => Promise<FramescaperOpenFxFramePortOfferV1>;
	readonly subscribeOffers: (listener: (
		offer: FramescaperOpenFxFramePortOfferV1,
		port: FramescaperOpenFxRendererMessagePort,
	) => void) => () => void;
	readonly mintRequestNonce?: () => string;
}>): FramescaperOpenFxFramePortClient {
	if (!options || typeof options.openSession !== 'function' || typeof options.subscribeOffers !== 'function') {
		throw new TypeError('OpenFX frame client requires exact session and port offer seams.');
	}
	let expected: Readonly<{ requestNonce: string; sessionId: string | null }> | null = null;
	let offered: Readonly<{
		sessionId: string; port: FramescaperOpenFxRendererMessagePort;
	}> | null = null;
	let waiter: Readonly<{
		sessionId: string;
		resolve: (port: FramescaperOpenFxRendererMessagePort) => void;
		reject: (error: unknown) => void;
	}> | null = null;
	let consumed = false;
	let disposed = false;
	let active = false;
	const unsubscribe = options.subscribeOffers((offerValue, port) => {
		try {
			const offer = admittedOffer(offerValue);
			if (disposed || !active || expected === null
				|| offer.requestNonce !== expected.requestNonce
				|| (expected.sessionId !== null && offer.sessionId !== expected.sessionId)
				|| consumed || offered !== null) { port.close(); return; }
			if (waiter?.sessionId === offer.sessionId) {
				const current = waiter; waiter = null; consumed = true; current.resolve(port);
			} else offered = Object.freeze({ sessionId: offer.sessionId, port });
		} catch { port.close(); }
	});

	async function execute(request: FramescaperOpenFxFrameExecutionRequestNativeMedia) {
		if (disposed) throw new Error('OpenFX frame client is disposed.');
		if (active) throw new Error('OpenFX frame client permits one in-flight frame.');
		active = true;
		let port: FramescaperOpenFxRendererMessagePort | null = null;
		let sessionId: string | null = null;
		let completed = false;
		try {
			request.signal.throwIfAborted();
			const requestNonce = opaqueId((options.mintRequestNonce ?? randomOpaqueId)());
			expected = Object.freeze({ requestNonce, sessionId: null });
			const admitted = await portRequest(request, requestNonce);
			const offer = admittedOffer(await options.openSession(admitted.control));
			if (offer.requestNonce !== requestNonce) {
				throw new Error('OpenFX frame-port offer did not bind the renderer request capability.');
			}
			sessionId = offer.sessionId;
			expected = Object.freeze({ requestNonce, sessionId: offer.sessionId });
			if (offered !== null && offered.sessionId !== offer.sessionId) {
				offered.port.close(); offered = null;
			}
			port = await offeredPort(offer.sessionId, request.signal, () => offered?.port ?? null, (value) => {
				offered = value === null ? null : Object.freeze({ sessionId: offer.sessionId, port: value });
			}, (value) => { waiter = value; });
			consumed = true;
			request.signal.throwIfAborted();
			port.start();
			if (admitted.control.inputBinding !== null) {
				await sendInput(port, admitted.control.inputBinding, admitted.bytes, request.signal);
			}
			const result = resultMessage(await message(port, request.signal), offer.sessionId);
			if (result.mode !== 'render') { completed = true; return result; }
			const pixels = await receiveOutput(port, result.outputBinding, request.signal);
			completed = true;
			return Object.freeze({
				mode: 'render' as const,
				rgba: Object.freeze({ width: result.width, height: result.height, pixels }),
				backend: result.backend, retriedOnCpu: result.retriedOnCpu,
				reportsDegradation: result.reportsDegradation,
			});
		} finally {
			if (!completed && port && sessionId) try {
				port.postMessage(Object.freeze({ protocolVersion: 1, type: 'cancel', sessionId }));
			} catch { /* closing */ }
			port?.close(); offered?.port.close();
			offered = null; expected = null; consumed = false; waiter = null; active = false;
		}
	}

	return Object.freeze({
		execute,
		dispose() {
			if (disposed) return;
			disposed = true; unsubscribe();
			offered?.port.close();
			waiter?.reject(new Error('OpenFX frame client is disposed.'));
			offered = null; expected = null; waiter = null;
		},
	});
}

async function portRequest(request: FramescaperOpenFxFrameExecutionRequestNativeMedia, requestNonce: string) {
	if (!request || typeof request !== 'object' || !(request.signal instanceof AbortSignal)
		|| !Array.isArray(request.inputs) || request.inputs.length > 16
		|| (request.inputs.length === 0 && request.context !== 'generator')) {
		throw new TypeError('OpenFX renderer frame request is invalid.');
	}
	const fingerprint = fingerprintNativeMediaPlan(request.plan);
	const inputs: Array<Readonly<Record<string, unknown>>> = [];
	const parts: Uint8Array[] = [];
	let offset = 0;
	for (const input of request.inputs) {
		const pixels = input.rgba.pixels.slice();
		if (pixels.byteLength !== input.rgba.width * input.rgba.height * 4
			|| offset + pixels.byteLength > MAXIMUM_FRAME_SET_BYTES) {
			throw new RangeError('OpenFX renderer named planes exceed their exact frame-set bound.');
		}
		inputs.push(Object.freeze({
			name: input.name, sourceRef: input.sourceRef,
			width: input.rgba.width, height: input.rgba.height,
			offset, byteLength: pixels.byteLength, sha256: await digest(pixels),
		}));
		parts.push(pixels); offset += pixels.byteLength;
	}
	const bytes = new Uint8Array(offset);
	let cursor = 0;
	for (const part of parts) { bytes.set(part, cursor); cursor += part.byteLength; }
	const streamSha256 = await digest(bytes);
	const inputBinding = bytes.byteLength === 0 ? null : Object.freeze({
		dataPlaneVersion: 1, transport: 'message-port', streamId: streamSha256.slice(0, 40),
		direction: 'host-to-helper', byteLength: bytes.byteLength, sha256: streamSha256,
		maximumChunkBytes: MAXIMUM_CHUNK_BYTES, maximumInFlightChunks: 1,
	});
	const control = Object.freeze({
		protocolVersion: 1, schemaFamily: 'framescaper' as const, schemaVersion: 1 as const,
		planPayload: canonicalizeNativeMediaPlan(request.plan),
		planFingerprint: fingerprint.sha256, instanceId: request.instanceId,
		requestNonce,
		outputOrdinal: request.outputOrdinal, requestedBackend: request.requestedBackend,
		transitionProgress: request.standardParameters.Transition ?? null,
		inputs: Object.freeze(inputs), inputBinding,
	});
	return Object.freeze({ control, bytes });
}

async function sendInput(
	port: FramescaperOpenFxRendererMessagePort,
	binding: Readonly<Record<string, unknown>>,
	bytes: Uint8Array,
	signal: AbortSignal,
): Promise<void> {
	let sequence = 0;
	for (let offset = 0; offset < bytes.byteLength; offset += MAXIMUM_CHUNK_BYTES) {
		const chunk = bytes.slice(offset, offset + MAXIMUM_CHUNK_BYTES);
		port.postMessage(Object.freeze({
			dataPlaneVersion: 1, type: 'chunk', streamId: binding.streamId,
			sequence, offset, bytes: chunk,
		}), [chunk.buffer]);
		const ack = closed(await message(port, signal), [
			'dataPlaneVersion', 'type', 'streamId', 'sequence', 'receivedBytes',
		], 'OpenFX frame acknowledgement');
		if (ack.dataPlaneVersion !== 1 || ack.type !== 'ack' || ack.streamId !== binding.streamId
			|| ack.sequence !== sequence || ack.receivedBytes !== Math.min(bytes.byteLength, offset + MAXIMUM_CHUNK_BYTES)) {
			throw new Error('OpenFX frame acknowledgement is stale or forged.');
		}
		sequence += 1;
	}
	port.postMessage(Object.freeze({
		dataPlaneVersion: 1, type: 'complete', streamId: binding.streamId,
		byteLength: binding.byteLength, sha256: binding.sha256,
	}));
}

async function receiveOutput(
	port: FramescaperOpenFxRendererMessagePort,
	bindingValue: unknown,
	signal: AbortSignal,
): Promise<Uint8Array<ArrayBuffer>> {
	const binding = bindingRecord(bindingValue);
	const bytes = new Uint8Array(binding.byteLength);
	let sequence = 0;
	let offset = 0;
	while (true) {
		const raw = await message(port, signal);
		const value = closed(raw, ['dataPlaneVersion', 'type', 'streamId'],
			'OpenFX frame output prefix', true);
		if (value.type === 'complete') {
			closed(raw, ['dataPlaneVersion', 'type', 'streamId', 'byteLength', 'sha256'],
				'OpenFX frame output completion');
			if (value.dataPlaneVersion !== 1 || value.streamId !== binding.streamId
				|| value.byteLength !== bytes.byteLength || value.sha256 !== binding.sha256
				|| offset !== bytes.byteLength || await digest(bytes) !== binding.sha256) {
				throw new Error('OpenFX output completion does not bind exact bytes.');
			}
			return bytes;
		}
		closed(raw, ['dataPlaneVersion', 'type', 'streamId', 'sequence', 'offset', 'bytes'],
			'OpenFX frame output chunk');
		if (value.dataPlaneVersion !== 1 || value.type !== 'chunk' || value.streamId !== binding.streamId
			|| value.sequence !== sequence || value.offset !== offset || !(value.bytes instanceof Uint8Array)
			|| value.bytes.byteLength > MAXIMUM_CHUNK_BYTES || offset + value.bytes.byteLength > bytes.byteLength) {
			throw new Error('OpenFX output chunk violates its exact data plane.');
		}
		bytes.set(value.bytes, offset); offset += value.bytes.byteLength;
		port.postMessage(Object.freeze({
			dataPlaneVersion: 1, type: 'ack', streamId: binding.streamId,
			sequence, receivedBytes: offset,
		}));
		sequence += 1;
	}
}

type WireResult = Exclude<FramescaperOpenFxFrameExecutionResultNativeMedia, { readonly mode: 'render' }> | Readonly<{
		mode: 'render'; width: number; height: number; backend: 'cpu' | 'opengl' | 'opencl' | 'cuda' | 'metal';
		retriedOnCpu: boolean; reportsDegradation: boolean; outputBinding: unknown;
	}>;

function resultMessage(value: unknown, sessionId: string): WireResult {
	const result = closed(value, ['protocolVersion', 'type', 'sessionId'],
		'OpenFX frame result prefix', true);
	if (result.protocolVersion !== 1 || result.type !== 'result' || result.sessionId !== sessionId) {
		if (result.protocolVersion === 1 && result.type === 'failure' && result.sessionId === sessionId) {
			closed(value, ['protocolVersion', 'type', 'sessionId', 'message'], 'OpenFX frame failure');
			throw new Error(typeof result.message === 'string' ? result.message : 'OpenFX frame failed.');
		}
		throw new Error('OpenFX frame result is stale or forged.');
	}
	if (!Object.hasOwn(result, 'mode')) throw new TypeError('OpenFX frame result mode is missing.');
	if (result.mode === 'render') {
		closed(value, [
			'protocolVersion', 'type', 'sessionId', 'mode', 'width', 'height', 'backend',
			'retriedOnCpu', 'reportsDegradation', 'outputBinding',
		], 'OpenFX render result');
		if (!Number.isSafeInteger(result.width) || Number(result.width) < 1
			|| !Number.isSafeInteger(result.height) || Number(result.height) < 1
			|| !['cpu', 'opengl', 'opencl', 'cuda', 'metal'].includes(String(result.backend))
			|| typeof result.retriedOnCpu !== 'boolean' || typeof result.reportsDegradation !== 'boolean') {
			throw new TypeError('OpenFX render result is invalid.');
		}
		return Object.freeze({
			mode: 'render', width: Number(result.width), height: Number(result.height),
			backend: result.backend as 'cpu', retriedOnCpu: result.retriedOnCpu,
			reportsDegradation: result.reportsDegradation, outputBinding: result.outputBinding,
		});
	}
	if (result.mode !== 'bypass' && result.mode !== 'frozen') throw new TypeError('OpenFX frame mode is unsupported.');
	closed(value, result.mode === 'frozen' ? [
		'protocolVersion', 'type', 'sessionId', 'mode', 'availability',
		'reportsDegradation', 'frozenFallback',
	] : ['protocolVersion', 'type', 'sessionId', 'mode', 'availability', 'reportsDegradation'],
	'OpenFX fallback result');
	if (!['available', 'missing', 'fingerprint-changed', 'crashed', 'revoked', 'quarantined']
		.includes(String(result.availability)) || typeof result.reportsDegradation !== 'boolean'
		|| (result.mode === 'frozen' && result.reportsDegradation !== true)) {
		throw new TypeError('OpenFX fallback result is invalid.');
	}
	return Object.freeze({
		mode: result.mode, availability: result.availability as never,
		reportsDegradation: result.reportsDegradation,
		...(result.mode === 'frozen' ? { frozenFallback: frozenFallback(result.frozenFallback) } : {}),
	}) as WireResult;
}

function bindingRecord(value: unknown) {
	const binding = closed(value, [
		'dataPlaneVersion', 'transport', 'streamId', 'direction', 'byteLength', 'sha256',
		'maximumChunkBytes', 'maximumInFlightChunks',
	], 'OpenFX output binding');
	if (binding.dataPlaneVersion !== 1 || binding.transport !== 'message-port'
		|| binding.direction !== 'helper-to-host' || !SESSION.test(String(binding.streamId))
		|| !Number.isSafeInteger(binding.byteLength) || Number(binding.byteLength) < 1
		|| Number(binding.byteLength) > MAXIMUM_FRAME_SET_BYTES || !SHA256.test(String(binding.sha256))
		|| binding.maximumChunkBytes !== MAXIMUM_CHUNK_BYTES || binding.maximumInFlightChunks !== 1) {
		throw new TypeError('OpenFX output binding is invalid.');
	}
	return { streamId: String(binding.streamId), byteLength: Number(binding.byteLength), sha256: String(binding.sha256) };
}

function frozenFallback(value: unknown) {
	if (value === null) return null;
	const fallback = closed(value, [
		'externalMediaSourceId', 'renderedAssetSha256', 'frameCount', 'freshness',
	], 'OpenFX frozen fallback');
	if (typeof fallback.externalMediaSourceId !== 'string'
		|| !/^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,127}$/u.test(fallback.externalMediaSourceId)
		|| !SHA256.test(String(fallback.renderedAssetSha256))
		|| !Number.isSafeInteger(fallback.frameCount) || Number(fallback.frameCount) < 1) {
		throw new TypeError('OpenFX frozen fallback is invalid.');
	}
	const freshness = closed(fallback.freshness, [
		'authoredStateSha256', 'inputIdentitiesSha256', 'renderPlanFingerprintSha256',
		'nativeEffectFingerprintSha256',
	], 'OpenFX frozen fallback freshness');
	if (Object.values(freshness).some((digest_) => !SHA256.test(String(digest_)))) {
		throw new TypeError('OpenFX frozen fallback freshness is invalid.');
	}
	return Object.freeze({
		externalMediaSourceId: fallback.externalMediaSourceId,
		renderedAssetSha256: fallback.renderedAssetSha256,
		frameCount: Number(fallback.frameCount), freshness: Object.freeze({ ...freshness }),
	});
}

function offeredPort(
	sessionId: string,
	signal: AbortSignal,
	getOffered: () => FramescaperOpenFxRendererMessagePort | null,
	setOffered: (value: FramescaperOpenFxRendererMessagePort | null) => void,
	setWaiter: (value: Readonly<{
		sessionId: string;
		resolve: (port: FramescaperOpenFxRendererMessagePort) => void;
		reject: (error: unknown) => void;
	}> | null) => void,
): Promise<FramescaperOpenFxRendererMessagePort> {
	const available = getOffered();
	if (available) { setOffered(null); return Promise.resolve(available); }
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => finish(new Error('OpenFX frame-port offer timed out.')), TIMEOUT_MS);
		const abort = (): void => finish(signal.reason ?? new Error('OpenFX frame-port offer cancelled.'));
		const finish = (error: unknown, port?: FramescaperOpenFxRendererMessagePort): void => {
			clearTimeout(timeout); signal.removeEventListener('abort', abort); setWaiter(null);
			if (error) reject(error); else resolve(port!);
		};
		setWaiter(Object.freeze({ sessionId, resolve: (port) => finish(null, port), reject: finish }));
		signal.addEventListener('abort', abort, { once: true });
	});
}

function message(port: FramescaperOpenFxRendererMessagePort, signal: AbortSignal): Promise<unknown> {
	signal.throwIfAborted();
	return new Promise((resolve, reject) => {
		const finish = (error: unknown, value?: unknown): void => {
			clearTimeout(timeout); signal.removeEventListener('abort', abort);
			port.onmessage = null; port.onmessageerror = null;
			if (error) reject(error); else resolve(value);
		};
		const timeout = setTimeout(() => finish(new Error('OpenFX frame MessagePort timed out.')), TIMEOUT_MS);
		const abort = (): void => finish(signal.reason ?? new Error('OpenFX frame execution cancelled.'));
		port.onmessage = (event) => finish(null, event.data);
		port.onmessageerror = () => finish(new Error('OpenFX frame MessagePort failed.'));
		signal.addEventListener('abort', abort, { once: true });
	});
}

function admittedOffer(value: unknown): FramescaperOpenFxFramePortOfferV1 {
	const offer = closed(value, ['protocolVersion', 'sessionId', 'requestNonce'], 'OpenFX frame-port offer');
	if (offer.protocolVersion !== 1 || !SESSION.test(String(offer.sessionId))
		|| !SESSION.test(String(offer.requestNonce))) {
		throw new TypeError('OpenFX frame-port offer is invalid.');
	}
	return Object.freeze({
		protocolVersion: 1, sessionId: String(offer.sessionId), requestNonce: String(offer.requestNonce),
	});
}

function opaqueId(value: unknown): string {
	if (typeof value !== 'string' || !SESSION.test(value)) throw new TypeError('OpenFX request nonce is invalid.');
	return value;
}

function randomOpaqueId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(20));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Record<string, unknown>;
}

function closed(value: unknown, fields: readonly string[], name: string, prefix = false): Record<string, unknown> {
	const row = record(value, name);
	const keys = Reflect.ownKeys(row);
	if (fields.some((field) => !Object.hasOwn(row, field))
		|| !prefix && (keys.length !== fields.length
			|| keys.some((key) => typeof key !== 'string' || !fields.includes(key)))) {
		throw new TypeError(`${name} is not a closed record.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(row, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} is not an own data field.`);
		}
	}
	return row;
}

async function digest(value: Uint8Array): Promise<string> {
	const exact = Uint8Array.from(value);
	const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', exact.buffer));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
