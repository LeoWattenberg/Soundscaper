/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { open, rm, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';

import { createAudioEditorProjectV9 } from '../../src/common/editor/project-v9.ts';

const TEXT_ENCODER = new TextEncoder();
const LOGICAL_ARCHIVE_BYTES = 8 * 1024 ** 3;
const PROBE_LOGICAL_BYTES = 64 * 1024 ** 2;
const MAXIMUM_FIXTURE_ALLOCATION_BYTES = 8 * 1024 ** 2;
const LOCAL_FIXED_BYTES = 30;
const CENTRAL_FIXED_BYTES = 46;
const ZIP64_SIZE_EXTRA_BYTES = 20;
const ZIP64_OFFSET_EXTRA_BYTES = 12;
const ZIP64_END_BYTES = 56;
const ZIP64_LOCATOR_BYTES = 20;
const CLASSIC_END_BYTES = 22;
const ZIP64_TAIL_BYTES = ZIP64_END_BYTES + ZIP64_LOCATOR_BYTES + CLASSIC_END_BYTES;
const UINT32_SENTINEL = 0xffff_ffff;
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;
const DOS_DATE_1980_01_01 = 0x0021;
const PROJECT_ID = 'sparse-eight-gib-project';
const VIDEO_SOURCE_ID = 'video-source';
const VIDEO_ENTRY = 'media/video-source/original';
// The sparse hole reads as this exact number of zero bytes. These pinned values
// are the SHA-256 and ZIP CRC-32 of that logical body, not fixture placeholders.
const ZERO_ASSET_BYTES = 8_589_932_094;
const ZERO_ASSET_SHA256 = '7feeb1e9eacb6561f3c5afb4ebf3896c8237660a9b4ed8917d3275c79bed38be';
const ZERO_ASSET_CRC32 = 2_909_126_900;

interface ArchiveEntryPlan {
	readonly name: string;
	readonly bytes: Uint8Array | null;
	readonly size: number;
	readonly crc32: number;
	readonly zip64Size: boolean;
	readonly zip64Offset: boolean;
	readonly localOffset: number;
	readonly dataOffset: number;
	readonly endOffset: number;
}

interface ArchivePlan {
	readonly entries: readonly ArchiveEntryPlan[];
	readonly centralOffset: number;
	readonly centralSize: number;
	readonly zip64EndOffset: number;
	readonly zip64LocatorOffset: number;
	readonly classicEndOffset: number;
}

export interface SparseFileProbe {
	readonly supported: boolean;
	readonly reason: string;
}

export interface SparseScapeEntryBoundary {
	readonly name: string;
	readonly localOffset: number;
	readonly dataOffset: number;
	readonly endOffset: number;
}

export interface SparseEightGiBScapeFixture {
	readonly path: string;
	readonly logicalSize: number;
	readonly allocatedBytes: number;
	readonly projectId: string;
	readonly assetSha256: string;
	readonly assetCrc32: number;
	readonly entries: readonly SparseScapeEntryBoundary[];
	readonly hugePayload: Readonly<{
		startOffset: number;
		endOffset: number;
		size: number;
	}>;
	readonly centralOffset: number;
	readonly centralSize: number;
	readonly zip64EndOffset: number;
	readonly zip64LocatorOffset: number;
	readonly classicEndOffset: number;
}

export class SparseFixturePlatformError extends Error {
	constructor(message: string, cause?: unknown) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = 'SparseFixturePlatformError';
	}
}

export function isSparseFixturePlatformError(value: unknown): value is SparseFixturePlatformError {
	return value instanceof SparseFixturePlatformError;
}

export async function probeSparseFileSupport(directory: string): Promise<SparseFileProbe> {
	const path = join(directory, 'sparse-file-probe');
	try {
		const handle = await open(path, 'w+');
		try {
			await handle.truncate(PROBE_LOGICAL_BYTES);
			await writeExact(handle, Uint8Array.of(0x5a), 0);
			await writeExact(handle, Uint8Array.of(0xa5), PROBE_LOGICAL_BYTES - 1);
			const details = await handle.stat();
			const allocatedBytes = physicalAllocationBytes(details);
			if (details.size !== PROBE_LOGICAL_BYTES) {
				return { supported: false, reason: 'the filesystem did not retain the probe logical size' };
			}
			if (allocatedBytes === null) {
				return { supported: false, reason: 'physical block allocation is not observable on this platform' };
			}
			if (allocatedBytes >= PROBE_LOGICAL_BYTES / 16) {
				return { supported: false, reason: 'the filesystem allocated the probe instead of preserving a sparse hole' };
			}
			return { supported: true, reason: 'sparse extents are supported' };
		} finally {
			await handle.close().catch(() => undefined);
		}
	} catch (error) {
		return { supported: false, reason: errorMessage(error) };
	} finally {
		await rm(path, { force: true }).catch(() => undefined);
	}
}

export async function createSparseEightGiBScapeFixture(
	path: string,
): Promise<SparseEightGiBScapeFixture> {
	const project = createAudioEditorProjectV9({
		id: PROJECT_ID,
		title: 'Sparse 8 GiB range witness',
		now: '2026-01-01T00:00:00.000Z',
		sources: [{
			kind: 'video',
			id: VIDEO_SOURCE_ID,
			storageKey: VIDEO_SOURCE_ID,
			name: 'sparse-video.mp4',
			mimeType: 'video/mp4',
			frameCount: 1,
			sampleRate: 48_000,
			width: 1,
			height: 1,
			frameRate: 30,
			videoCodec: 'h264',
			audioCodec: null,
			hasAudio: false,
		}],
		clips: [],
		tracks: [],
	});
	const projectBytes = TEXT_ENCODER.encode(JSON.stringify(project));
	const projectSha256 = createHash('sha256').update(projectBytes).digest('hex');
	let hugePayloadBytes = LOGICAL_ARCHIVE_BYTES;
	let manifestBytes: Uint8Array = new Uint8Array();
	let plan: ArchivePlan | null = null;
	for (let attempt = 0; attempt < 4; attempt += 1) {
		manifestBytes = manifestDocument(
			project.schemaVersion,
			projectBytes.byteLength,
			projectSha256,
			hugePayloadBytes,
		);
		plan = planArchive(projectBytes, manifestBytes);
		const plannedHugeBytes = (plan.entries[1] as ArchiveEntryPlan).size;
		if (plannedHugeBytes === hugePayloadBytes) break;
		hugePayloadBytes = plannedHugeBytes;
		plan = null;
	}
	if (!plan) throw new Error('The sparse Scape manifest size did not reach a stable archive layout.');
	const hugeEntry = plan.entries[1] as ArchiveEntryPlan;
	const finalManifestEntry = plan.entries[2] as ArchiveEntryPlan;
	if (hugeEntry.size !== hugePayloadBytes || hugeEntry.size <= UINT32_SENTINEL) {
		throw new Error('The sparse Scape fixture did not produce the required Zip64 payload.');
	}

	const prefix = archivePrefix(plan.entries.slice(0, 2));
	const tail = archiveTail(plan);
	if (prefix.byteLength !== hugeEntry.dataOffset
		|| tail.byteLength !== LOGICAL_ARCHIVE_BYTES - finalManifestEntry.localOffset) {
		throw new Error('The sparse Scape fixture boundaries are inconsistent.');
	}

	let handle: FileHandle | null = null;
	let allocatedBytes: number | null = null;
	try {
		handle = await open(path, 'w+');
		await handle.truncate(LOGICAL_ARCHIVE_BYTES);
		await writeExact(handle, prefix, 0);
		await writeExact(handle, tail, finalManifestEntry.localOffset);
		const details = await handle.stat();
		allocatedBytes = physicalAllocationBytes(details);
		if (details.size !== LOGICAL_ARCHIVE_BYTES) {
			throw new SparseFixturePlatformError('the filesystem did not retain the 8 GiB logical size');
		}
		if (allocatedBytes === null) {
			throw new SparseFixturePlatformError('physical allocation is not observable for the 8 GiB fixture');
		}
		if (allocatedBytes >= MAXIMUM_FIXTURE_ALLOCATION_BYTES) {
			throw new SparseFixturePlatformError('the 8 GiB fixture was not stored as a bounded sparse file');
		}
		await handle.close();
		handle = null;
	} catch (error) {
		await handle?.close().catch(() => undefined);
		if (error instanceof SparseFixturePlatformError) throw error;
		throw new SparseFixturePlatformError(`could not create the sparse archive: ${errorMessage(error)}`, error);
	}

	return Object.freeze({
		path,
		logicalSize: LOGICAL_ARCHIVE_BYTES,
		allocatedBytes,
		projectId: PROJECT_ID,
		assetSha256: ZERO_ASSET_SHA256,
		assetCrc32: ZERO_ASSET_CRC32,
		entries: Object.freeze(plan.entries.map((entry) => Object.freeze({
			name: entry.name,
			localOffset: entry.localOffset,
			dataOffset: entry.dataOffset,
			endOffset: entry.endOffset,
		}))),
		hugePayload: Object.freeze({
			startOffset: hugeEntry.dataOffset,
			endOffset: hugeEntry.endOffset,
			size: hugeEntry.size,
		}),
		centralOffset: plan.centralOffset,
		centralSize: plan.centralSize,
		zip64EndOffset: plan.zip64EndOffset,
		zip64LocatorOffset: plan.zip64LocatorOffset,
		classicEndOffset: plan.classicEndOffset,
	});
}

function manifestDocument(
	schemaVersion: number,
	projectSize: number,
	projectSha256: string,
	hugePayloadBytes: number,
): Uint8Array {
	return TEXT_ENCODER.encode(JSON.stringify({
		format: 'scape-project',
		formatVersion: 1,
		createdAt: '2026-01-01T00:00:00.000Z',
		project: {
			entry: 'project.json',
			size: projectSize,
			sha256: projectSha256,
			mimeType: 'application/json',
			schemaVersion,
		},
		assets: [{
			sourceId: VIDEO_SOURCE_ID,
			kind: 'video',
			encoding: 'original',
			entry: VIDEO_ENTRY,
			size: hugePayloadBytes,
			sha256: ZERO_ASSET_SHA256,
			mimeType: 'video/mp4',
		}],
	}));
}

function planArchive(projectBytes: Uint8Array, manifestBytes: Uint8Array): ArchivePlan {
	const names = ['project.json', VIDEO_ENTRY, 'manifest.json'] as const;
	const centralSize = names.reduce((total, name, index) => (
		total + CENTRAL_FIXED_BYTES + encodedName(name).byteLength
			+ (index === 1 ? ZIP64_SIZE_EXTRA_BYTES : 0)
			+ (index === 2 ? ZIP64_OFFSET_EXTRA_BYTES : 0)
	), 0);
	const zip64EndOffset = LOGICAL_ARCHIVE_BYTES - ZIP64_TAIL_BYTES;
	const centralOffset = zip64EndOffset - centralSize;
	const project = smallEntry(names[0], projectBytes, 0);
	const hugeNameBytes = encodedName(names[1]);
	const hugeLocalOffset = project.endOffset;
	const hugeDataOffset = hugeLocalOffset + LOCAL_FIXED_BYTES + hugeNameBytes.byteLength + ZIP64_SIZE_EXTRA_BYTES;
	const manifestLocalOffset = centralOffset
		- LOCAL_FIXED_BYTES
		- encodedName(names[2]).byteLength
		- manifestBytes.byteLength;
	const hugeSize = manifestLocalOffset - hugeDataOffset;
	if (!Number.isSafeInteger(hugeSize) || hugeSize <= UINT32_SENTINEL) {
		throw new Error('The sparse Scape video size is outside the required Zip64 range.');
	}
	if (hugeSize !== ZERO_ASSET_BYTES) {
		throw new Error('The sparse Scape video size no longer matches its pinned integrity metadata.');
	}
	const huge: ArchiveEntryPlan = Object.freeze({
		name: names[1],
		bytes: null,
		size: hugeSize,
		crc32: ZERO_ASSET_CRC32,
		zip64Size: true,
		zip64Offset: false,
		localOffset: hugeLocalOffset,
		dataOffset: hugeDataOffset,
		endOffset: manifestLocalOffset,
	});
	const manifest = smallEntry(names[2], manifestBytes, manifestLocalOffset);
	if (manifest.endOffset !== centralOffset) {
		throw new Error('The sparse Scape manifest does not end at the central directory.');
	}
	return Object.freeze({
		entries: Object.freeze([project, huge, manifest]),
		centralOffset,
		centralSize,
		zip64EndOffset,
		zip64LocatorOffset: zip64EndOffset + ZIP64_END_BYTES,
		classicEndOffset: zip64EndOffset + ZIP64_END_BYTES + ZIP64_LOCATOR_BYTES,
	});
}

function smallEntry(name: string, bytes: Uint8Array, localOffset: number): ArchiveEntryPlan {
	const dataOffset = localOffset + LOCAL_FIXED_BYTES + encodedName(name).byteLength;
	return Object.freeze({
		name,
		bytes,
		size: bytes.byteLength,
		crc32: crc32(bytes),
		zip64Size: false,
		zip64Offset: localOffset > UINT32_SENTINEL,
		localOffset,
		dataOffset,
		endOffset: dataOffset + bytes.byteLength,
	});
}

function archivePrefix(entries: readonly ArchiveEntryPlan[]): Uint8Array {
	const chunks: Uint8Array[] = [];
	for (const entry of entries) {
		chunks.push(localHeader(entry));
		if (entry.bytes) chunks.push(entry.bytes);
	}
	return concatenate(chunks);
}

function archiveTail(plan: ArchivePlan): Uint8Array {
	const manifest = plan.entries[2] as ArchiveEntryPlan;
	if (!manifest.bytes) throw new Error('The sparse Scape final manifest is missing.');
	const central = concatenate(plan.entries.map(centralHeader));
	if (central.byteLength !== plan.centralSize) throw new Error('The sparse Scape central size is inconsistent.');
	return concatenate([
		localHeader(manifest),
		manifest.bytes,
		central,
		zip64EndRecord(plan),
		zip64Locator(plan.zip64EndOffset),
		classicEndRecord(plan.entries.length, plan.centralSize),
	]);
}

function localHeader(entry: ArchiveEntryPlan): Uint8Array {
	const name = encodedName(entry.name);
	const extra = entry.zip64Size ? zip64SizeExtra(entry.size) : new Uint8Array();
	const bytes = new Uint8Array(LOCAL_FIXED_BYTES + name.byteLength + extra.byteLength);
	const fields = view(bytes);
	fields.setUint32(0, 0x0403_4b50, true);
	fields.setUint16(4, entry.zip64Size ? 45 : 20, true);
	fields.setUint16(6, UTF8_FLAG, true);
	fields.setUint16(8, STORE_METHOD, true);
	fields.setUint16(12, DOS_DATE_1980_01_01, true);
	fields.setUint32(14, entry.crc32, true);
	fields.setUint32(18, entry.zip64Size ? UINT32_SENTINEL : entry.size, true);
	fields.setUint32(22, entry.zip64Size ? UINT32_SENTINEL : entry.size, true);
	fields.setUint16(26, name.byteLength, true);
	fields.setUint16(28, extra.byteLength, true);
	bytes.set(name, LOCAL_FIXED_BYTES);
	bytes.set(extra, LOCAL_FIXED_BYTES + name.byteLength);
	return bytes;
}

function centralHeader(entry: ArchiveEntryPlan): Uint8Array {
	const name = encodedName(entry.name);
	const extra = zip64CentralExtra(entry);
	const bytes = new Uint8Array(CENTRAL_FIXED_BYTES + name.byteLength + extra.byteLength);
	const fields = view(bytes);
	fields.setUint32(0, 0x0201_4b50, true);
	fields.setUint16(4, 45, true);
	fields.setUint16(6, entry.zip64Size || entry.zip64Offset ? 45 : 20, true);
	fields.setUint16(8, UTF8_FLAG, true);
	fields.setUint16(10, STORE_METHOD, true);
	fields.setUint16(14, DOS_DATE_1980_01_01, true);
	fields.setUint32(16, entry.crc32, true);
	fields.setUint32(20, entry.zip64Size ? UINT32_SENTINEL : entry.size, true);
	fields.setUint32(24, entry.zip64Size ? UINT32_SENTINEL : entry.size, true);
	fields.setUint16(28, name.byteLength, true);
	fields.setUint16(30, extra.byteLength, true);
	fields.setUint32(42, entry.zip64Offset ? UINT32_SENTINEL : entry.localOffset, true);
	bytes.set(name, CENTRAL_FIXED_BYTES);
	bytes.set(extra, CENTRAL_FIXED_BYTES + name.byteLength);
	return bytes;
}

function zip64CentralExtra(entry: ArchiveEntryPlan): Uint8Array {
	if (!entry.zip64Size && !entry.zip64Offset) return new Uint8Array();
	const payloadBytes = (entry.zip64Size ? 16 : 0) + (entry.zip64Offset ? 8 : 0);
	const bytes = new Uint8Array(4 + payloadBytes);
	const fields = view(bytes);
	fields.setUint16(0, 0x0001, true);
	fields.setUint16(2, payloadBytes, true);
	let offset = 4;
	if (entry.zip64Size) {
		fields.setBigUint64(offset, BigInt(entry.size), true);
		fields.setBigUint64(offset + 8, BigInt(entry.size), true);
		offset += 16;
	}
	if (entry.zip64Offset) fields.setBigUint64(offset, BigInt(entry.localOffset), true);
	return bytes;
}

function zip64SizeExtra(size: number): Uint8Array {
	const bytes = new Uint8Array(ZIP64_SIZE_EXTRA_BYTES);
	const fields = view(bytes);
	fields.setUint16(0, 0x0001, true);
	fields.setUint16(2, 16, true);
	fields.setBigUint64(4, BigInt(size), true);
	fields.setBigUint64(12, BigInt(size), true);
	return bytes;
}

function zip64EndRecord(plan: ArchivePlan): Uint8Array {
	const bytes = new Uint8Array(ZIP64_END_BYTES);
	const fields = view(bytes);
	fields.setUint32(0, 0x0606_4b50, true);
	fields.setBigUint64(4, 44n, true);
	fields.setUint16(12, 45, true);
	fields.setUint16(14, 45, true);
	fields.setBigUint64(24, BigInt(plan.entries.length), true);
	fields.setBigUint64(32, BigInt(plan.entries.length), true);
	fields.setBigUint64(40, BigInt(plan.centralSize), true);
	fields.setBigUint64(48, BigInt(plan.centralOffset), true);
	return bytes;
}

function zip64Locator(zip64EndOffset: number): Uint8Array {
	const bytes = new Uint8Array(ZIP64_LOCATOR_BYTES);
	const fields = view(bytes);
	fields.setUint32(0, 0x0706_4b50, true);
	fields.setBigUint64(8, BigInt(zip64EndOffset), true);
	fields.setUint32(16, 1, true);
	return bytes;
}

function classicEndRecord(entryCount: number, centralSize: number): Uint8Array {
	const bytes = new Uint8Array(CLASSIC_END_BYTES);
	const fields = view(bytes);
	fields.setUint32(0, 0x0605_4b50, true);
	fields.setUint16(8, entryCount, true);
	fields.setUint16(10, entryCount, true);
	fields.setUint32(12, centralSize, true);
	fields.setUint32(16, UINT32_SENTINEL, true);
	return bytes;
}

function encodedName(name: string): Uint8Array {
	return TEXT_ENCODER.encode(name);
}

function concatenate(chunks: readonly Uint8Array[]): Uint8Array {
	const length = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}

function crc32(bytes: Uint8Array): number {
	let crc = 0xffff_ffff;
	for (const byte of bytes) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
		}
	}
	return (crc ^ 0xffff_ffff) >>> 0;
}

async function writeExact(handle: FileHandle, bytes: Uint8Array, position: number): Promise<void> {
	let offset = 0;
	while (offset < bytes.byteLength) {
		const result = await handle.write(bytes, offset, bytes.byteLength - offset, position + offset);
		if (result.bytesWritten <= 0) throw new Error('The sparse fixture write made no progress.');
		offset += result.bytesWritten;
	}
}

function physicalAllocationBytes(details: Readonly<{ blocks?: number }>): number | null {
	if (!Number.isFinite(details.blocks) || !Number.isSafeInteger(details.blocks) || (details.blocks as number) < 0) {
		return null;
	}
	return (details.blocks as number) * 512;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function view(bytes: Uint8Array): DataView {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
