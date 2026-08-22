/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless preload-side adapter; bulk bytes cross only a negotiated MessagePort. */

import { createHash } from 'node:crypto';

import {
	HELPER_DATA_CHUNK_MAXIMUM_BYTES,
	HELPER_DATA_PLANE_VERSION,
	HelperDataPlaneSender,
} from './helper-data-plane.ts';
import { FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS } from './native-image-sequence-import-main-ipc.ts';

interface RendererPort {
	postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void;
	close(): void;
	start?(): void;
	onmessage: ((event: Readonly<{ data: unknown }>) => void) | null;
	onmessageerror: (() => void) | null;
}

interface RendererMessageChannel {
	readonly port1: unknown;
	readonly port2: RendererPort;
}

export interface FramescaperNativeImageSequenceImportPreloadOptions {
	readonly invoke: (channel: string, request: unknown) => Promise<unknown>;
	readonly postMessage: (channel: string, request: unknown, transfer: readonly unknown[]) => void;
	readonly createMessageChannel: () => RendererMessageChannel;
}

export interface FramescaperNativeImageSequenceImportRendererBridge {
	imageSequenceImport(request: unknown): Promise<unknown>;
	writeImageSequenceImportChunk(request: Readonly<{
		transactionId: string;
		asset: 'pack' | 'inventory';
		offset: number;
		bytes: Uint8Array;
	}>): Promise<unknown>;
}

export function createFramescaperNativeImageSequenceImportPreloadTransport(
	options: FramescaperNativeImageSequenceImportPreloadOptions,
): FramescaperNativeImageSequenceImportRendererBridge {
	return Object.freeze({
		imageSequenceImport: (request: unknown) => options.invoke(
			FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control,
			structuredClone(request),
		),
		async writeImageSequenceImportChunk(value: Readonly<{
			transactionId: string; asset: 'pack' | 'inventory'; offset: number; bytes: Uint8Array;
		}>) {
			const request = chunkRequest(value);
			const digest = createHash('sha256').update(request.bytes).digest('hex');
			const streamId = createHash('sha256').update(
				`${request.transactionId}:${request.asset}:${String(request.offset)}:${digest}`,
			).digest('hex').slice(0, 40);
			const binding = Object.freeze({
				dataPlaneVersion: HELPER_DATA_PLANE_VERSION,
				transport: 'message-port' as const,
				streamId,
				direction: 'host-to-helper' as const,
				byteLength: request.bytes.byteLength,
				sha256: digest,
				maximumChunkBytes: HELPER_DATA_CHUNK_MAXIMUM_BYTES,
				maximumInFlightChunks: 1,
			});
			const control = Object.freeze({
				transactionId: request.transactionId, asset: request.asset,
				offset: request.offset, binding,
			});
			await options.invoke(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control, {
				operation: 'prepare-write', ...control,
			});
			const channel = options.createMessageChannel();
			const port = channel.port2;
			port.start?.();
			try {
				options.postMessage(
					FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.port,
					control, [channel.port1],
				);
				const sender = new HelperDataPlaneSender(binding);
				const chunk = sender.createChunk(request.bytes.slice());
				const transfer = chunk.bytes.buffer instanceof ArrayBuffer ? [chunk.bytes.buffer] : [];
				const acknowledgement = await portReply(port, chunk, transfer);
				sender.acceptAck(acknowledgement);
				port.postMessage(sender.complete());
				return await options.invoke(FRAMESCAPER_NATIVE_IMAGE_SEQUENCE_IMPORT_CHANNELS.control, {
					operation: 'await-write', transactionId: request.transactionId,
					asset: request.asset, offset: request.offset, streamId,
				});
			} finally { port.close(); }
		},
	});
}

function chunkRequest(value: unknown): Readonly<{
	transactionId: string; asset: 'pack' | 'inventory'; offset: number; bytes: Uint8Array;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('An image-sequence import chunk must be a record.');
	}
	const record = value as Record<string, unknown>;
	const keys = Reflect.ownKeys(record);
	if (keys.length !== 4 || keys.some((key) => typeof key !== 'string'
		|| !['transactionId', 'asset', 'offset', 'bytes'].includes(key))) {
		throw new TypeError('An image-sequence import chunk must be exact and pathless.');
	}
	if (typeof record.transactionId !== 'string' || !/^[a-f0-9]{40}$/u.test(record.transactionId)
		|| (record.asset !== 'pack' && record.asset !== 'inventory')
		|| !Number.isSafeInteger(record.offset) || Number(record.offset) < 0
		|| !(record.bytes instanceof Uint8Array) || record.bytes.byteLength < 1
		|| record.bytes.byteLength > HELPER_DATA_CHUNK_MAXIMUM_BYTES) {
		throw new TypeError('An image-sequence import chunk has an invalid bound identity.');
	}
	return Object.freeze({
		transactionId: record.transactionId,
		asset: record.asset,
		offset: Number(record.offset),
		bytes: record.bytes.slice(),
	});
}

function portReply(
	port: RendererPort,
	message: unknown,
	transfer: readonly ArrayBuffer[],
): Promise<unknown> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (error: Error | null, value?: unknown): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			port.onmessage = null;
			port.onmessageerror = null;
			if (error) reject(error); else resolve(value);
		};
		const timeout = setTimeout(() => finish(new Error('Image-sequence import transfer timed out.')), 30_000);
		port.onmessage = (event) => finish(null, event.data);
		port.onmessageerror = () => finish(new Error('Image-sequence import MessagePort failed.'));
		try { port.postMessage(message, transfer); }
		catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
	});
}
