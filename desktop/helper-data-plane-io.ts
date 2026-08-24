/* SPDX-License-Identifier: AGPL-3.0-only */

/** Streaming file adapter for the digest-bound helper MessagePort data plane. */

import { open, rm } from 'node:fs/promises';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneReceiver,
	HelperDataPlaneSender,
	type HelperDataPlaneBinding,
	type HelperDataPlaneCancelReason,
	type HelperDataPlaneCompletion,
	type HelperDataPlaneMessage,
	validateHelperDataPlaneBinding,
	validateHelperDataPlaneMessage,
} from './helper-data-plane.ts';
import {
	HelperDataPlaneOutputReceiver,
	assertHelperDataPlaneOutputCompletion,
	type HelperDataPlaneOutputReservation,
	validateHelperDataPlaneOutputReservation,
} from './helper-data-plane-output-reservation.ts';
import {
	HelperDataPlaneInputReceiver,
	type HelperDataPlaneInputReservation,
	validateHelperDataPlaneInputReservation,
} from './helper-data-plane-input-reservation.ts';

export interface HelperDataPlaneIoPort {
	postMessage(message: unknown, transfer?: readonly ArrayBuffer[]): void;
	on(event: 'message', listener: (event: unknown) => void): unknown;
	off?(event: 'message', listener: (event: unknown) => void): unknown;
	removeListener?(event: 'message', listener: (event: unknown) => void): unknown;
	start?(): void;
	close(): void;
}

export interface HelperDataPlaneByteSink {
	write(bytes: Uint8Array): PromiseLike<void> | void;
	complete(): PromiseLike<void> | void;
	abort(reason: unknown): PromiseLike<void> | void;
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
	const inbox = new PortInbox(request.port, binding.maximumInFlightChunks);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	let completed = false;
	try {
		request.signal?.throwIfAborted();
		handle = await open(request.path, 'wx', 0o600);
		const receiver = new HelperDataPlaneReceiver(binding);
		for (;;) {
			const message = await inbox.next(request.signal);
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

/** Relay one trailer-authenticated input directly into a bounded native-process sink. */
export async function receiveHelperDataPlaneInputStream(request: Readonly<{
	readonly reservation: HelperDataPlaneInputReservation;
	readonly port: HelperDataPlaneIoPort;
	readonly sink: HelperDataPlaneByteSink;
	readonly signal?: AbortSignal;
}>): Promise<HelperDataPlaneCompletion> {
	const reservation = validateHelperDataPlaneInputReservation(request.reservation);
	if (!request.sink || typeof request.sink.write !== 'function'
		|| typeof request.sink.complete !== 'function' || typeof request.sink.abort !== 'function') {
		throw new TypeError('A trailer-authenticated helper input requires an exact native sink.');
	}
	const inbox = new PortInbox(request.port, reservation.maximumInFlightChunks);
	let completed = false;
	let sinkAborted = false;
	const abortSink = async (reason: unknown): Promise<void> => {
		if (sinkAborted) return;
		sinkAborted = true;
		await Promise.resolve(request.sink.abort(reason)).catch(() => undefined);
	};
	try {
		request.signal?.throwIfAborted();
		const receiver = new HelperDataPlaneInputReceiver(reservation);
		for (;;) {
			const message = await inbox.next(request.signal);
			if (message.type === 'cancel') {
				receiver.acceptCancel(message);
				throw abortError('The live helper input sender cancelled its stream.');
			}
			if (message.type === 'chunk') {
				const admitted = receiver.acceptChunk(message);
				await awaitNativeSink(
					() => request.sink.write(admitted.message.bytes), request.signal, abortSink,
				);
				request.port.postMessage(admitted.ack);
				continue;
			}
			if (message.type !== 'complete') {
				throw new TypeError('A live helper input accepts only chunks, completion, or cancellation.');
			}
			const completion = receiver.acceptComplete(message);
			await awaitNativeSink(() => request.sink.complete(), request.signal, abortSink);
			completed = true;
			return completion;
		}
	} catch (error) {
		postCancellation(request.port, reservation.streamId,
			request.signal?.aborted ? 'helper-abort' : 'protocol-fault');
		await abortSink(error);
		throw request.signal?.aborted ? abortError('The live helper input receive was cancelled.') : error;
	} finally {
		inbox.dispose();
		if (!completed) await abortSink(new Error('The live helper input did not complete.'));
		request.port.close();
	}
}

async function awaitNativeSink(
	operation: () => PromiseLike<void> | void,
	signal: AbortSignal | undefined,
	abortSink: (reason: unknown) => Promise<void>,
): Promise<void> {
	signal?.throwIfAborted();
	if (!signal) { await operation(); return; }
	let removeAbort = (): void => undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		const onAbort = (): void => {
			void abortSink(signal.reason);
			reject(abortError('The live native-input sink was cancelled.'));
		};
		signal.addEventListener('abort', onAbort, { once: true });
		removeAbort = () => signal.removeEventListener('abort', onAbort);
	});
	try { await Promise.race([Promise.resolve().then(operation), aborted]); }
	finally { removeAbort(); }
}

/** Receive one digest-on-completion helper output within its pre-negotiated length bound. */
export async function receiveHelperDataPlaneReservedFile(
	request: HelperDataPlaneReservedFileRequest,
): Promise<HelperDataPlaneCompletion> {
	const reservation = validateHelperDataPlaneOutputReservation(request.reservation);
	const inbox = new PortInbox(request.port, reservation.maximumInFlightChunks);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	let completed = false;
	try {
		request.signal?.throwIfAborted();
		handle = await open(request.path, 'wx', 0o600);
		const receiver = new HelperDataPlaneOutputReceiver(reservation);
		for (;;) {
			const message = await inbox.next(request.signal);
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
	const inbox = new PortInbox(request.port, binding.maximumInFlightChunks);
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
			const acknowledgement = await inbox.next(request.signal);
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
	readonly #maximumQueuedMessages: number;
	readonly #messages: HelperDataPlaneMessage[] = [];
	readonly #waiters: Array<Readonly<{
		resolve: (value: HelperDataPlaneMessage) => void;
		reject: (error: Error) => void;
		signal?: AbortSignal;
		abort?: () => void;
	}>> = [];
	#failure: Error | null = null;
	#disposed = false;

	constructor(port: HelperDataPlaneIoPort, maximumQueuedMessages: number) {
		if (!port || typeof port.postMessage !== 'function' || typeof port.on !== 'function'
			|| typeof port.close !== 'function') {
			throw new TypeError('A helper data-plane transfer requires one MessagePort.');
		}
		if (!Number.isSafeInteger(maximumQueuedMessages) || maximumQueuedMessages < 1
			|| maximumQueuedMessages > HELPER_DATA_IN_FLIGHT_CHUNKS_MAXIMUM) {
			throw new RangeError('A helper data-plane inbox requires its admitted in-flight bound.');
		}
		this.#port = port;
		this.#maximumQueuedMessages = maximumQueuedMessages;
		this.#listener = (event) => this.#accept(messageData(event));
		port.on('message', this.#listener);
		port.start?.();
	}

	next(signal?: AbortSignal): Promise<HelperDataPlaneMessage> {
		if (this.#failure) return Promise.reject(this.#failure);
		if (this.#disposed) return Promise.reject(new Error('The helper data-plane port is closed.'));
		if (signal?.aborted) return Promise.reject(abortError('The helper data-plane stream was cancelled.'));
		const queued = this.#messages.shift();
		if (queued !== undefined) return Promise.resolve(queued);
		return new Promise((resolve, reject) => {
			const waiter: {
				resolve: (value: HelperDataPlaneMessage) => void;
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

	#accept(value: unknown): void {
		if (this.#disposed) return;
		let message: HelperDataPlaneMessage;
		try { message = validateHelperDataPlaneMessage(value); }
		catch (error) {
			this.#fail(error instanceof Error ? error : new Error('The helper data-plane message is invalid.'));
			return;
		}
		const waiter = this.#waiters.shift();
		if (!waiter) {
			if (this.#messages.length >= this.#maximumQueuedMessages) {
				this.#fail(new Error('The helper data-plane peer exceeded its admitted in-flight queue.'));
				return;
			}
			this.#messages.push(message);
			return;
		}
		if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
		waiter.resolve(message);
	}

	#fail(error: Error): void {
		if (this.#disposed) return;
		this.#failure = error;
		this.#disposed = true;
		if (this.#port.off) this.#port.off('message', this.#listener);
		else this.#port.removeListener?.('message', this.#listener);
		this.#messages.length = 0;
		for (const waiter of this.#waiters.splice(0)) {
			if (waiter.abort) waiter.signal?.removeEventListener('abort', waiter.abort);
			waiter.reject(error);
		}
		try { this.#port.close(); } catch { /* The failed inbox is already fenced. */ }
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
