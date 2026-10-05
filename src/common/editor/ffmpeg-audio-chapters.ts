/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeEmbeddedExportChapters,
	serializeEmbeddedExportChapters,
	supportsEmbeddedExportChapters,
	type EmbeddedExportChapter,
} from './export-embedded-chapters.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;

export interface FfmpegAudioChapterInstance {
	writeFile(path: string, data: Uint8Array, options?: Readonly<{ signal?: AbortSignal }>): Awaitable<unknown>;
	exec(args: readonly string[], timeout?: number, options?: Readonly<{ signal?: AbortSignal }>): Awaitable<number>;
	deleteFile(path: string): Awaitable<unknown>;
}

export interface FfmpegAudioChapterSettings {
	readonly format: string;
	readonly sampleRate: number;
	readonly embeddedChapters?: readonly EmbeddedExportChapter[];
}

/** Add a temporary chapter input to an otherwise unchanged audio encode job. */
export async function execFfmpegAudioWithChapters(
	instance: FfmpegAudioChapterInstance,
	args: readonly string[],
	settings: FfmpegAudioChapterSettings,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<number> {
	const signal = options.signal;
	throwIfAborted(signal);
	const chapters = settings.embeddedChapters;
	if (!chapters?.length) return instance.exec(args, -1, options);
	if (!supportsEmbeddedExportChapters(settings.format)) {
		throw new RangeError('Embedded chapters require MP3 or M4A export.');
	}
	if (args[0] !== '-i' || args.length < 3) {
		throw new TypeError('A chapter export requires the primary audio input first.');
	}
	const normalizedChapters = normalizeEmbeddedExportChapters(chapters, settings.sampleRate);
	if (settings.format === 'aac-m4a' && normalizedChapters[0]!.startFrame > 0) {
		throw new RangeError('The FFmpeg M4A chapter track cannot retain a nonzero first chapter start.');
	}
	// FFmetadata's escaped-line reader treats even an escaped trailing backslash
	// as continuation. Pass names directly as argv so no title can swallow the
	// following chapter, and newline/Unicode characters remain exact.
	const text = serializeEmbeddedExportChapters(normalizedChapters, settings.sampleRate, { includeTitles: false });
	const titleArgs = normalizedChapters.flatMap((chapter, index) => [`-metadata:c:${index}`, `title=${chapter.title}`]);
	const path = `${args.at(-1)}.chapters.ffmetadata`;
	try {
		await instance.writeFile(path, new TextEncoder().encode(text), options);
		throwIfAborted(signal);
		const code = await instance.exec([
			...args.slice(0, 2), '-f', 'ffmetadata', '-i', path,
			'-map', '0:a:0', '-map_chapters', '1', ...args.slice(2, -2),
			...titleArgs, ...args.slice(-2),
		], -1, options);
		throwIfAborted(signal);
		return code;
	} catch (error) {
		throwIfAborted(signal);
		throw error;
	} finally {
		// An aborted exec may already have terminated its worker. Still attempt
		// cleanup without its signal, while preserving the encoding/abort result.
		try { await instance.deleteFile(path); } catch { /* the worker may be gone */ }
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
