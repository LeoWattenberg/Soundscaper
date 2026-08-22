/* SPDX-License-Identifier: AGPL-3.0-only */

/** Streaming file adapter for the digest-bound helper MessagePort data plane. */

import { open, rm } from 'node:fs/promises';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneReceiver,
	HelperDataPlaneSender,
	type HelperDataPlaneBinding,
	type HelperDataPlaneCancelReason,
	type HelperDataPlaneCompletion,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import {
	HelperDataPlaneOutputReceiver,
	assertHelperDataPlaneOutputCompletion,
	type HelperDataPlaneOutputReservation,
	validateHelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';

export interface HelperDataPlaneIoPort {
	postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
	on(event: 'message', listener: (event: unknown) => void): unknown;
	off?(event: 'message', listener: (event: unknown) => void): unknown;
	removeListener?(event: 'message', listener: (event: unknown) => void): unknown;
	start?(): void;
	close(): void;
}

interface HelperDataPlaneFileRequest {
	readonly binding: HelperDataPlaneBinding;
	readonly port: HelperDataPlaneIoPort;
	readonly path: string;
	readonly signal?: AbortSignal;
	readonly localCancelReason?: HelperDataPlaneCancelReason;
}

interface HelperDataPlaneReservedFileRequest {
	readonly reservation: HelperDataPlaneOutputReservation;
	readonly port: HelperDataPlaneIoPort;
	readonly path: string;
	readonly signal?: AbortSignal;
	readonly localCancelReason?: HelperDataPlaneCancelReason;
}

interface HelperDataPlaneReservedSendRequest extends HelperDataPlaneReservedFileRequest {
	readonly completion: HelperDataPlaneCompletion;
}

/** Receive one exact stream into a newly created spool file. */
export async function receiveHelperDataPlaneFile(
	request: HelperDataPlaneFileRequest,
): Promise<HelperDataPlaneCompletion> {
	const binding = validateHelperDataPlaneBinding(request.binding);
	const inbox = new PortInbox(request.port);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	let completed = false;
	try {
		request.signal?.throwIfAborted();
		handle = await open(request.path, 'wx', 0o600);
		const receiver = new HelperDataPlaneReceiver(binding);
		for (;;) {
			const message = validateHelperDataPlaneMessage(await inbox.next(request.signal));
			if (message.type === 'cancel') {
				receiver.acceptCancel(message);
				throw abortError('The remote helper data-plane sender cancelled the stream.');
			}
			if (message.type === 'chunk') {
				const acknowledgement = receiver.acceptChunk(message);
				const write = await handle.write(
					message.bytes, 0, message.bytes.byteLength, message.offset,
				);
				if (write.bytesWritten !== message.bytes.byteLength) {
					throw new Error('A helper data-plane spool write was incomplete.');
				}
				request.port.postMessage(acknowledgement);
				continue;
			}
			if (message.type !== 'complete') {
				throw new TypeError('A helper data-plane receiver accepts only chunks, completion, or cancellation.');
			}
			const completion = receiver.acceptComplete(message);
			await handle.sync();
			await handle.close();
			handle = null;
			completed = true;
			return completion;
		}
	} catch (error) {
		postCancellation(
			request.port,
			binding.streamId,
			request.signal?.aborted ? (request.localCancelReason ?? 'helper-abort') : 'protocol-fault',
		);
		throw request.signal?.aborted ? abortError('The helper data-plane receive was cancelled.') : error;
	} finally {
		inbox.dispose();
		if (handle !== null) await handle.close().catch(() => undefined);
		if (!completed) await rm(request.path, { force: true }).catch(() => undefined);
		request.port.close();
	}
}

/** Receive one digest-on-completion helper output within its pre-negotiated length bound. */
export async function receiveHelperDataPlaneReservedFile(
	request: HelperDataPlaneReservedFileRequest,
): Promise<HelperDataPlaneCompletion> {
	const reservation = validateHelperDataPlaneOutputReservation(request.reservation);
	const inbox = new PortInbox(request.port);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	let completed = false;
	try {
		request.signal?.throwIfAborted();
		handle = await open(request.path, 'wx', 0o600);
		const receiver = new HelperDataPlaneOutputReceiver(reservation);
		for (;;) {
			const message = validateHelperDataPlaneMessage(await inbox.next(request.signal));
			if (message.type === 'cancel') {
				receiver.acceptCancel(message);
				throw abortError('The remote helper output sender cancelled the stream.');
			}
			if (message.type === 'chunk') {
				const acknowledgement = receiver.acceptChunk(message);
				const write = await handle.write(
					message.bytes, 0, message.bytes.byteLength, message.offset,
				);
				if (write.bytesWritten !== message.bytes.byteLength) {
					throw new Error('A reserved helper output spool write was incomplete.');
				}
				request.port.postMessage(acknowledgement);
				continue;
			}
			if (message.type !== 'complete') {
				throw new TypeError('A reserved helper output accepts only chunks or completion.');
			}
			const completion = receiver.acceptComplete(message);
			await handle.sync();
			await handle.close();
			handle = null;
			completed = true;
			return completion;
		}
	} catch (error) {
		postCancellation(
			request.port,
			reservation.streamId,
			request.signal?.aborted ? (request.localCancelReason ?? 'host-abort') : 'protocol-fault',
		);
		throw request.signal?.aborted ? abortError('The reserved output receive was cancelled.') : error;
	} finally {
		inbox.dispose();
		if (handle !== null) await handle.close().catch(() => undefined);
		if (!completed) await rm(request.path, { force: true }).catch(() => undefined);
		request.port.close();
	}
}

/** Send one exact spool file with acknowledgement-driven backpressure. */
export async function sendHelperDataPlaneFile(
	request: HelperDataPlaneFileRequest,
): Promise<HelperDataPlaneCompletion> {
	const binding = validateHelperDataPlaneBinding(request.binding);
	if (binding.direction !== 'helper-to-host' && binding.direction !== 'host-to-helper') {
		throw new TypeError('A helper data-plane send file has an unsupported direction.');
	}
	const inbox = new PortInbox(request.port);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		request.signal?.throwIfAborted();
		handle = await open(request.path, 'r');
		const details = await handle.stat();
		if (!details.isFile() || details.size !== binding.byteLength) {
			throw new Error('A helper data-plane source does not match its exact bound byte length.');
		}
		const sender = new HelperDataPlaneSender(binding);
		const maximumChunkBytes = Math.min(
			binding.maximumChunkBytes,
			HELPER_DATA_CHUNK_MAXIMUM_BYTES,
		);
		const buffer = Buffer.allocUnsafe(Math.max(1, maximumChunkBytes));
		let offset = 0;
		while (offset < binding.byteLength) {
			request.signal?.throwIfAborted();
			const length = Math.min(buffer.byteLength, binding.byteLength - offset);
			const read = await handle.read(buffer, 0, length, offset);
			if (read.bytesRead !== length) {
				throw new Error('A helper data-plane source ended before its exact byte length.');
			}
			const message = sender.createChunk(new Uint8Array(buffer.buffer, buffer.byteOffset, length));
			request.port.postMessage(message, message.bytes.buffer instanceof ArrayBuffer
				? [message.bytes.buffer] : []);
			const acknowledgement = validateHelperDataPlaneMessage(await inbox.next(request.signal));
			if (acknowledgement.type === 'cancel') {
				sender.acceptCancel(acknowledgement);
				throw abortError('The remote helper data-plane receiver cancelled the stream.');
			}
			sender.acceptAck(acknowledgement);
			offset += length;
		}
		const complete = sender.complete();
		request.port.postMessage(complete);
		return Object.freeze({
			streamId: complete.streamId,
			byteLength: complete.byteLength,
			sha256: complete.sha256,
		});
	} catch (error) {
		postCancellation(
			request.port,
			binding.streamId,
			request.signal?.aborted ? (request.localCancelReason ?? 'helper-abort') : 'protocol-fault',
		);
		throw request.signal?.aborted ? abortError('The helper data-plane send was cancelled.') : error;
	} finally {
		inbox.dispose();
		if (handle !== null) await handle.close().catch(() => undefined);
		request.port.close();
	}
}

/** Send bytes whose digest was computed after native work, within a closed output reservation. */
export async function sendHelperDataPlaneReservedFile(
	request: HelperDataPlaneReservedSendRequest,
): Promise<HelperDataPlaneCompletion> {
	const reservation = validateHelperDataPlaneOutputReservation(request.reservation);
	const completion = assertHelperDataPlaneOutputCompletion(request.completion, reservation);
	return sendHelperDataPlaneFile({
		binding: {
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			transport: 'message-port',
			streamId: reservation.streamId,
			direction: 'helper-to-host',
			byteLength: completion.byteLength,
			sha256: completion.sha256,
			maximumChunkBytes: reservation.maximumChunkBytes,
			maximumInFlightChunks: reservation.maximumInFlightChunks,
		},
		port: request.port,
		path: request.path,
		...(request.signal ? { signal: request.signal } : {}),
		...(request.localCancelReason ? { localCancelReason: request.localCancelReason } : {}),
	});
}

class PortInbox {
	readonly #port: HelperDataPlaneIoPort;
	readonly #listener: (event: unknown) => void;
	readonly #messages: unknown[] = [];
	readonly #waiters: Array<Readonly<{
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		signal?: AbortSignal;
		abort?: () => void;
	}>> = [];
	#disposed = false;

	constructor(port: HelperDataPlaneIoPort) {
		if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
			|| typeof port.close !== 'function') {
			throw new TypeError('A helper data-plane transfer requires one MessagePort.');
		}
		this.#port = port;
		this.#listener = (event) => this.#accept(messageData(event));
		port.on('message', this.#listener);
		port.start?.();
	}

	next(signal?: AbortSignal): Promise<unknown> {
		if (this.#disposed) return Promise.reject(new Error('The helper data-plane port is closed.'));
		if (signal?.aborted) return Promise.reject(abortError('The helper data-plane stream was cancelled.'));
		const queued = this.#messages.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		return new Promise((resolve, reject) => {
			const waiter: {
				resolve: (value: unknown) => void;
				reject: (error: Error) => void;
				signal?: AbortSignal;
				abort?: () => void;
			} = { resolve, reject };
			if (signal) {
				waiter.signal = signal;
				waiter.abort = () => {
					const index = this.#waiters.indexOf(waiter);
					if (index >= 0) this.#waiters.splice(index, 1);
					reject(abortError('The helper data-plane stream was cancelled.'));
				};
				signal.addEventListener('abort', waiter.abort, { once: true });
			}
			this.#waiters.push(waiter);
		});
	}

	dispose(): void {
		if (this.#disposed) return;
		this.#disposed = true;
		if (this.#port.off) this.#port.off('message', this.#listener);
		else this.#port.removeListener?.('message', this.#listener);
		for (const waiter of this.#waiters.splice(0)) {
			if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
			waiter.reject(new Error('The helper data-plane port was closed.'));
		}
		this.#messages.length = 0;
	}

	#accept(message: unknown): void {
		if (this.#disposed) return;
		const waiter = this.#waiters.shift();
		if (!waiter) {
			this.#messages.push(message);
			return;
		}
		if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
		waiter.resolve(message);
	}
}

function messageData(event: unknown): unknown {
	if (event && typeof event === 'object' && Object.hasOwn(event, 'data')) {
		return (event as { data: unknown }).data;
	}
	return event;
}

function postCancellation(
	port: HelperDataPlaneIoPort,
	streamId: string,
	reason: HelperDataPlaneCancelReason,
): void {
	try {
		port.postMessage(Object.freeze({
			dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
			type: 'cancel' as const,
			streamId,
			reason,
		}));
	} catch {
		/* Closing the exact port remains fail-closed if cancellation cannot be posted. */
	}
}

function abortError(message: string): Error {
	const error = new Error(message);
	error.name = 'AbortError';
	return error;
}
