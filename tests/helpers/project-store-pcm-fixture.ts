/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';

import type { AudioEditorProjectStore } from '../../src/common/editor/storage.js';

export async function writePcm(
	store: AudioEditorProjectStore,
	source: Readonly<{
		channelCount: number;
		chunkFrames: number;
		mimeType: string;
		name: string;
		sampleRate: number;
		storageKey: string;
	}>,
	channels: readonly (readonly number[])[],
): Promise<void> {
	const writer = await store.beginSourceWrite(source.storageKey, {
		name: source.name,
		mimeType: source.mimeType,
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
	await writer.write(channels.map((channel) => Float32Array.from(channel)));
	await writer.commit({
		sampleRate: source.sampleRate,
		channelCount: source.channelCount,
		chunkFrames: source.chunkFrames,
	});
}

export async function readPcm(store: AudioEditorProjectStore, storageKey: string): Promise<number[][]> {
	const channels: number[][] = [];
	for await (const stored of store.readSourceChunks(storageKey)) {
		const chunkChannels = Array.isArray(stored) ? stored : stored.channels;
		for (const [index, channel] of chunkChannels.entries()) {
			channels[index] ??= [];
			channels[index]?.push(...channel);
		}
	}
	return channels;
}

export function canonicalPcmBytes(channels: readonly (readonly number[])[]): Uint8Array {
	const frameCount = channels[0]?.length ?? 0;
	const bytes = new Uint8Array(4 + frameCount * channels.length * Float32Array.BYTES_PER_ELEMENT);
	const view = new DataView(bytes.buffer);
	view.setUint32(0, frameCount, true);
	let offset = 4;
	for (const channel of channels) {
		for (const sample of channel) {
			view.setFloat32(offset, sample, true);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes;
}

export function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}
