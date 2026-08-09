/* SPDX-License-Identifier: AGPL-3.0-only */

export interface VideoFile {
	readonly name: string;
	readonly type: string;
	readonly size: number;
	arrayBuffer(): Promise<ArrayBuffer>;
}

export function videoFile(name = 'movie.mp4'): VideoFile {
	return {
		name,
		type: 'video/mp4',
		size: 32,
		arrayBuffer: async () => new ArrayBuffer(8),
	};
}

export async function beginOwnedMediaAssetWriteFixture(
	sourceId: string,
	writeOptions: Readonly<{ expectedBytes: number; expectedSha256: string }>,
	state: Readonly<{
		calls: string[];
		deletedMedia: string[];
		discardAttempts: string[];
		generations: Map<string, number>;
		writeFails: boolean;
	}>,
) {
	if (state.writeFails) throw new Error('media write failed');
	let bytesWritten = 0;
	let closed = false;
	return {
		maximumChunkBytes: 4,
		get bytesWritten() { return bytesWritten; },
		async write(bytes: Uint8Array) {
			if (closed) throw new Error('media writer closed');
			bytesWritten += bytes.byteLength;
		},
		async commit() { throw new Error('Video import must retain publication ownership.'); },
		async commitOwned() {
			if (closed || bytesWritten !== writeOptions.expectedBytes) throw new Error('media write incomplete');
			closed = true;
			state.calls.push(`write-media:${sourceId}`);
			const generation = (state.generations.get(sourceId) ?? 0) + 1;
			state.generations.set(sourceId, generation);
			return {
				metadata: { sha256: writeOptions.expectedSha256, size: writeOptions.expectedBytes },
				async discardIfCurrent() {
					state.discardAttempts.push(sourceId);
					if (state.generations.get(sourceId) !== generation) return false;
					state.generations.delete(sourceId);
					state.deletedMedia.push(sourceId);
					return true;
				},
			};
		},
		async abort() { closed = true; },
	};
}
