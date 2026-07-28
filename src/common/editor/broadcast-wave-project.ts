/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	appendPcmCodingHistory,
	normalizeBextMetadata,
	type BextMetadata,
	type BextMetadataInput,
} from './broadcast-wave.ts';

const MAX_UINT64 = (1n << 64n) - 1n;

interface BextProjectLike {
	readonly title?: unknown;
	readonly createdAt?: unknown;
	readonly sampleRate?: unknown;
	readonly metadata?: Readonly<{
		readonly title?: unknown;
		readonly artist?: unknown;
		readonly bext?: BextMetadataInput | null;
	}>;
}

export interface BwfExportMetadataOptions {
	readonly bext?: BextMetadataInput | null;
	readonly rangeStartFrame?: number;
	readonly outputSampleRate: number;
	readonly bitDepth: number;
	readonly channelCount: number;
	readonly productName?: string;
}

export function deriveProjectBextDefaults(project: BextProjectLike): BextMetadata {
	const created = new Date(String(project.createdAt ?? ''));
	const timestamp = Number.isNaN(created.getTime()) ? '' : created.toISOString();
	return normalizeBextMetadata({
		description: asciiDefault(project.metadata?.title ?? project.title, 256),
		originator: asciiDefault(project.metadata?.artist, 32),
		originationDate: timestamp ? timestamp.slice(0, 10) : '',
		originationTime: timestamp ? timestamp.slice(11, 19) : '',
		timeReference: '0',
	}, { version: 2 });
}

export function projectBextMetadata(project: BextProjectLike): BextMetadata {
	return project.metadata?.bext == null
		? deriveProjectBextDefaults(project)
		: normalizeBextMetadata(project.metadata.bext, { version: 2 });
}

export function createBwfExportMetadata(
	project: BextProjectLike,
	options: BwfExportMetadataOptions,
): BextMetadata {
	const projectRate = positiveSampleRate(project.sampleRate, 'Project sample rate');
	const outputRate = positiveSampleRate(options.outputSampleRate, 'BWF output sample rate');
	const rangeStartFrame = nonNegativeFrame(options.rangeStartFrame ?? 0);
	if (!Number.isSafeInteger(options.channelCount) || options.channelCount < 1 || options.channelCount > 32) {
		throw new RangeError('BWF output must contain one to 32 channels.');
	}
	const base = projectBextMetadata(project);
	const authoring = normalizeBextMetadata({
		...base,
		...(options.bext ?? {}),
	}, { version: 2 });
	const projectReference = parseUint64(authoring.timeReference, 'BEXT TimeReference');
	const absoluteProjectReference = projectReference + BigInt(rangeStartFrame);
	const timeReference = scaleSampleCount(absoluteProjectReference, projectRate, outputRate);
	const codingHistory = appendPcmCodingHistory(authoring.codingHistory, {
		sampleRate: outputRate,
		bitDepth: options.bitDepth,
		channelCount: options.channelCount,
		product: options.productName || 'Soundscaper',
	});
	return normalizeBextMetadata({ ...authoring, timeReference, codingHistory }, { version: 2 });
}

export function scaleBextTimeReference(
	value: string,
	inputSampleRate: number,
	outputSampleRate: number,
): string {
	return scaleSampleCount(
		parseUint64(value, 'BEXT TimeReference'),
		positiveSampleRate(inputSampleRate, 'Input sample rate'),
		positiveSampleRate(outputSampleRate, 'Output sample rate'),
	);
}

function scaleSampleCount(value: bigint, inputRate: number, outputRate: number): string {
	const numerator = value * BigInt(outputRate);
	const denominator = BigInt(inputRate);
	const scaled = (numerator + denominator / 2n) / denominator;
	if (scaled > MAX_UINT64) throw new RangeError('Converted BEXT TimeReference exceeds unsigned 64-bit samples.');
	return scaled.toString();
}

function parseUint64(value: string, name: string): bigint {
	if (!/^\d+$/u.test(value)) throw new RangeError(`${name} must be an unsigned 64-bit decimal string.`);
	const parsed = BigInt(value);
	if (parsed > MAX_UINT64) throw new RangeError(`${name} must be an unsigned 64-bit decimal string.`);
	return parsed;
}

function positiveSampleRate(value: unknown, name: string): number {
	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 1) throw new RangeError(`${name} must be a positive integer.`);
	return number;
}

function nonNegativeFrame(value: number): number {
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Export range start must be a non-negative integer frame.');
	return value;
}

function asciiDefault(value: unknown, maximumLength: number): string {
	return String(value ?? '')
		.replaceAll('\u00df', 'ss')
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.replace(/[^\x20-\x7e]/gu, '?')
		.slice(0, maximumLength);
}
