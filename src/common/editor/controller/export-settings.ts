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

export interface EditorExportSettings {
	readonly mode: 'mix' | 'stems';
	readonly range: 'project' | 'selection' | 'loop';
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
		mode: format === 'bw64' ? 'mix' : value.mode === 'stems' ? 'stems' : 'mix',
		range: value.range === 'selection' || value.range === 'loop' ? value.range : 'project',
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
