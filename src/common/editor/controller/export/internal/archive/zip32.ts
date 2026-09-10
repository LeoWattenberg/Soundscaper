/* SPDX-License-Identifier: AGPL-3.0-only */

export const ZIP32_UINT16_SENTINEL = 0xffff;
export const ZIP32_UINT32_SENTINEL = 0xffff_ffff;

export interface Zip32EntryLayout {
	readonly fileName: string;
	readonly byteLength: number;
}

export interface Zip32Layout {
	readonly eligible: boolean;
	readonly entryCount: number;
	readonly localByteLength: number;
	readonly centralDirectoryByteLength: number;
	readonly archiveByteLength: number;
}

export const EMPTY_ZIP32_LAYOUT: Zip32Layout = Object.freeze({
	eligible: true,
	entryCount: 0,
	localByteLength: 0,
	centralDirectoryByteLength: 0,
	archiveByteLength: 22,
});

const textEncoder = new TextEncoder();

export function extendZip32Layout(
	layout: Zip32Layout,
	entry: Zip32EntryLayout,
): Zip32Layout {
	validateEntry(entry);
	const nameByteLength = textEncoder.encode(entry.fileName).byteLength;
	const entryCount = layout.entryCount + 1;
	const localByteLength = addSafeIntegers(
		layout.localByteLength,
		entry.byteLength,
		46,
		nameByteLength,
	);
	const centralDirectoryByteLength = addSafeIntegers(
		layout.centralDirectoryByteLength,
		46,
		nameByteLength,
	);
	return Object.freeze({
		eligible: layout.eligible
			&& entryCount < ZIP32_UINT16_SENTINEL
			&& nameByteLength < ZIP32_UINT16_SENTINEL
			&& entry.byteLength < ZIP32_UINT32_SENTINEL
			&& localByteLength < ZIP32_UINT32_SENTINEL
			&& centralDirectoryByteLength < ZIP32_UINT32_SENTINEL,
		entryCount,
		localByteLength,
		centralDirectoryByteLength,
		archiveByteLength: addSafeIntegers(localByteLength, centralDirectoryByteLength, 22),
	});
}

export function inspectZip32Layout(entries: readonly Zip32EntryLayout[]): Zip32Layout {
	return entries.reduce(extendZip32Layout, EMPTY_ZIP32_LAYOUT);
}

function validateEntry(entry: Zip32EntryLayout): void {
	if (!isFlatArchiveName(entry.fileName)) {
		throw new TypeError('Archive entry names must be flat, nonempty, and cannot contain NUL characters.');
	}
	if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) {
		throw new RangeError('Archive entry sizes must be nonnegative safe integers.');
	}
}

function isFlatArchiveName(fileName: string): boolean {
	return Boolean(fileName)
		&& fileName !== '.'
		&& fileName !== '..'
		&& !fileName.includes('\0')
		&& !fileName.includes('/')
		&& !fileName.includes('\\');
}

function addSafeIntegers(...values: readonly number[]): number {
	let sum = 0;
	for (const value of values) {
		if (!Number.isSafeInteger(value) || value < 0 || sum > Number.MAX_SAFE_INTEGER - value) {
			throw new RangeError('Archive size exceeds JavaScript\'s safe-integer range.');
		}
		sum += value;
	}
	return sum;
}
