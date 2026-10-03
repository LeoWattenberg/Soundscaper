/* SPDX-License-Identifier: AGPL-3.0-only */

interface PcmReader {
	stream(onChunk: (channels: readonly Float32Array[]) => Promise<void>): Promise<void>;
}

/** Original PCM containers rebuild caches in bounded packets, even for long recordings. */
export async function openExternalMediaPcm(
	file: Blob, source: Readonly<Record<string, unknown>>, signal?: AbortSignal,
): Promise<PcmReader | null> {
	signal?.throwIfAborted();
	const signature = new TextDecoder().decode(await file.slice(0, 4).arrayBuffer());
	if (signature === 'FORM') {
		const { inspectAiffBlobPcm, streamAiffBlobPcm } = await import('./aiff-pcm-chunk-reader.ts');
		let descriptor;
		try { descriptor = await inspectAiffBlobPcm(file, { signal }); }
		catch { signal?.throwIfAborted(); return null; }
		admit(descriptor, source);
		return { async stream(onChunk) { await streamAiffBlobPcm(file, { descriptor, signal, chunkFrames: Number(source.chunkFrames), onChunk }); } };
	}
	if (!['RIFF', 'RF64', 'BW64'].includes(signature)) return null;
	const { inspectWavBlobPcm, streamWavBlobPcm } = await import('./wav-import.js');
	let descriptor;
	try { descriptor = await inspectWavBlobPcm(file, { signal }); }
	catch { signal?.throwIfAborted(); return null; }
	admit(descriptor, source);
	return { async stream(onChunk) { await streamWavBlobPcm(file, { descriptor, signal, chunkFrames: Number(source.chunkFrames), onChunk }); } };
}

function admit(descriptor: Readonly<{ sampleRate: number; channelCount: number; frameCount: number }>, source: Readonly<Record<string, unknown>>): void {
	if (descriptor.sampleRate !== source.sampleRate || descriptor.frameCount !== source.frameCount
		|| descriptor.channelCount !== source.channelCount) throw new Error('External PCM does not match the project source.');
}
