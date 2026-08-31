/* SPDX-License-Identifier: AGPL-3.0-only */

import { createScapeDigest, scapeHex } from '../scape-archive-media.ts';
import type { OwnedAudioSourceWriter } from '../storage/source-write-repository.ts';
import { packPlanarFloat32 } from '../wavpack/pcm.js';

interface TakeCyclePcmSource {
	readonly publication: Readonly<{
		readonly byteLength: number;
		readonly sha256: string;
	}>;
	readonly description: Readonly<{
		readonly channelCount: number;
		readonly chunkFrames: number;
		readonly frameCount: number;
	}>;
}

export async function writeExactTakeCyclePcm(
	writer: OwnedAudioSourceWriter,
	iterable: AsyncIterable<readonly Float32Array[]>,
	source: TakeCyclePcmSource,
	signal: AbortSignal,
): Promise<void> {
	if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
		throw new TypeError('Take cycle PCM capture must be an async iterable.');
	}
	const digest = createScapeDigest();
	let byteLength = 0;
	let writtenFrames = 0;
	for await (const input of iterable) {
		throwIfAborted(signal);
		const remaining = source.description.frameCount - writtenFrames;
		const expectedFrames = Math.min(source.description.chunkFrames, remaining);
		const channels = snapshotChannels(input, source.description.channelCount, expectedFrames);
		const bytes = canonicalTakeCycleChunkBytes(channels, expectedFrames);
		for (const value of bytes) { digest.update(value); byteLength += value.byteLength; }
		await writer.write(channels, { signal });
		writtenFrames += expectedFrames;
	}
	if (writtenFrames !== source.description.frameCount
		|| byteLength !== source.publication.byteLength
		|| scapeHex(digest.digest()) !== source.publication.sha256) {
		throw new Error('Captured take cycle PCM does not match its exact media descriptor.');
	}
}

export function canonicalTakeCycleChunkBytes(
	channels: readonly Float32Array[],
	frameCount: number,
): readonly Uint8Array[] {
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, frameCount, true);
	return Object.freeze([header, new Uint8Array(packPlanarFloat32([...channels]))]);
}

export async function abortTakeCycleWriter(
	writer: OwnedAudioSourceWriter,
	primary: unknown,
): Promise<never> {
	let cleanupError: unknown;
	try {
		await writer.abort();
	} catch (error) {
		cleanupError = error;
	}
	if (cleanupError !== undefined) {
		throw new AggregateError(
			[primary, cleanupError], 'Take cycle PCM staging and cleanup both failed.', { cause: primary },
		);
	}
	throw primary;
}

function snapshotChannels(
	value: readonly Float32Array[],
	channelCount: number,
	frameCount: number,
): readonly Float32Array[] {
	if (!Array.isArray(value) || value.length !== channelCount || frameCount < 1
		|| value.some((channel) => !(channel instanceof Float32Array) || channel.length !== frameCount)) {
		throw new Error('Take cycle PCM chunk has noncanonical channel geometry.');
	}
	return Object.freeze(value.map((channel) => channel.slice()));
}

function throwIfAborted(signal: AbortSignal): void {
	if (!signal.aborted) return;
	throw signal.reason instanceof Error ? signal.reason : new DOMException('Take cycle recording aborted.', 'AbortError');
}
