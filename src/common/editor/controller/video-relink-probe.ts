/* SPDX-License-Identifier: AGPL-3.0-only */

interface ProbeMetadata {
	readonly width: number;
	readonly height: number;
	readonly durationSeconds: number;
}

interface ProbeExtractor {
	readonly metadata: ProbeMetadata;
	dispose(): void;
}

interface DecodedAudioCandidate {
	readonly channels?: readonly unknown[];
	readonly numberOfChannels?: number;
}

export interface ChangedContentVideoCandidateRuntime {
	createAudioEditorVideoFrameExtractor(file: Blob): PromiseLike<ProbeExtractor> | ProbeExtractor;
	readonly engine: Readonly<{
		decodeAudioData(bytes: ArrayBuffer): PromiseLike<unknown>;
	}>;
	readonly ffmpeg: Readonly<{
		decode(file: Blob, options: Readonly<{ sampleRate: number }>): PromiseLike<unknown>;
	}>;
}

export interface ChangedContentVideoCandidateSource {
	readonly width: number;
	readonly height: number;
	readonly frameCount: number;
	readonly sampleRate: number;
}

/**
 * Admit a changed-content relink candidate against the canonical source claims.
 * The decode attempt mirrors import, so the silent-video claim keeps the same
 * epistemic standard the document's hasAudio flag was created under.
 */
export async function admitChangedContentVideoCandidate(
	file: Blob,
	source: ChangedContentVideoCandidateSource,
	runtime: ChangedContentVideoCandidateRuntime,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<void> {
	throwIfAborted(options.signal);
	const extractor = await runtime.createAudioEditorVideoFrameExtractor(file);
	try {
		throwIfAborted(options.signal);
		const { width, height, durationSeconds } = extractor.metadata;
		if (width !== source.width || height !== source.height) {
			throw new Error('The selected video does not match the linked source frame size.');
		}
		const durationFrames = Math.max(1, Math.round(durationSeconds * source.sampleRate));
		if (durationFrames !== source.frameCount) {
			throw new Error('The selected video does not match the linked source duration.');
		}
	} finally {
		try { extractor.dispose(); } catch { /* Disposable probe helper. */ }
	}
	throwIfAborted(options.signal);
	if (await decodesAudio(file, source.sampleRate, runtime)) {
		throw new Error('The selected video decodes audio; changed-content relink requires a silent video.');
	}
	throwIfAborted(options.signal);
}

async function decodesAudio(
	file: Blob,
	sampleRate: number,
	runtime: ChangedContentVideoCandidateRuntime,
): Promise<boolean> {
	let decoded: unknown = null;
	try {
		decoded = await runtime.engine.decodeAudioData(await file.arrayBuffer());
	} catch {
		try {
			decoded = await runtime.ffmpeg.decode(file, { sampleRate });
		} catch {
			decoded = null;
		}
	}
	const candidate = decoded as DecodedAudioCandidate | null;
	return Boolean(candidate && (candidate.channels?.length || candidate.numberOfChannels));
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw (signal.reason instanceof Error
		? signal.reason
		: new DOMException('The changed-content video probe was aborted.', 'AbortError'));
}
