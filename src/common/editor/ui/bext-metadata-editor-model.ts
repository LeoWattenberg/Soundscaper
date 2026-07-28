import { deriveProjectBextDefaults } from '../broadcast-wave-project.ts';

export interface BextMetadataEditorValue {
	readonly version: 2;
	readonly description: string;
	readonly originator: string;
	readonly originatorReference: string;
	readonly originationDate: string;
	readonly originationTime: string;
	readonly timeReference: string;
	readonly umid: string;
	readonly loudnessValue: number | null;
	readonly loudnessRange: number | null;
	readonly maxTruePeakLevel: number | null;
	readonly maxMomentaryLoudness: number | null;
	readonly maxShortTermLoudness: number | null;
	readonly codingHistory: string;
}

interface BextProjectLike {
	readonly title?: unknown;
	readonly createdAt?: unknown;
	readonly metadata?: unknown;
}

const UINT64_MAX = 18_446_744_073_709_551_615n;

function objectValue(value: unknown): Readonly<Record<string, unknown>> {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: {};
}

function textValue(value: unknown): string {
	return value == null ? '' : String(value);
}

function optionalNumber(value: unknown): number | null {
	if (value == null || value === '') return null;
	const number = typeof value === 'number' ? value : Number(value);
	return Number.isFinite(number) ? number : null;
}

function timeReferenceValue(value: unknown): string {
	const text = textValue(value).trim();
	if (!/^\d+$/u.test(text)) return text;
	try {
		const samples = BigInt(text);
		return samples <= UINT64_MAX ? samples.toString() : text;
	} catch {
		return text;
	}
}

export function normalizeBextMetadataEditorValue(value: unknown): BextMetadataEditorValue {
	const source = objectValue(value);
	return {
		version: 2,
		description: textValue(source.description),
		originator: textValue(source.originator),
		originatorReference: textValue(source.originatorReference),
		originationDate: textValue(source.originationDate),
		originationTime: textValue(source.originationTime),
		timeReference: timeReferenceValue(source.timeReference),
		umid: textValue(source.umid),
		loudnessValue: optionalNumber(source.loudnessValue),
		loudnessRange: optionalNumber(source.loudnessRange),
		maxTruePeakLevel: optionalNumber(source.maxTruePeakLevel),
		maxMomentaryLoudness: optionalNumber(source.maxMomentaryLoudness),
		maxShortTermLoudness: optionalNumber(source.maxShortTermLoudness),
		codingHistory: textValue(source.codingHistory).replace(/\r\n?/gu, '\n'),
	};
}

export function createBextMetadataEditorValue(project: BextProjectLike | null | undefined): BextMetadataEditorValue {
	const metadata = objectValue(project?.metadata);
	if (metadata.bext != null) return normalizeBextMetadataEditorValue(metadata.bext);
	return normalizeBextMetadataEditorValue(deriveProjectBextDefaults({
		title: project?.title,
		createdAt: project?.createdAt,
		metadata: {
			title: metadata.title,
			artist: metadata.artist,
			bext: null,
		},
	}));
}
