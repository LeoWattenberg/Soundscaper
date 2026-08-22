/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoSourceCharacteristics,
	type VideoSourceCharacteristics,
} from '../common/editor/video-source-characteristics.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';

/** Build the exact transient V24 source shape without weakening its validator. */
export function framescaperProjectV24FoundationShapeV25(
	project: unknown,
): Record<string, unknown> {
	const candidate = record(project, 'Framescaper V25 project');
	const foundation = structuredClone(candidate) as Record<string, unknown>;
	foundation.schemaVersion = 24;
	foundation.sources = records(foundation.sources, 'sources').map((source) => {
		if (source.kind !== 'video') return source;
		delete source.imageSequence;
		source.characteristics = framescaperVideoSourceCharacteristicsV24ProjectionV25(source);
		return source;
	});
	return foundation;
}

/** Drop only V25's professional additions; all inherited facts stay authoritative. */
export function framescaperVideoSourceCharacteristicsV24ProjectionV25(
	source: Readonly<Record<string, unknown>>,
): VideoSourceCharacteristics {
	const professional = normalizeVideoSourceCharacteristicsV25(source.characteristics, {
		rate: sourceRate(source),
	});
	return normalizeVideoSourceCharacteristics({
		backend: professional.backend,
		codedWidth: professional.codedWidth,
		codedHeight: professional.codedHeight,
		rotationDegrees: professional.rotationDegrees,
		pixelAspectRatio: professional.pixelAspectRatio,
		fieldOrder: professional.fieldOrder,
		hasAlpha: professional.hasAlpha,
		videoCodec: professional.videoCodec,
		colour: {
			primaries: professional.colour.primaries,
			transfer: professional.colour.transfer,
			matrix: professional.colour.matrix,
			range: professional.colour.range,
		},
		audioStreams: professional.audioStreams,
		extractedAudioStreamIndex: professional.extractedAudioStreamIndex,
		startTimecode: professional.startTimecode,
	}, { rate: sourceRate(source) });
}

export function framescaperVideoSourceRateV25(
	source: Readonly<Record<string, unknown>>,
): Readonly<{ num: number; den: number }> | undefined {
	return sourceRate(source);
}

function sourceRate(source: Readonly<Record<string, unknown>>): Readonly<{ num: number; den: number }> | undefined {
	const value = source.frameRate;
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const rate = value as Record<string, unknown>;
	if (!Number.isSafeInteger(rate.num) || Number(rate.num) <= 0
		|| !Number.isSafeInteger(rate.den) || Number(rate.den) <= 0) return undefined;
	return Object.freeze({ num: Number(rate.num), den: Number(rate.den) });
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
