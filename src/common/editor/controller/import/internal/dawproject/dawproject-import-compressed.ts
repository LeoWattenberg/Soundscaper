/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PreparedStreamedAudioImport } from '../../../../browser-streamed-audio-import.ts';
import type { NativeProjectAudioSource, NativeProjectStore } from '../../../document/native-project-types.ts';

/** Decoder cache, decoded sample, PCM packet, and storage write stay under this reserve. */
const COMPRESSED_DECODER_RESERVE_BYTES = 64 * 1024 * 1024;

export function assertDawprojectCompressedWorkingBudget(
	entryBytes: number, limitBytes: number, path: string,
): void {
	if (entryBytes > limitBytes - COMPRESSED_DECODER_RESERVE_BYTES) {
		throw new RangeError(`DAWproject media ${path} exceeds the import working memory budget.`);
	}
}

/** The decoder pushes one bounded PCM packet at a time; only committed sources are published. */
export async function stageDawprojectCompressedSource(
	store: Pick<NativeProjectStore, 'beginSourceWrite'>,
	prepared: PreparedStreamedAudioImport,
	source: NativeProjectAudioSource,
	chunkFrames: number,
	signal: AbortSignal,
	assertCurrent: () => void,
	persistedSourceIds: string[],
	format = 'DAWproject',
): Promise<boolean> {
	const writer = await store.beginSourceWrite(source.id, {
		name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
		channelCount: source.channelCount, chunkFrames,
	});
	let storageFailure = false;
	let frames = 0;
	try {
		assertCurrent();
		await prepared.stream({
			chunkFrames, signal, assertCurrent,
			async onChunk(channels) {
				assertCurrent();
				const count = channels[0]?.length ?? 0;
				if (channels.length !== source.channelCount || count < 1 || count > chunkFrames
					|| channels.some((channel) => channel.length !== count)
					|| frames + count > source.frameCount) {
					throw new Error(`A decoded ${format} audio packet does not match its source.`);
				}
				try { await writer.write(channels); }
				catch (error) { storageFailure = true; throw error; }
				frames += count;
				assertCurrent();
			},
		});
		if (frames !== source.frameCount) throw new Error(`Decoded ${format} audio ended early.`);
		try { await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount }); }
		catch (error) { storageFailure = true; throw error; }
		persistedSourceIds.push(source.id);
		assertCurrent();
		return true;
	} catch (error) {
		await Promise.resolve(writer.abort()).catch(() => undefined);
		if (storageFailure || error instanceof RangeError
			|| (error instanceof Error && error.name === 'AbortError')) throw error;
		assertCurrent();
		return false;
	}
}
