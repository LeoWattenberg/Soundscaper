/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BextMetadataInput } from '../broadcast-wave.ts';
import {
	type LoudnessNormalizationTarget,
	normalizeLoudnessNormalizationTarget,
} from '../loudness-normalization.ts';

export const EDITOR_EXPORT_FORMATS = Object.freeze([
	'wav',
	'bwf',
	'bw64',
	'aiff',
	'flac',
	'mp3',
	'ogg-vorbis',
	'opus',
	'wavpack',
	'mp2',
	'aac-m4a',
	'custom-ffmpeg',
] as const);

export type EditorExportFormat = typeof EDITOR_EXPORT_FORMATS[number];

/** An explicit delivered range, resolved before the settings were queued. */
export interface EditorExportFrameRange {
	readonly startFrame: number;
	readonly endFrame: number;
}

export interface EditorExportSettings {
	readonly mode: 'mix' | 'stems' | 'chapters';
	readonly range: 'project' | 'selection' | 'loop' | EditorExportFrameRange;
	readonly format: EditorExportFormat;
	readonly bitDepth: 16 | 20 | 24 | 32;
	readonly sampleFormat: unknown;
	readonly dither: unknown;
	readonly bitRate: number | undefined;
	readonly quality: number | undefined;
	readonly compressionLevel: number | undefined;
	readonly sampleRate: number;
	readonly channelMapping: unknown;
	readonly metadata: unknown;
	readonly bext?: BextMetadataInput | null;
	readonly adm?: unknown;
	readonly extension: unknown;
	readonly mimeType: unknown;
	readonly customArguments: unknown;
	readonly includeTail: boolean;
	readonly measureLoudness: boolean;
	/** Render an authored ADM programme to two channels for headphones. */
	readonly binaural: boolean;
	/** A preset name or explicit target resolved to numbers, or null when not asked for. */
	readonly loudnessNormalization: LoudnessNormalizationTarget | null;
	/**
	 * The mastering sequence this delivery realizes, or null for the ordinary
	 * range delivery. Off by default: a sequence delivery is something asked for.
	 */
	readonly masteringSequenceId: string | null;
}

export function normalizeEditorExportSettings(
	value: Readonly<Record<string, unknown>> = {},
	projectSampleRate: number,
	projectMetadata: unknown = {},
): Readonly<EditorExportSettings> {
	const format = isExportFormat(value.format) ? value.format : 'wav';
	const defaultBitRate = format === 'opus' ? 160 : format === 'mp2' ? 256 : 192;
	const requestedBitDepth = Number(value.bitDepth);
	const bitDepth = requestedBitDepth === 16 || requestedBitDepth === 20 || requestedBitDepth === 32
		? requestedBitDepth
		: 24;
	const quality = numberOrDefault(value.quality, 5);
	const compressionLevel = numberOrDefault(value.compressionLevel, format === 'flac' ? 5 : 2);
	return Object.freeze({
		mode: format === 'bw64' || (value.mode !== 'stems' && value.mode !== 'chapters')
			? 'mix'
			: value.mode,
		range: normalizeExportRange(value.range),
		format,
		bitDepth,
		sampleFormat: value.sampleFormat || (bitDepth === 32 ? 'float32' : `int${bitDepth}`),
		dither: value.dither ?? (bitDepth < 32 ? 'triangular' : 'none'),
		bitRate: isBitRateFormat(format) ? Number(value.bitRate) || defaultBitRate : undefined,
		quality: format === 'ogg-vorbis' ? quality : undefined,
		compressionLevel: format === 'flac' || format === 'wavpack' ? compressionLevel : undefined,
		sampleRate: value.sampleRate == null || value.sampleRate === ''
			? projectSampleRate
			: Number(value.sampleRate),
		channelMapping: value.channelMapping || 'preserve',
		metadata: value.metadata || projectMetadata,
		...((format === 'bwf' || format === 'bw64') ? {
			bext: value.bext as BextMetadataInput | null | undefined,
		} : {}),
		...(format === 'bw64' ? { adm: value.adm } : {}),
		extension: value.extension,
		mimeType: value.mimeType,
		customArguments: value.customArguments,
		includeTail: value.includeTail !== false,
		measureLoudness: value.measureLoudness === true,
		binaural: value.binaural === true,
		loudnessNormalization: normalizeLoudnessNormalizationTarget(value.loudnessNormalization),
		masteringSequenceId: typeof value.masteringSequenceId === 'string' && value.masteringSequenceId !== ''
			? value.masteringSequenceId
			: null,
	});
}

function isExportFormat(value: unknown): value is EditorExportFormat {
	return typeof value === 'string' && (EDITOR_EXPORT_FORMATS as readonly string[]).includes(value);
}

function isBitRateFormat(format: EditorExportFormat): boolean {
	return format === 'mp3' || format === 'opus' || format === 'mp2' || format === 'aac-m4a';
}

function numberOrDefault(value: unknown, fallback: number): number {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

/**
 * Keep an already-resolved range, rather than collapsing it to the whole project.
 *
 * A batch member names its material once, when the batch is built, and freezes
 * the frames it resolved to; the queue then replays those settings through this
 * normalizer on its way to the export. Accepting only the words left every such
 * member delivering the entire project under the label of the region, selection,
 * or loop it was queued for.
 */
function normalizeExportRange(value: unknown): EditorExportSettings['range'] {
	if (value === 'selection' || value === 'loop') return value;
	if (!value || typeof value !== 'object') return 'project';
	const record = value as Readonly<Record<string, unknown>>;
	const startFrame = Number(record.startFrame);
	const endFrame = Number(record.endFrame);
	if (!Number.isSafeInteger(startFrame) || startFrame < 0) return 'project';
	if (!Number.isSafeInteger(endFrame) || endFrame <= startFrame) return 'project';
	return Object.freeze({ startFrame, endFrame });
}
