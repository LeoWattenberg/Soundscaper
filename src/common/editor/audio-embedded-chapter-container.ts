/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeEmbeddedExportChapters, type EmbeddedExportChapter } from './export-embedded-chapters.ts';

const textEncoder = new TextEncoder();

/** Add chapter metadata around dedicated codec output without copying its audio payload. */
export async function embedAudioChapters(
	encoded: Blob,
	format: unknown,
	chapters: readonly EmbeddedExportChapter[],
	sampleRate: number,
	signal?: AbortSignal,
): Promise<Blob> {
	signal?.throwIfAborted();
	if (!chapters.length) return encoded;
	if (format === 'mp3') {
		return new Blob([createEmbeddedMp3ChapterTag(chapters, sampleRate), encoded], { type: encoded.type });
	}
	if (format === 'aac-m4a') {
		return (await import('./m4a-embedded-chapters.ts')).embedM4aChapters(encoded, chapters, sampleRate, signal);
	}
	throw new RangeError('Embedded chapters require an MP3 or M4A file.');
}

/** ID3v2.4 CHAP frames and an ordered CTOC hierarchy keep every label name literal. */
export function createEmbeddedMp3ChapterTag(
	value: readonly EmbeddedExportChapter[],
	sampleRate: number,
): Uint8Array<ArrayBuffer> {
	const chapters = normalizeEmbeddedExportChapters(value, sampleRate);
	if (!chapters.length) return new Uint8Array(0);
	const ids = chapters.map((_, index) => `chapter-${String(index + 1)}`);
	const frames = tableOfContents(ids);
	for (const [index, chapter] of chapters.entries()) {
		const times = new Uint8Array(16);
		const view = new DataView(times.buffer);
		view.setUint32(0, milliseconds(chapter.startFrame, sampleRate));
		view.setUint32(4, milliseconds(chapter.endFrame, sampleRate));
		view.setUint32(8, 0xffff_ffff);
		view.setUint32(12, 0xffff_ffff);
		frames.push(frame('CHAP', concatenate([
			terminated(ids[index]!), times,
			frame('TIT2', concatenate([Uint8Array.of(3), textEncoder.encode(chapter.title)])),
		])));
	}
	const body = concatenate(frames);
	return concatenate([Uint8Array.of(73, 68, 51, 4, 0, 0), synchsafe(body.length), body]);
}

function tableOfContents(chapterIds: readonly string[]): Uint8Array<ArrayBuffer>[] {
	let children = chapterIds;
	const groups: Uint8Array<ArrayBuffer>[] = [];
	let groupIndex = 0;
	while (children.length > 255) {
		const parents: string[] = [];
		for (let offset = 0; offset < children.length; offset += 255) {
			const id = `chapters-${String(++groupIndex)}`;
			groups.push(contentsFrame(id, children.slice(offset, offset + 255), false));
			parents.push(id);
		}
		children = parents;
	}
	return [contentsFrame('chapters', children, true), ...groups];
}

function contentsFrame(id: string, children: readonly string[], topLevel: boolean): Uint8Array<ArrayBuffer> {
	return frame('CTOC', concatenate([
		terminated(id), Uint8Array.of(topLevel ? 3 : 1, children.length),
		...children.map(terminated),
	]));
}

function frame(id: string, payload: Uint8Array): Uint8Array<ArrayBuffer> {
	return concatenate([textEncoder.encode(id), synchsafe(payload.length), Uint8Array.of(0, 0), payload]);
}

function terminated(value: string): Uint8Array<ArrayBuffer> {
	return concatenate([textEncoder.encode(value), Uint8Array.of(0)]);
}

function milliseconds(frames: number, sampleRate: number): number {
	const denominator = BigInt(sampleRate);
	const value = (BigInt(frames) * 1_000n + denominator / 2n) / denominator;
	if (value >= 0xffff_ffffn) throw new RangeError('The MP3 chapter timestamp exceeds the ID3 limit.');
	return Number(value);
}

function synchsafe(value: number): Uint8Array<ArrayBuffer> {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0x0fff_ffff) {
		throw new RangeError('The embedded MP3 chapter tag exceeds the ID3 size limit.');
	}
	return Uint8Array.of((value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127);
}

function concatenate(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { bytes.set(part, offset); offset += part.length; }
	return bytes;
}
