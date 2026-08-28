/* SPDX-License-Identifier: AGPL-3.0-only */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { aggregateScapeErrors, throwIfScapeAborted } from '../common/editor/scape-abort.ts';
import type { ScapeAssetDescriptor } from '../common/editor/scape-archive-envelope.ts';
import { verifyScapeExtractedAsset } from '../common/editor/scape-archive-media.ts';
import {
	extractScapeVideo,
	SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
	type ScapeVideoWriter,
} from '../common/editor/scape-archive-video.ts';
import type { ScapeProjectAssetExtensionImportRequest } from '../common/editor/scape-project-asset-extension.ts';
import { canonicalMediaContentBlob, digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import type {
	OwnedMediaAssetPublication,
	OwnedMediaAssetWriter,
} from '../common/editor/storage/media-asset-write-contract.ts';
import {
	requireVideoMotionAnalysisBodyV1,
	videoMotionSettingsSha256V1,
} from '../common/editor/video-motion-analysis-v27.ts';
import { validateVideoTimingAssetBytes } from '../common/editor/video-timing-asset.ts';
import {
	validateFramescaperScapeAssetReferenceBytesFinishing,
	type FramescaperScapeAssetReferenceFinishing,
	type FramescaperScapeImportValidationFinishing,
} from './editor-scape-asset-plan-finishing.ts';

interface StageMaterial {
	readonly storageKey: string;
	readonly size: number;
	readonly sha256: string;
	readonly mimeType: string;
	readonly kind: string;
	readonly encoding: string;
	readonly bytes: Uint8Array | null;
	readonly validateBytes: ((bytes: Uint8Array) => void) | null;
}

const UTF8 = new TextEncoder();

export async function stageFramescaperScapeImportAssetsFinishing(
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const validation = importValidation(request.validation);
	for (const reference of validation.references) {
		throwIfScapeAborted(request.signal);
		const descriptor = validation.descriptorByArchiveId.get(reference.archiveId)!;
		const entry = request.entryByName.get(descriptor.entry);
		if (!entry) throw new Error(`The finishing Scape archive is missing ${descriptor.entry}.`);
		if (buffered(reference)) {
			const archiveBytes = await readArchiveBytes(entry, descriptor, request);
			validateArchiveBytes(reference, archiveBytes);
			const material = reference.role === 'motion'
				? motionMaterial(reference, archiveBytes, request.project)
				: directMaterial(reference, descriptor, request, archiveBytes);
			await stageBufferedBody(material, request);
		} else {
			await stageStreamingBody(
				directMaterial(reference, descriptor, request, null), entry, descriptor, request,
			);
		}
	}
}

function directMaterial(
	reference: FramescaperScapeAssetReferenceFinishing,
	descriptor: ScapeAssetDescriptor,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
	bytes: Uint8Array | null,
): StageMaterial {
	const storageKey = reference.sourceId === null ? reference.storageKey
		: reboundStillStorageKey(reference, request.project, request.sourceIdMap);
	return Object.freeze({
		storageKey,
		size: descriptor.size,
		sha256: descriptor.sha256,
		mimeType: reference.mimeType,
		kind: storageKind(reference),
		encoding: reference.encoding,
		bytes,
		validateBytes: buffered(reference)
			? (value: Uint8Array) => validateArchiveBytes(reference, value) : null,
	});
}

function motionMaterial(
	reference: FramescaperScapeAssetReferenceFinishing,
	archiveBytes: Uint8Array,
	project: Record<string, unknown>,
): StageMaterial {
	const original = requireVideoMotionAnalysisBodyV1(reference.motionReference, archiveBytes, {
		inputSha256: reference.motionReference!.inputSha256,
		processorStack: reference.processorStack,
	});
	const analyses = records(project.videoMotionAnalyses, 'rebound finishing motion analyses');
	const stacks = records(project.videoProcessorStacks, 'rebound finishing processor stacks');
	const target = analyses.find(({ id }) => id === reference.motionReference!.id);
	const stack = stacks.find(({ id }) => id === reference.motionReference!.processorStackId);
	if (!target || !stack || target.sourceId !== stack.sourceId) {
		throw new Error('The finishing motion analysis could not follow its rebound source identity.');
	}
	const settingsSha256 = videoMotionSettingsSha256V1(stack);
	const changed = target.sourceId !== original.sourceId || settingsSha256 !== original.settingsSha256;
	const bytes = changed ? UTF8.encode(JSON.stringify({
		...original, sourceId: target.sourceId, settingsSha256,
	})) : archiveBytes;
	const digest = bytesToHex(sha256(bytes));
	Object.assign(target, {
		settingsSha256,
		storageKey: `motion-sha256:${digest}`,
		sha256: digest,
		byteLength: bytes.byteLength,
	});
	const validateBytes = (value: Uint8Array) => {
		requireVideoMotionAnalysisBodyV1(target, value, {
			inputSha256: target.inputSha256 as string,
			processorStack: stack,
		});
	};
	validateBytes(bytes);
	return Object.freeze({
		storageKey: String(target.storageKey),
		size: bytes.byteLength,
		sha256: digest,
		mimeType: reference.mimeType,
		kind: storageKind(reference),
		encoding: reference.encoding,
		bytes,
		validateBytes,
	});
}

async function stageBufferedBody(
	material: StageMaterial,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const bytes = material.bytes!;
	const existing = await request.store.getMediaAssetMetadata(material.storageKey);
	if (existing !== null && existing !== undefined) {
		await verifyStoredBody(existing, material, request);
		return;
	}
	const writer = await beginWriter(material, request);
	let publication: OwnedMediaAssetPublication | null = null;
	let tracked = false;
	try {
		for (let offset = 0; offset < bytes.byteLength; offset += writer.maximumChunkBytes) {
			throwIfScapeAborted(request.signal);
			await writer.write(bytes.subarray(offset, offset + writer.maximumChunkBytes), signalOptions(request.signal));
		}
		publication = await writer.commitOwned(signalOptions(request.signal));
		request.transaction.trackProvisionalMedia(publication);
		tracked = true;
		throwIfScapeAborted(request.signal);
		assertStoredMetadata(publication.metadata, material);
	} catch (error) {
		if (tracked) throw error;
		return cleanupWriter(error, writer, publication);
	}
}

async function stageStreamingBody(
	material: StageMaterial,
	entry: Parameters<typeof extractScapeVideo>[0],
	descriptor: ScapeAssetDescriptor,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	const existing = await request.store.getMediaAssetMetadata(material.storageKey);
	if (existing !== null && existing !== undefined) {
		const extracted = await extractScapeVideo(
			entry, discardWriter(), request.signal, request.expandedByteBudget,
		);
		verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, material.storageKey);
		await verifyStoredBody(existing, material, request);
		return;
	}
	const writer = await beginWriter(material, request);
	let publication: OwnedMediaAssetPublication | null = null;
	let tracked = false;
	try {
		const extracted = await extractScapeVideo(
			entry, writer, request.signal, request.expandedByteBudget,
		);
		verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, material.storageKey);
		publication = await writer.commitOwned(signalOptions(request.signal));
		request.transaction.trackProvisionalMedia(publication);
		tracked = true;
		throwIfScapeAborted(request.signal);
		assertStoredMetadata(publication.metadata, material);
	} catch (error) {
		if (tracked) throw error;
		return cleanupWriter(error, writer, publication);
	}
}

async function readArchiveBytes(
	entry: Parameters<typeof extractScapeVideo>[0],
	descriptor: ScapeAssetDescriptor,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<Uint8Array> {
	const chunks: Uint8Array[] = [];
	let bytesWritten = 0;
	const writer: ScapeVideoWriter = {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		get bytesWritten() { return bytesWritten; },
		async write(value) { chunks.push(value.slice()); bytesWritten += value.byteLength; },
		async commit() { return {}; },
		async abort() {},
	};
	const extracted = await extractScapeVideo(
		entry, writer, request.signal, request.expandedByteBudget,
	);
	verifyScapeExtractedAsset(descriptor, extracted.digest, extracted.size, descriptor.sourceId);
	const result = new Uint8Array(descriptor.size);
	let offset = 0;
	for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
	if (offset !== descriptor.size) throw new Error('A finishing Scape asset ended before its admitted size.');
	return result;
}

async function beginWriter(
	material: StageMaterial,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<OwnedMediaAssetWriter> {
	const writer = await request.store.beginMediaAssetWrite(material.storageKey, {
		name: `${material.kind}:${material.sha256}`,
		kind: material.kind,
		encoding: material.encoding,
		mimeType: material.mimeType,
	}, {
		expectedBytes: material.size,
		expectedSha256: material.sha256,
		...(request.signal ? { signal: request.signal } : {}),
	});
	if (!writer || typeof writer.commitOwned !== 'function'
		|| writer.maximumChunkBytes !== SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES) {
		throw new TypeError('The finishing Scape import requires an exact bounded owned media writer.');
	}
	return writer as OwnedMediaAssetWriter;
}

async function verifyStoredBody(
	metadata: unknown,
	material: StageMaterial,
	request: Readonly<ScapeProjectAssetExtensionImportRequest>,
): Promise<void> {
	assertStoredMetadata(metadata, material);
	if (typeof request.store.loadMediaAsset !== 'function') {
		throw new TypeError('The finishing Scape import requires immutable media-body reads.');
	}
	const body = canonicalMediaContentBlob(await request.store.loadMediaAsset(
		material.storageKey, signalOptions(request.signal),
	));
	if (body.size !== material.size || await digestMediaContent(body, {
		signal: request.signal,
	}) !== material.sha256) {
		throw new Error(`Stored finishing archive body ${material.storageKey} conflicts with immutable content.`);
	}
	if (material.validateBytes) {
		material.validateBytes(new Uint8Array(await body.arrayBuffer()));
	}
}

function assertStoredMetadata(value: unknown, material: StageMaterial): void {
	const metadata = record(value, `stored finishing ${material.kind} metadata`);
	if (metadata.sourceId !== material.storageKey || metadata.size !== material.size
		|| metadata.sha256 !== material.sha256
		|| (metadata.mimeType !== undefined && metadata.mimeType !== ''
			&& metadata.mimeType !== material.mimeType)
		|| (metadata.kind !== undefined && metadata.kind !== material.kind)
		|| (metadata.encoding !== undefined && metadata.encoding !== material.encoding)) {
		throw new Error(`Stored finishing archive body ${material.storageKey} has conflicting role, size, or digest.`);
	}
}

function validateArchiveBytes(reference: FramescaperScapeAssetReferenceFinishing, bytes: Uint8Array): void {
	if (reference.timingReference) validateVideoTimingAssetBytes(reference.timingReference, bytes);
	validateFramescaperScapeAssetReferenceBytesFinishing(reference, bytes);
}

function reboundStillStorageKey(
	reference: FramescaperScapeAssetReferenceFinishing,
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): string {
	const targetId = sourceIdMap.get(reference.sourceId!) ?? reference.sourceId!;
	const source = records(project.sources, 'rebound finishing sources').find(({ id }) => id === targetId);
	if (!source || source.kind !== 'still') {
		throw new Error(`The finishing ${reference.role} body lost its rebound still source.`);
	}
	return stableId(source.storageKey, `rebound finishing ${reference.role} storage key`);
}

function importValidation(value: unknown): FramescaperScapeImportValidationFinishing {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('The exact finishing Scape import validation is required.');
	}
	const candidate = value as Partial<FramescaperScapeImportValidationFinishing>;
	if (!Array.isArray(candidate.references) || !(candidate.descriptorByArchiveId instanceof Map)) {
		throw new TypeError('The finishing Scape import validation is incomplete.');
	}
	return candidate as FramescaperScapeImportValidationFinishing;
}

function buffered(reference: FramescaperScapeAssetReferenceFinishing): boolean {
	return reference.role === 'proxy-timing' || reference.role === 'lut' || reference.role === 'motion';
}

function storageKind(reference: FramescaperScapeAssetReferenceFinishing): string {
	if (reference.role === 'proxy') return 'video-proxy';
	if (reference.role === 'proxy-timing') return 'video-timing';
	if (reference.role === 'lut') return 'cube-lut';
	if (reference.role === 'motion') return 'motion-analysis';
	return reference.role === 'freeze-render' ? 'freeze-render' : 'still';
}

function discardWriter(): ScapeVideoWriter {
	let bytesWritten = 0;
	return {
		maximumChunkBytes: SCAPE_VIDEO_MAXIMUM_CHUNK_BYTES,
		get bytesWritten() { return bytesWritten; },
		async write(value) { bytesWritten += value.byteLength; },
		async commit() { return {}; },
		async abort() {},
	};
}

async function cleanupWriter(
	primary: unknown,
	writer: OwnedMediaAssetWriter,
	publication: OwnedMediaAssetPublication | null,
): Promise<never> {
	try {
		if (publication) await publication.discardIfCurrent();
		else await writer.abort();
	} catch (cleanupError) {
		throw aggregateScapeErrors(primary, [cleanupError], 'The finishing Scape body write and cleanup both failed.');
	}
	throw primary;
}

function signalOptions(signal?: AbortSignal): Readonly<{ signal?: AbortSignal }> {
	return signal ? { signal } : {};
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item) => record(item, name));
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} is invalid.`);
	return value as Record<string, unknown>;
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}
