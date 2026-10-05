/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeEmbeddedExportChapters,
	resolveEmbeddedExportChapters,
	supportsEmbeddedExportChapters,
	type EmbeddedExportChapter,
} from './export-embedded-chapters.ts';

type DataRecord = Readonly<Record<string, unknown>>;

export function assertEmbeddedChapterRequest(format: unknown, options: DataRecord): void {
	if (options.embedLabelChapters !== true) return;
	if (!supportsEmbeddedExportChapters(format)) {
		throw new RangeError('Embedded chapters support MP3 and M4A export formats.');
	}
	if (options.mode != null && options.mode !== 'mix') {
		throw new RangeError('Embedded chapters require a single mix export.');
	}
	if (options.masteringSequenceId) {
		throw new RangeError('Embedded label chapters cannot describe a rearranged mastering sequence.');
	}
}

/** Keep the ordinary encoding shape unchanged until chapters are requested. */
export function embeddedChapterEncodingFields(
	format: unknown,
	value: unknown,
	sampleRate: number,
): Readonly<{ embeddedChapters?: readonly EmbeddedExportChapter[] }> {
	if (value === undefined) return {};
	if (!supportsEmbeddedExportChapters(format)) {
		throw new RangeError('Embedded chapters support MP3 and M4A export formats.');
	}
	const embeddedChapters = normalizeEmbeddedExportChapters(value, sampleRate);
	if (format === 'aac-m4a' && (embeddedChapters.length > 255
		|| embeddedChapters.some(({ title }) => new TextEncoder().encode(title).length > 255))) {
		throw new RangeError('M4A chapter metadata supports at most 255 chapters and 255 UTF-8 bytes per title.');
	}
	if (format === 'mp3' && embeddedChapters.some(({ endFrame }) => (
		BigInt(endFrame) * 1_000n > 0xffff_fffen * BigInt(sampleRate)
	))) {
		// ID3 reserves 0xffffffff for an unknown chapter time.
		throw new RangeError('MP3 chapter times exceed the ID3 millisecond timestamp limit.');
	}
	return Object.freeze({ embeddedChapters });
}

/** Resolve project labels once, before render-route admission captures the plan. */
export function createEmbeddedChapterEncoding<Encoding extends DataRecord>(
	encoding: Encoding,
	project: unknown,
	options: DataRecord,
	range: Readonly<{ startFrame: number; endFrame: number }>,
	output?: Readonly<{ rangeOutputFrames: number; deliveryOutputFrames: number }>,
): Encoding {
	if (options.embedLabelChapters !== true) return encoding;
	assertEmbeddedChapterRequest(encoding.format, options);
	const sampleRate = Number(encoding.sampleRate);
	const chapters = resolveEmbeddedExportChapters(project, range, sampleRate, output);
	if (chapters.length === 0) throw new RangeError('No labels occur in the exported range.');
	return Object.freeze({
		...encoding,
		...embeddedChapterEncodingFields(encoding.format, chapters, sampleRate),
	});
}
