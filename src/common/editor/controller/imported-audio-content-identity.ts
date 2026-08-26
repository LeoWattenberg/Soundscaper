/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { normalizeChannels } from '../storage/media-records.ts';
import { packPlanarFloat32 } from '../wavpack/index.js';

const SHA256 = /^[a-f0-9]{64}$/u;

interface AudioSourceStorageWriter {
	readonly framesWritten?: unknown;
	write(
		channels: readonly Float32Array[],
		options?: Readonly<{ signal?: AbortSignal }>,
	): PromiseLike<unknown> | unknown;
	commit(
		metadata?: Record<string, unknown>,
		options?: Readonly<{ signal?: AbortSignal; ifAbsent?: boolean }>,
	): PromiseLike<unknown> | unknown;
	abort(reason?: unknown): PromiseLike<unknown> | unknown;
}

export interface ImportedAudioContentIdentity {
	readonly contentSha256: string;
	readonly byteLength: number;
}

export interface ImportedAudioContentIdentityWriter {
	readonly framesWritten: number;
	readonly publicationCommitted: boolean;
	write(
		channels: readonly Float32Array[],
		options?: Readonly<{ signal?: AbortSignal }>,
	): Promise<void>;
	commit(
		metadata?: Record<string, unknown>,
		options?: Readonly<{ signal?: AbortSignal; ifAbsent?: boolean }>,
	): Promise<unknown>;
	abort(reason?: unknown): Promise<void>;
	contentIdentity(expectedFrameCount: number): ImportedAudioContentIdentity;
}

export async function rollbackImportedAudioContentIdentityWriter(
	writer: Readonly<ImportedAudioContentIdentityWriter>,
	deletePublishedSource: () => PromiseLike<unknown> | unknown,
	failure: unknown,
): Promise<never> {
	const cleanupErrors: unknown[] = [];
	try { await writer.abort(failure); }
	catch (error) { cleanupErrors.push(error); }
	if (writer.publicationCommitted) {
		try { await deletePublishedSource(); }
		catch (error) { cleanupErrors.push(error); }
	}
	if (cleanupErrors.length) {
		throw new AggregateError(
			[failure, ...cleanupErrors],
			'Imported audio persistence and rollback both failed.',
			{ cause: failure },
		);
	}
	throw failure;
}

/**
 * Authenticates an imported source while its canonical planar PCM is already
 * crossing the durable-write boundary. The wire form matches `.scape` audio:
 * one little-endian frame-count word followed by planar Float32LE per chunk.
 */
export function createImportedAudioContentIdentityWriter(
	writer: AudioSourceStorageWriter,
	chunkFramesValue: number,
): Readonly<ImportedAudioContentIdentityWriter> {
	if (!writer || typeof writer.write !== 'function' || typeof writer.commit !== 'function'
		|| typeof writer.abort !== 'function') {
		throw new TypeError('Imported audio identity requires a durable PCM writer.');
	}
	const chunkFrames = positiveSafeInteger(chunkFramesValue, 'Imported audio chunk size');
	const digest = sha256.create();
	let framesWritten = 0;
	let channelCount: number | null = null;
	let previousChunkFrames: number | null = null;
	let byteLength = 0;
	let publicationCommitted = false;
	let committedMetadata: unknown;
	let resolvedIdentity: ImportedAudioContentIdentity | null = null;

	return Object.freeze({
		get framesWritten() { return framesWritten; },
		get publicationCommitted() { return publicationCommitted; },
		async write(input: readonly Float32Array[], options?: Readonly<{ signal?: AbortSignal }>) {
			if (publicationCommitted) throw new Error('The imported audio writer is closed.');
			const channels = normalizeChannels(input);
			if (!channels.length) throw new TypeError('Imported PCM must contain at least one channel.');
			const frameCount = channels[0]!.length;
			if (frameCount < 1 || frameCount > chunkFrames
				|| channels.some((channel) => channel.length !== frameCount)) {
				throw new RangeError('Imported PCM chunk geometry is invalid.');
			}
			if (previousChunkFrames !== null && previousChunkFrames !== chunkFrames) {
				throw new RangeError('A non-final imported PCM chunk must use the declared chunk size.');
			}
			if (channelCount === null) channelCount = channels.length;
			else if (channels.length !== channelCount) {
				throw new RangeError('Imported PCM channel count changed during persistence.');
			}
			const pcm = new Uint8Array(packPlanarFloat32(channels));
			await writer.write(channels, options);
			const header = new Uint8Array(4);
			new DataView(header.buffer).setUint32(0, frameCount, true);
			digest.update(header);
			digest.update(pcm);
			framesWritten = safeAdd(framesWritten, frameCount, 'Imported audio frame count');
			byteLength = safeAdd(byteLength, header.byteLength + pcm.byteLength,
				'Imported audio content byte length');
			previousChunkFrames = frameCount;
		},
		async commit(
			metadata: Record<string, unknown> = {},
			options: Readonly<{ signal?: AbortSignal; ifAbsent?: boolean }> = {},
		) {
			if (publicationCommitted) throw new Error('The imported audio writer is closed.');
			committedMetadata = await writer.commit(metadata, options);
			publicationCommitted = true;
			return committedMetadata;
		},
		async abort(reason?: unknown) { await writer.abort(reason); },
		contentIdentity(expectedFrameCountValue: number) {
			if (!publicationCommitted) {
				throw new Error('Imported audio content identity requires committed storage.');
			}
			const expectedFrameCount = positiveSafeInteger(
				expectedFrameCountValue, 'Imported audio expected frame count',
			);
			if (framesWritten !== expectedFrameCount) {
				throw new Error('Imported audio frame count disagrees with committed PCM.');
			}
			if (resolvedIdentity) return resolvedIdentity;
			const contentSha256 = bytesToHex(digest.digest());
			assertStorageEvidence(committedMetadata, contentSha256, byteLength, framesWritten);
			resolvedIdentity = Object.freeze({ contentSha256, byteLength });
			return resolvedIdentity;
		},
	});
}

function assertStorageEvidence(
	value: unknown,
	contentSha256: string,
	byteLength: number,
	frameCount: number,
): void {
	if (value === null || value === undefined) return;
	if (typeof value !== 'object' || Array.isArray(value) || ArrayBuffer.isView(value)) {
		throw new TypeError('Imported audio storage evidence is invalid.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (Object.hasOwn(record, 'sha256')) {
		if (typeof record.sha256 !== 'string' || !SHA256.test(record.sha256)) {
			throw new TypeError('Imported audio storage content digest evidence is invalid.');
		}
		if (record.sha256 !== contentSha256) {
			throw new Error('Imported audio storage content digest disagrees with committed PCM.');
		}
	}
	if (Object.hasOwn(record, 'byteLength')) {
		if (!Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 1) {
			throw new TypeError('Imported audio storage content byte length evidence is invalid.');
		}
		if (record.byteLength !== byteLength) {
			throw new Error('Imported audio storage content byte length disagrees with committed PCM.');
		}
	}
	if (Object.hasOwn(record, 'frameCount') && record.frameCount !== frameCount) {
		throw new Error('Imported audio storage frame count disagrees with committed PCM.');
	}
}

function positiveSafeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${label} must be a positive safe integer.`);
	}
	return Number(value);
}

function safeAdd(left: number, right: number, label: string): number {
	const result = left + right;
	if (!Number.isSafeInteger(result)) throw new RangeError(`${label} exceeds the safe integer range.`);
	return result;
}
