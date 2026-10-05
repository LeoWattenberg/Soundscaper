/* SPDX-License-Identifier: AGPL-3.0-only */

type DataRecord = Readonly<Record<string, unknown>>;

// Match label import's limits so names accepted there remain exportable.
const MAX_CHAPTERS = 100_000;
const MAX_TITLE_CHARS = 1_000_000;
const MAX_TOTAL_TITLE_CHARS = 8 * 1024 * 1024;

/** Chapter bounds relative to the delivered audio, in its output sample frames. */
export interface EmbeddedExportChapter {
	readonly startFrame: number;
	readonly endFrame: number;
	readonly title: string;
}

interface EmbeddedExportRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

/** Containers for which the single-file audio export embeds chapter metadata. */
export function supportsEmbeddedExportChapters(format: unknown): boolean {
	return format === 'mp3' || format === 'aac-m4a';
}

/**
 * Read chapters from every label track and clip them to the project-frame range.
 *
 * Region labels keep their own ends. Point labels extend to the next distinct
 * start, or the export end. Coincident labels retain track and label order;
 * their titles remain independent, including identical and empty names.
 * The returned bounds are rebased and converted to output sample frames.
 */
export function resolveEmbeddedExportChapters(
	projectValue: unknown,
	range: EmbeddedExportRange,
	outputSampleRate?: number,
	options: Readonly<{ rangeOutputFrames?: number; deliveryOutputFrames?: number }> = {},
): readonly EmbeddedExportChapter[] {
	const project = dataRecord(projectValue);
	const projectSampleRate = sampleRate(project.sampleRate);
	const targetSampleRate = sampleRate(outputSampleRate ?? projectSampleRate);
	const rangeStart = nonNegativeFrame(range.startFrame, 'Export range start');
	const rangeEnd = nonNegativeFrame(range.endFrame, 'Export range end');
	if (rangeEnd <= rangeStart) throw new RangeError('The export range must end after it starts.');
	const roundedRangeFrames = outputFrame(rangeEnd - rangeStart, projectSampleRate, targetSampleRate);
	const rangeOutputFrames = options.rangeOutputFrames === undefined
		? roundedRangeFrames : outputFrameCount(options.rangeOutputFrames, roundedRangeFrames, 'Range output frames');
	const deliveryOutputFrames = options.deliveryOutputFrames === undefined
		? rangeOutputFrames : outputFrameCount(options.deliveryOutputFrames, rangeOutputFrames, 'Delivery output frames');
	const boundaries = labelBoundaries(project);
	const chapters: EmbeddedExportChapter[] = [];
	let nextStart = rangeEnd;
	// Resolve point ends backwards, so coincident starts share the next distinct
	// boundary without repeatedly searching every following label.
	for (let index = boundaries.length - 1; index >= 0; index -= 1) {
		const boundary = boundaries[index]!;
		const following = boundaries[index + 1];
		if (following && following.startFrame > boundary.startFrame) nextStart = following.startFrame;
		const openEnd = boundary.endFrame > boundary.startFrame ? boundary.endFrame : nextStart;
		const clippedStart = Math.max(boundary.startFrame, rangeStart);
		const clippedEnd = Math.min(openEnd, rangeEnd);
		if (clippedEnd <= clippedStart) continue;
		const roundedStart = outputFrame(clippedStart - rangeStart, projectSampleRate, targetSampleRate);
		// A start inside the range can round onto its exclusive end after
		// downsampling. The actual render still contains its final output frame.
		const startFrame = options.rangeOutputFrames === undefined
			? roundedStart : Math.min(roundedStart, rangeOutputFrames - 1);
		const endFrame = clippedEnd === rangeEnd
			? boundary.endFrame === boundary.startFrame && openEnd >= rangeEnd
				? deliveryOutputFrames : rangeOutputFrames
			: outputFrame(clippedEnd - rangeStart, projectSampleRate, targetSampleRate);
		if (endFrame <= startFrame) continue;
		chapters.push({ startFrame, endFrame, title: boundary.title });
	}
	chapters.reverse();
	return normalizeEmbeddedExportChapters(chapters, targetSampleRate);
}

/** Validate and take an immutable copy of chapter data crossing an export boundary. */
export function normalizeEmbeddedExportChapters(
	value: unknown,
	outputSampleRate: number,
): readonly EmbeddedExportChapter[] {
	sampleRate(outputSampleRate);
	if (!Array.isArray(value)) throw new RangeError('Embedded chapters must be an array.');
	if (value.length > MAX_CHAPTERS) throw new RangeError('Embedded chapters exceed the chapter count limit.');
	let previousStart = 0;
	let totalTitleChars = 0;
	const chapters: EmbeddedExportChapter[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const chapter = plainRecord(ownValue(value, String(index)));
		const startFrame = nonNegativeFrame(ownValue(chapter, 'startFrame'), 'Chapter start');
		const endFrame = nonNegativeFrame(ownValue(chapter, 'endFrame'), 'Chapter end');
		if (endFrame <= startFrame) throw new RangeError('A chapter must end after it starts.');
		if (startFrame < previousStart) throw new RangeError('Embedded chapters must be ordered by start frame.');
		previousStart = startFrame;
		const title = ownValue(chapter, 'title');
		if (typeof title !== 'string') throw new RangeError('A chapter title must be a string.');
		if (title.includes('\0')) throw new RangeError('A chapter title cannot contain NUL characters.');
		if (title.length > MAX_TITLE_CHARS) throw new RangeError('A chapter title exceeds the title size limit.');
		totalTitleChars += title.length;
		if (totalTitleChars > MAX_TOTAL_TITLE_CHARS) throw new RangeError('Embedded chapters exceed the total title size limit.');
		chapters.push(Object.freeze({ startFrame, endFrame, title }));
	}
	return Object.freeze(chapters);
}

/** FFmetadata consumes the same output-frame timebase carried by each chapter. */
export function serializeEmbeddedExportChapters(
	chapters: readonly EmbeddedExportChapter[],
	outputSampleRate: number,
	options: Readonly<{ includeTitles?: boolean }> = {},
): string {
	const normalized = normalizeEmbeddedExportChapters(chapters, outputSampleRate);
	const lines = [';FFMETADATA1'];
	for (const chapter of normalized) {
		lines.push(
			'[CHAPTER]',
			`TIMEBASE=1/${String(outputSampleRate)}`,
			`START=${String(chapter.startFrame)}`,
			`END=${String(chapter.endFrame)}`,
		);
		if (options.includeTitles !== false) {
			lines.push(`title=${chapter.title.replace(/[\\=;#\r\n]/gu, (character) => `\\${character}`)}`);
		}
	}
	return `${lines.join('\n')}\n`;
}

function labelBoundaries(project: DataRecord): readonly EmbeddedExportChapter[] {
	const tracks = Array.isArray(project.tracks) ? project.tracks : [];
	const boundaries: EmbeddedExportChapter[] = [];
	for (const value of tracks) {
		const track = dataRecord(value);
		if (track.type !== 'label' || !Array.isArray(track.labels)) continue;
		for (const value of track.labels) {
			const label = dataRecord(value);
			const startFrame = nonNegativeFrame(label.startFrame, 'Label start');
			const endFrame = nonNegativeFrame(label.endFrame ?? startFrame, 'Label end');
			if (endFrame < startFrame) throw new RangeError('A label cannot end before it starts.');
			boundaries.push({ startFrame, endFrame, title: String(label.title ?? '') });
		}
	}
	return boundaries.sort((left, right) => left.startFrame - right.startFrame);
}

function outputFrame(projectFrame: number, projectSampleRate: number, outputSampleRate: number): number {
	// Integer arithmetic keeps conversion exact even when the intermediate
	// product exceeds Number's safe integer range. Ties round upwards like the
	// export's non-negative Math.round frame counts.
	const denominator = BigInt(projectSampleRate);
	const numerator = BigInt(projectFrame) * BigInt(outputSampleRate);
	const converted = Number((numerator + denominator / 2n) / denominator);
	return nonNegativeFrame(converted, 'Output chapter frame');
}

function outputFrameCount(value: unknown, minimum: number, name: string): number {
	const frames = nonNegativeFrame(value, name);
	if (frames < Math.max(1, minimum)) throw new RangeError(`${name} must cover the nominal export range.`);
	return frames;
}

function sampleRate(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
		throw new RangeError('The chapter sample rate must be a positive 32-bit integer.');
	}
	return value;
}

function nonNegativeFrame(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative safe integer.`);
	}
	return value;
}

function plainRecord(value: unknown): DataRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new RangeError('Each embedded chapter must be a plain object.');
	}
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new RangeError('Each embedded chapter must be a plain object.');
	}
	return value as DataRecord;
}

function ownValue(record: object, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new RangeError(`A chapter must have its own ${key} value.`);
	}
	return descriptor.value as unknown;
}

function dataRecord(value: unknown): DataRecord {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as DataRecord
		: {};
}
