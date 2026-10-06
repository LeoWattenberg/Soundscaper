/* SPDX-License-Identifier: AGPL-3.0-only */

/** Resolve ambiguous video-container suffixes from their actual media tracks. */
export async function resolveMediaImportVideoRoute(
	file: Blob,
	videoCandidate: boolean,
	signal?: AbortSignal,
	assertCurrent?: () => void,
): Promise<boolean> {
	if (!videoCandidate || !(file instanceof Blob)) return videoCandidate;
	signal?.throwIfAborted();
	const { BlobSource, Input, MATROSKA, MP4, QTFF, WEBM } = await import('mediabunny');
	signal?.throwIfAborted();
	assertCurrent?.();
	const input = new Input({ source: new BlobSource(file), formats: [MP4, QTFF, MATROSKA, WEBM] });
	const onAbort = (): void => { input.dispose(); };
	signal?.addEventListener('abort', onAbort, { once: true });
	try {
		const tracks = await input.getTracks();
		signal?.throwIfAborted();
		assertCurrent?.();
		return tracks.some(track => track.isVideoTrack()) || !tracks.some(track => track.isAudioTrack());
	} catch {
		signal?.throwIfAborted();
		assertCurrent?.();
		// Unknown containers keep their existing video decoder/error path.
		return videoCandidate;
	} finally {
		signal?.removeEventListener('abort', onAbort);
		input.dispose();
	}
}
