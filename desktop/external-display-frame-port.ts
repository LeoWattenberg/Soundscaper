/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact MessagePort ingress for one bounded already-evaluated RGBA frame. */

import {
	FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES,
	type FramescaperExternalDisplayFrame,
} from './external-display-controller.ts';
import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneReceiver,
	type HelperDataPlaneBinding,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import type { FramescaperNativeServicesController } from './native-services-controller.ts';

export const FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL =
	'framescaper:v1:native-services:display:frame-port';

const FRAME_TIMEOUT_MS = 15_000;
const FRAME_KEYS = Object.freeze([
	'sequence', 'evaluationFingerprint', 'width', 'height', 'dynamicRange', 'rgbaSha256',
]);
const SHA256 = /^[a-f0-9]{64}$/u;

interface ExternalDisplayFrameMetadata {
	readonly sequence: number;
	readonly evaluationFingerprint: string;
	readonly width: number;
	readonly height: number;
	readonly dynamicRange: 'sdr' | 'hdr';
	readonly rgbaSha256: string;
}

export interface FramescaperExternalDisplayFrameMessagePort {
	postMessage(message: unknown): void;
	on(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	off?(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	removeListener?(event: 'message' | 'close', listener: (event: unknown) => void): unknown;
	start?(): void;
	close(): void;
}

interface FramePortEvent {
	readonly ports: readonly FramescaperExternalDisplayFrameMessagePort[];
}

type FramePortListener = (event: unknown, value?: unknown) => void;

export interface FramescaperExternalDisplayFramePortOptions {
	readonly on: (channel: string, listener: FramePortListener) => void;
	readonly removeListener: (channel: string, listener: FramePortListener) => void;
	readonly authorizeOwner: (event: unknown) => boolean;
	readonly controller: FramescaperNativeServicesController;
}

export interface FramescaperExternalDisplayFramePortRegistration {
	readonly dispose: () => void;
}

export function registerFramescaperExternalDisplayFramePort(
	options: FramescaperExternalDisplayFramePortOptions,
): FramescaperExternalDisplayFramePortRegistration {
	if (typeof options.on !== 'function' || typeof options.removeListener !== 'function'
		|| typeof options.authorizeOwner !== 'function') {
		throw new TypeError('External-display frame transport requires exact IPC ownership seams.');
	}
	let active: AbortController | null = null;
	let disposed = false;
	const listener: FramePortListener = (event, value) => {
		const port = eventPort(event);
		if (disposed || !options.authorizeOwner(event)) {
			port?.close();
			return;
		}
		if (active !== null) {
			reportFailure(port, value, new Error(
				'External-display frame backpressure permits exactly one in-flight transfer.',
			));
			return;
		}
		const abort = new AbortController();
		active = abort;
		void acceptFrame(options.controller, event, value, abort.signal)
			.catch((error: unknown) => reportFailure(port, value, error))
			.finally(() => { if (active === abort) active = null; });
	};
	options.on(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL, listener);
	return Object.freeze({
		dispose: () => {
			if (disposed) return;
			disposed = true;
			options.removeListener(FRAMESCAPER_EXTERNAL_DISPLAY_FRAME_PORT_CHANNEL, listener);
			active?.abort();
			active = null;
		},
	});
}

async function acceptFrame(
	controller: FramescaperNativeServicesController,
	event: unknown,
	value: unknown,
	signal: AbortSignal,
): Promise<void> {
	const request = requestRecord(value);
	const port = requiredEventPort(event);
	if (controller.externalDisplays().activeDisplayId === null) {
		throw new Error('No external-display session is active.');
	}
	const rgba = await receiveFrameBytes(request.binding, port, signal);
	const projection = controller.presentExternalDisplay(Object.freeze({
		...request.frame,
		rgba,
	} satisfies FramescaperExternalDisplayFrame));
	port.postMessage(Object.freeze({
		dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
		type: 'result',
		streamId: request.binding.streamId,
		projection,
	}));
}

function requestRecord(value: unknown): Readonly<{
	frame: ExternalDisplayFrameMetadata;
	binding: HelperDataPlaneBinding;
}> {
	const request = closedRecord(value, ['frame', 'binding'], 'external-display frame-port request');
	const frame = frameMetadata(request.frame);
	const binding = validateHelperDataPlaneBinding(request.binding);
	const byteLength = frame.width * frame.height * 4;
	if (binding.direction !== 'host-to-helper'
		|| binding.byteLength !== byteLength || binding.sha256 !== frame.rgbaSha256
		|| binding.maximumChunkBytes > HELPER_DATA_CHUNK_MAXIMUM_BYTES
		|| binding.maximumInFlightChunks !== 1) {
		throw new TypeError('External-display frame bytes do not match their exact data-plane binding.');
	}
	return Object.freeze({ frame, binding });
}

function frameMetadata(value: unknown): ExternalDisplayFrameMetadata {
	const frame = closedRecord(value, FRAME_KEYS, 'external-display frame metadata');
	if (!Number.isSafeInteger(frame.sequence) || Number(frame.sequence) < 0
		|| !SHA256.test(String(frame.evaluationFingerprint)) || !SHA256.test(String(frame.rgbaSha256))
		|| (frame.dynamicRange !== 'sdr' && frame.dynamicRange !== 'hdr')) {
		throw new TypeError('External-display frame metadata is invalid.');
	}
	const width = dimension(frame.width);
	const height = dimension(frame.height);
	const byteLength = width * height * 4;
	if (!Number.isSafeInteger(byteLength) || byteLength > FRAMESCAPER_EXTERNAL_DISPLAY_MAXIMUM_FRAME_BYTES) {
		throw new RangeError('External-display frame geometry exceeds its byte ceiling.');
	}
	return Object.freeze({
		sequence: Number(frame.sequence),
		evaluationFingerprint: String(frame.evaluationFingerprint),
		width,
		height,
		dynamicRange: frame.dynamicRange,
		rgbaSha256: String(frame.rgbaSha256),
	});
}

function receiveFrameBytes(
	binding: HelperDataPlaneBinding,
	port: FramescaperExternalDisplayFrameMessagePort,
	signal: AbortSignal,
): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const receiver = new HelperDataPlaneReceiver(binding);
		const rgba = new Uint8Array(binding.byteLength);
		let settled = false;
		const timeout = setTimeout(() => finish(new Error('External-display frame transfer timed out.')), FRAME_TIMEOUT_MS);
		const onAbort = (): void => finish(new Error('External-display frame transfer was cancelled.'));
		const onClose = (): void => finish(new Error('External-display frame transfer port was lost.'));
		const onMessage = (event: unknown): void => {
			try {
				const message = validateHelperDataPlaneMessage(messageData(event));
				if (message.type === 'chunk') {
					const acknowledgement = receiver.acceptChunk(message);
					rgba.set(message.bytes, message.offset);
					port.postMessage(acknowledgement);
					return;
				}
				if (message.type === 'cancel') {
					receiver.acceptCancel(message);
					finish(new Error('External-display frame transfer was cancelled by the renderer.'));
					return;
				}
				if (message.type !== 'complete') {
					throw new TypeError('External-display frame ingress accepts only chunks and completion.');
				}
				receiver.acceptComplete(message);
				finish(null);
			} catch (error) {
				finish(error instanceof Error ? error : new Error(String(error)));
			}
		};
		const finish = (error: Error | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			signal.removeEventListener('abort', onAbort);
			removePortListener(port, 'message', onMessage);
			removePortListener(port, 'close', onClose);
			if (error) reject(error);
			else resolve(rgba);
		};
		signal.addEventListener('abort', onAbort, { once: true });
		port.on('message', onMessage);
		port.on('close', onClose);
		port.start?.();
	});
}

function reportFailure(
	port: FramescaperExternalDisplayFrameMessagePort | null,
	value: unknown,
	error: unknown,
): void {
	if (port === null) return;
	let streamId = '0'.repeat(40);
	try { streamId = requestRecord(value).binding.streamId; } catch { /* closed failure identity */ }
	try {
		port.postMessage(Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'failure',
			streamId,
			message: (error instanceof Error ? error.message : String(error)).slice(0, 512),
		}));
	} finally {
		port.close();
	}
}

function eventPort(event: unknown): FramescaperExternalDisplayFrameMessagePort | null {
	if (!event || typeof event !== 'object') return null;
	const ports = (event as Partial<FramePortEvent>).ports;
	if (!Array.isArray(ports) || ports.length !== 1) return null;
	const port = ports[0];
	return port && typeof port.postMessage === 'function' && typeof port.on === 'function'
		&& typeof port.close === 'function' ? port : null;
}

function requiredEventPort(event: unknown): FramescaperExternalDisplayFrameMessagePort {
	const port = eventPort(event);
	if (port === null) throw new TypeError('External-display frame transport requires one MessagePort.');
	return port;
}

function removePortListener(
	port: FramescaperExternalDisplayFrameMessagePort,
	event: 'message' | 'close',
	listener: (value: unknown) => void,
): void {
	if (port.off) port.off(event, listener);
	else port.removeListener?.(event, listener);
}

function messageData(event: unknown): unknown {
	return event && typeof event === 'object' && Object.hasOwn(event, 'data')
		? (event as Readonly<{ data: unknown }>).data
		: event;
}

function dimension(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 32_768) {
		throw new RangeError('External-display dimensions must be bounded positive integers.');
	}
	return Number(value);
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${label} has missing or unsupported fields.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
