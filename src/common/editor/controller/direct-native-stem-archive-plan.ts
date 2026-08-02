/* SPDX-License-Identifier: AGPL-3.0-only */

import { sevenZipCopyArchiveByteLength } from './sequential-seven-zip-copy.ts';
import { inspectZip32Layout, type Zip32Layout } from './zip32.ts';

export type DirectNativeStemFormat = 'wav' | 'bwf' | 'aiff';
export type DirectNativeStemArchiveFormat = 'zip' | '7z';

export interface DirectNativeStemArchiveOutput {
	readonly fileName: string;
	readonly trackId: string;
}

interface DirectNativeStemArchiveEntryPlan {
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
}

interface DirectNativeStemArchivePlanArchive {
	readonly entries?: unknown;
	readonly expectedByteLength?: unknown;
	readonly fileName?: unknown;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly zip32?: unknown;
}

export interface DirectNativeStemArchivePlan {
	readonly archive?: DirectNativeStemArchivePlanArchive | null;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
}

export interface DirectNativeStemArchiveContract {
	readonly kind: 'exact-native-pcm';
	readonly archiveByteLength: number;
	readonly archiveFileName: string;
	readonly archiveFormat: DirectNativeStemArchiveFormat;
	readonly archiveMimeType: 'application/zip' | 'application/x-7z-compressed';
	readonly entryByteLength: number;
	readonly format: DirectNativeStemFormat;
	readonly outputs: readonly DirectNativeStemArchiveOutput[];
	readonly stagingByteLength: number;
	readonly zip32: Zip32Layout;
}

const NATIVE_FORMATS = Object.freeze({
	wav: Object.freeze({ extension: '.wav', mimeType: 'audio/wav' }),
	bwf: Object.freeze({ extension: '.wav', mimeType: 'audio/wav' }),
	aiff: Object.freeze({ extension: '.aiff', mimeType: 'audio/aiff' }),
} satisfies Readonly<Record<DirectNativeStemFormat, Readonly<{
	extension: string;
	mimeType: string;
}>>>);

const ARCHIVE_FORMATS = Object.freeze({
	zip: Object.freeze({ extension: '.zip', mimeType: 'application/zip' as const }),
	'7z': Object.freeze({ extension: '.7z', mimeType: 'application/x-7z-compressed' as const }),
} satisfies Readonly<Record<DirectNativeStemArchiveFormat, Readonly<{
	extension: string;
	mimeType: DirectNativeStemArchiveContract['archiveMimeType'];
}>>>);

/** Capture the immutable exact geometry shared by direct native ZIP and 7z stems. */
export function captureDirectNativeStemArchiveContract(
	value: unknown,
): DirectNativeStemArchiveContract | null {
	try {
		const plan = record(value);
		const format = nativeFormat(ownValue(plan, 'format'));
		const formatDetails = format ? NATIVE_FORMATS[format] : null;
		const archive = record(ownValue(plan, 'archive'));
		const archiveFormat = archiveFormatId(ownValue(archive, 'format'));
		const archiveDetails = archiveFormat ? ARCHIVE_FORMATS[archiveFormat] : null;
		const entryByteLength = ownValue(plan, 'outputFileBytesPerRender');
		const outputsValue = ownValue(plan, 'outputs');
		const entriesValue = ownValue(archive, 'entries');
		const archiveFileName = ownValue(archive, 'fileName');
		const archiveByteLength = ownValue(archive, 'expectedByteLength');
		if (!plan || !format || !formatDetails || !archive || !archiveFormat || !archiveDetails
			|| ownValue(plan, 'mode') !== 'stems'
			|| ownValue(plan, 'mimeType') !== formatDetails.mimeType
			|| !positiveSafeInteger(entryByteLength)
			|| !Array.isArray(outputsValue)
			|| outputsValue.length < 1
			|| !Array.isArray(entriesValue)
			|| entriesValue.length !== outputsValue.length
			|| ownValue(archive, 'mimeType') !== archiveDetails.mimeType
			|| typeof archiveFileName !== 'string'
			|| !flatFileName(archiveFileName, archiveDetails.extension)
			|| !positiveSafeInteger(archiveByteLength)) return null;

		const outputs: DirectNativeStemArchiveOutput[] = [];
		const entries: Array<{ readonly fileName: string; readonly expectedByteLength: number }> = [];
		const names = new Set<string>();
		const trackIds = new Set<string>();
		for (const [index, outputValue] of outputsValue.entries()) {
			const output = record(outputValue);
			const entry = record(entriesValue[index] as DirectNativeStemArchiveEntryPlan | undefined);
			const fileName = ownValue(output, 'fileName');
			const trackId = ownValue(output, 'trackId');
			if (!output || !entry
				|| typeof fileName !== 'string'
				|| !flatFileName(fileName, formatDetails.extension)
				|| typeof trackId !== 'string'
				|| !trackId
				|| ownValue(entry, 'fileName') !== fileName
				|| ownValue(entry, 'expectedByteLength') !== entryByteLength
				|| names.has(fileName)
				|| trackIds.has(trackId)) return null;
			names.add(fileName);
			trackIds.add(trackId);
			outputs.push(Object.freeze({ fileName, trackId }));
			entries.push(Object.freeze({ fileName, expectedByteLength: entryByteLength }));
		}

		const recomputedZip32 = inspectZip32Layout(entries.map((entry) => ({
			fileName: entry.fileName,
			byteLength: entry.expectedByteLength,
		})));
		const plannedZip32 = captureZip32Layout(ownValue(archive, 'zip32'));
		if (!plannedZip32 || !sameZip32Layout(plannedZip32, recomputedZip32)
			|| (archiveFormat === 'zip'
				? !recomputedZip32.eligible || archiveByteLength !== recomputedZip32.archiveByteLength
				: archiveByteLength !== sevenZipCopyArchiveByteLength(entries))) return null;

		return Object.freeze({
			kind: 'exact-native-pcm',
			archiveByteLength,
			archiveFileName,
			archiveFormat,
			archiveMimeType: archiveDetails.mimeType,
			entryByteLength,
			format,
			outputs: Object.freeze(outputs),
			stagingByteLength: entryByteLength,
			zip32: plannedZip32,
		});
	} catch {
		return null;
	}
}

/** Compare every field that can affect native stem rendering or archive publication. */
export function sameDirectNativeStemArchiveContract(
	left: DirectNativeStemArchiveContract,
	right: DirectNativeStemArchiveContract,
): boolean {
	return left.kind === right.kind
		&& left.format === right.format
		&& left.archiveFormat === right.archiveFormat
		&& left.archiveMimeType === right.archiveMimeType
		&& left.archiveFileName === right.archiveFileName
		&& left.archiveByteLength === right.archiveByteLength
		&& left.entryByteLength === right.entryByteLength
		&& left.stagingByteLength === right.stagingByteLength
		&& sameZip32Layout(left.zip32, right.zip32)
		&& left.outputs.length === right.outputs.length
		&& left.outputs.every((output, index) => (
			output.fileName === right.outputs[index]?.fileName
			&& output.trackId === right.outputs[index]?.trackId
		));
}

function captureZip32Layout(value: unknown): Zip32Layout | null {
	const layout = record(value);
	const eligible = ownValue(layout, 'eligible');
	const entryCount = ownValue(layout, 'entryCount');
	const localByteLength = ownValue(layout, 'localByteLength');
	const centralDirectoryByteLength = ownValue(layout, 'centralDirectoryByteLength');
	const archiveByteLength = ownValue(layout, 'archiveByteLength');
	if (!layout || typeof eligible !== 'boolean'
		|| !nonnegativeSafeInteger(entryCount)
		|| !nonnegativeSafeInteger(localByteLength)
		|| !nonnegativeSafeInteger(centralDirectoryByteLength)
		|| !nonnegativeSafeInteger(archiveByteLength)) return null;
	return Object.freeze({
		eligible,
		entryCount,
		localByteLength,
		centralDirectoryByteLength,
		archiveByteLength,
	});
}

function sameZip32Layout(left: Zip32Layout, right: Zip32Layout): boolean {
	return left.eligible === right.eligible
		&& left.entryCount === right.entryCount
		&& left.localByteLength === right.localByteLength
		&& left.centralDirectoryByteLength === right.centralDirectoryByteLength
		&& left.archiveByteLength === right.archiveByteLength;
}

function nativeFormat(value: unknown): DirectNativeStemFormat | null {
	return value === 'wav' || value === 'bwf' || value === 'aiff' ? value : null;
}

function archiveFormatId(value: unknown): DirectNativeStemArchiveFormat | null {
	return value === 'zip' || value === '7z' ? value : null;
}

function flatFileName(value: string, suffix: string): boolean {
	return value.length > suffix.length
		&& value.toLowerCase().endsWith(suffix)
		&& value !== '.'
		&& value !== '..'
		&& !/[\u0000-\u001f\u007f]/u.test(value)
		&& !value.includes('/')
		&& !value.includes('\\');
}

function positiveSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function nonnegativeSafeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return Boolean(value && typeof value === 'object' && !Array.isArray(value))
		? value as Readonly<Record<string, unknown>>
		: null;
}

function ownValue(value: Readonly<Record<string, unknown>> | null, field: string): unknown {
	if (!value) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined;
}
