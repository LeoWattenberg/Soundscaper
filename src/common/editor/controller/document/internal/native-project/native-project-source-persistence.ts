/* SPDX-License-Identifier: AGPL-3.0-only */

import { isAudioMediaKind } from '../../../../audio-media-kind.ts';
import type { NativeProjectAudioSource, NativeProjectDocument, NativeProjectServiceRuntime } from '../../native-project-types.ts';

/** Publication happens only after every chunk has reached storage. */
export async function persistNativeProjectSource(
	runtime: Pick<NativeProjectServiceRuntime, 'store' | 'sourceChunkFrames'>,
	project: NativeProjectDocument,
	sourceId: string,
	chunks: AsyncIterable<readonly Float32Array[]>,
	persisted: string[],
	assertCurrent: () => void,
	onWritten: (bytes: number) => void = () => undefined,
): Promise<void> {
	const source = project.sources.find((candidate): candidate is NativeProjectAudioSource => isAudioMediaKind(candidate.kind) && candidate.id === sourceId);
	if (!source || !isAudioMediaKind(source.kind)) throw new Error('The imported audio source is missing from its project.');
	const writer = await runtime.store.beginSourceWrite(source.id, {
		name: source.name, mimeType: source.mimeType, sampleRate: source.sampleRate,
		channelCount: source.channelCount, chunkFrames: runtime.sourceChunkFrames,
	});
	let frames = 0;
	try {
		assertCurrent();
		for await (const channels of chunks) {
			assertCurrent();
			const count = channels[0]?.length ?? 0;
			if (channels.length !== source.channelCount || count < 1 || count > runtime.sourceChunkFrames
				|| channels.some((channel) => channel.length !== count) || frames + count > source.frameCount) {
				throw new Error('An Audacity audio chunk does not match its project source.');
			}
			await writer.write([...channels]);
			frames += count;
			assertCurrent();
			onWritten(count * channels.length * 4);
		}
		if (frames !== source.frameCount) throw new Error('The Audacity audio stream ended before its declared length.');
		await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
		persisted.push(source.id);
		assertCurrent();
	} catch (error) {
		await Promise.resolve(writer.abort()).catch(() => undefined);
		throw error;
	}
}

export async function* bufferedNativeSourceChunks(
	channels: readonly Float32Array[], chunkFrames: number,
): AsyncGenerator<readonly Float32Array[]> {
	for (let offset = 0; offset < (channels[0]?.length ?? 0); offset += chunkFrames) {
		yield channels.map((channel) => channel.subarray(offset, offset + chunkFrames));
	}
}
