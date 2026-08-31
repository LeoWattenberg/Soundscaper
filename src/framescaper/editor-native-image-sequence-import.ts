/* SPDX-License-Identifier: AGPL-3.0-only */

/** Pathless candidate-only composition for File > Import > Image Sequence…. */

import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import {
	assertNativeMediaCapabilitySnapshotV1,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
} from '../common/editor/native-media-capability-snapshot.ts';
import {
	createNativeMediaImageSequenceInventoryV25,
	createNativeMediaImageSequenceSourceV25,
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES,
	type NativeMediaImageSequenceInventoryReferenceV25,
	type NativeMediaImageSequenceSourcePackReferenceV25,
	type NativeMediaImageSequenceSourcePackWriterV25,
} from '../common/editor/native-media-image-sequence-v25.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
	createNativeMediaImageSequenceSourcePackV25,
} from '../common/editor/native-media-image-sequence-pack-v25.ts';
import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES,
	resolveNativeMediaImageSequence,
	type NativeMediaImageSequenceRateV1,
} from '../common/editor/native-media-image-sequence.ts';
import { createVideoSource } from '../common/editor/project-media-factory.ts';
import {
	editorProjectFeatureCapabilityProfileDefinition,
} from '../common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../common/editor/project-runtime-profile.ts';
import { sampleFrameToVideoFrame, videoFrameToSampleFrame } from '../common/editor/timeline-time.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
	type VideoSourceCharacteristicsV25,
} from '../common/editor/video-source-professional-characteristics-v25.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
} from '../common/editor/project-schema-identity.ts';
import { assertFramescaperProjectIdentity } from './editor-project-identity.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import type { FramescaperProject } from './editor-project.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;
type CandidateProject = FramescaperProject;

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const REQUIRED_PROJECT_CAPABILITIES = Object.freeze([
	'projectBin', 'sourceCharacteristics', 'videoImport',
] as const);
const SELECTION_KEYS = Object.freeze([
	'sourceId', 'projectBinClipId', 'name', 'frameRate', 'files', 'release',
]);
const FILE_KEYS = Object.freeze(['name', 'byteLength', 'chunks']);
const ADMISSION_RESPONSE_KEYS = Object.freeze([
	'kind', 'admitted', 'schemaFamily', 'schemaVersion', 'projectId', 'projectRevision', 'sourceId',
	'inventorySha256', 'sourcePackSha256', 'characteristics',
]);

export interface FramescaperSelectedImageSequenceFile {
	readonly name: string;
	readonly byteLength: number;
	/** A fresh pathless byte stream; composition reads it once to hash and once to pack. */
	chunks(): Iterable<Uint8Array> | AsyncIterable<Uint8Array>;
}

export interface FramescaperImageSequenceSelection {
	readonly sourceId: string;
	readonly projectBinClipId: string;
	readonly name: string;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly files: readonly FramescaperSelectedImageSequenceFile[];
	readonly release: () => Awaitable<void>;
}

export interface FramescaperImageSequenceNativeAdmissionRequest {
	readonly kind: 'framescaper-image-sequence-admission-v1';
	readonly schemaFamily: typeof FRAMESCAPER_PROJECT_SCHEMA_FAMILY;
	readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
	readonly projectId: string;
	readonly projectRevision: number;
	readonly sourceId: string;
	readonly profileId: 'decode-png-sequence' | 'decode-tiff-sequence' | 'decode-openexr-sequence';
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly frameCount: number;
	readonly inventory: NativeMediaImageSequenceInventoryReferenceV25;
	readonly sourcePack: NativeMediaImageSequenceSourcePackReferenceV25;
}

export interface FramescaperImageSequenceImportPorts {
	capabilities(): Awaitable<unknown>;
	createSourcePackWriter(): Awaitable<NativeMediaImageSequenceSourcePackWriterV25>;
	publishInventory(
		bytes: Uint8Array,
		reference: NativeMediaImageSequenceInventoryReferenceV25,
	): Awaitable<void>;
	cleanupInventory(reference: NativeMediaImageSequenceInventoryReferenceV25): Awaitable<void>;
	admit(request: FramescaperImageSequenceNativeAdmissionRequest): Awaitable<unknown>;
	/** Best-effort durable transaction settlement after the project CAS succeeds. */
	complete?(request: FramescaperImageSequenceNativeAdmissionRequest): Awaitable<void>;
}

export interface ComposeFramescaperImageSequenceImportOptions {
	readonly profile: unknown;
	readonly project: CandidateProject;
	readonly select: () => Awaitable<FramescaperImageSequenceSelection | null>;
	readonly ports: FramescaperImageSequenceImportPorts;
	readonly commit: (
		source: Readonly<Record<string, unknown>>,
		projectBinClip: Readonly<Record<string, unknown>>,
	) => Awaitable<void>;
}

/**
 * Resolve, authenticate, externalize, admit, then atomically author one source
 * and Project Bin clip. No selected path exists in this contract.
 */
export async function composeFramescaperImageSequenceImport(
	options: ComposeFramescaperImageSequenceImportOptions,
): Promise<void> {
	assertFramescaperProjectRuntimeProfile(options.profile);
	assertFramescaperProjectIdentity(options.project);
	assertProjectCapabilities(options.profile);
	assertPorts(options);
	await assertRuntimeCapability(options.ports);
	const selectedValue = await options.select();
	if (selectedValue === null) return;
	const selected = selection(selectedValue);
	await settleImageSequenceSelection((async () => {
	const resolved = resolveNativeMediaImageSequence({
		fileNames: selected.files.map(({ name }) => name),
		frameRate: selected.frameRate,
	});
	const byName = new Map(selected.files.map((file) => [file.name, file]));
	const orderedFiles = resolved.frames.map(({ fileName }) => byName.get(fileName)!);
	const entries = [];
	for (let index = 0; index < resolved.frames.length; index += 1) {
		const frame = resolved.frames[index]!;
		const file = orderedFiles[index]!;
		entries.push(Object.freeze({
			fileName: frame.fileName,
			frameNumber: frame.frameNumber,
			byteLength: file.byteLength,
			sha256: await digestFile(file),
		}));
	}
	const inventory = createNativeMediaImageSequenceInventoryV25(resolved, entries);
	const writer = await options.ports.createSourcePackWriter();
	assertWriter(writer);
	let inventoryPublished = false;
	try {
		const sourcePack = await createNativeMediaImageSequenceSourcePackV25({
			inventory: inventory.reference,
			entries,
			frameRate: resolved.frameRate,
			frameChunks: (index) => orderedFiles[index]!.chunks(),
			write: (chunk) => writer.write(chunk),
		});
		await writer.commit(sourcePack);
		await options.ports.publishInventory(inventory.bytes.slice(), inventory.reference);
		inventoryPublished = true;
		await assertRuntimeCapability(options.ports);
		const request = admissionRequest({
			project: options.project,
			sourceId: selected.sourceId,
			extension: resolved.extension,
			frameRate: resolved.frameRate,
			frameCount: resolved.frameCount,
			inventory: inventory.reference,
			sourcePack,
		});
		const characteristics = admissionCharacteristics(await options.ports.admit(request), request);
		const descriptor = createNativeMediaImageSequenceSourceV25({
			id: selected.sourceId,
			name: selected.name,
			selection: resolved,
			inventory: inventory.reference,
			sourcePack,
			characteristics,
		});
		await options.commit(
			projectSource(options.project, descriptor),
			framescaperImageSequenceProjectBinClip(options.project, selected.projectBinClipId, descriptor),
		);
		try { await options.ports.complete?.(request); }
		catch { /* The main-owned recovery manifest settles an acknowledged project commit. */ }
	}
	catch (error) {
		const failures: unknown[] = [error];
		if (inventoryPublished) {
			try { await options.ports.cleanupInventory(inventory.reference); }
			catch (cleanupError) { failures.push(cleanupError); }
		}
		try { await writer.discard(); }
		catch (cleanupError) { failures.push(cleanupError); }
		if (failures.length > 1) throw new AggregateError(
			failures, 'Image-sequence import and rollback failed.', { cause: error });
		throw error;
	}
	})(), selected.release);
}

async function settleImageSequenceSelection(
	operation: Promise<void>,
	release: () => Awaitable<void>,
): Promise<void> {
	try { await operation; }
	catch (error) {
		try { await release(); }
		catch (releaseError) {
			throw new AggregateError(
				[error, releaseError], 'Image-sequence import selection release failed.',
				{ cause: releaseError },
			);
		}
		throw error;
	}
	await release();
}

function assertProjectCapabilities(profile: unknown): void {
	const runtime = editorProjectRuntimeProfileDefinition(profile);
	const capability = editorProjectFeatureCapabilityProfileDefinition(runtime.capabilityProfile);
	for (const key of REQUIRED_PROJECT_CAPABILITIES) {
		if (!capability.registrations.some((row) => row.key === key && row.available)) {
			throw new Error(`Dormant image-sequence import requires project capability ${key}.`);
		}
	}
}

async function assertRuntimeCapability(ports: FramescaperImageSequenceImportPorts): Promise<void> {
	const snapshot = await ports.capabilities();
	assertNativeMediaCapabilitySnapshotV1(snapshot);
	const ref = NATIVE_MEDIA_CAPABILITY_IDS.imageSequenceImport;
	if (!isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, ref.domain, ref.id))) {
		throw new Error('The native image-sequence import capability is unavailable.');
	}
}

function selection(value: unknown): FramescaperImageSequenceSelection {
	const record = exactRecord(value, SELECTION_KEYS, 'image-sequence selection');
	if (!Array.isArray(record.files) || record.files.length === 0
		|| record.files.length > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAMES
		|| Reflect.ownKeys(record.files).length !== record.files.length + 1) {
		throw new TypeError('A selected image sequence requires a bounded dense file list.');
	}
	if (typeof record.release !== 'function') {
		throw new TypeError('A selected image sequence requires an explicit release capability.');
	}
	return Object.freeze({
		sourceId: stableId(record.sourceId, 'source ID'),
		projectBinClipId: stableId(record.projectBinClipId, 'Project Bin clip ID'),
		name: stableId(record.name, 'source name'),
		frameRate: record.frameRate as NativeMediaImageSequenceRateV1,
		files: Object.freeze(record.files.map(selectedFile)),
		release: record.release as () => Awaitable<void>,
	});
}

function selectedFile(value: unknown): FramescaperSelectedImageSequenceFile {
	const record = exactRecord(value, FILE_KEYS, 'selected image-sequence file');
	if (typeof record.name !== 'string' || record.name.length === 0
		|| record.name.length > 512 || record.name.includes('/') || record.name.includes('\\')
		|| record.name.includes('\0')) {
		throw new TypeError('A selected image-sequence file must expose one pathless bounded name.');
	}
	if (!Number.isSafeInteger(record.byteLength) || Number(record.byteLength) < 1
		|| Number(record.byteLength) > NATIVE_MEDIA_IMAGE_SEQUENCE_MAXIMUM_FRAME_BYTES
		|| typeof record.chunks !== 'function') {
		throw new TypeError('A selected image-sequence file requires a bounded length and byte-stream factory.');
	}
	return Object.freeze({
		name: record.name,
		byteLength: Number(record.byteLength),
		chunks: record.chunks as FramescaperSelectedImageSequenceFile['chunks'],
	});
}

async function digestFile(file: FramescaperSelectedImageSequenceFile): Promise<string> {
	const digest = sha256.create();
	let total = 0;
	const chunks = file.chunks();
	if (!chunks || !(Symbol.iterator in Object(chunks) || Symbol.asyncIterator in Object(chunks))) {
		throw new TypeError('A selected image-sequence file stream is not iterable.');
	}
	for await (const chunk of chunks) {
		if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0
			|| chunk.byteLength > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
			throw new TypeError('A selected image-sequence file chunk is empty, oversized, or not bytes.');
		}
		total += chunk.byteLength;
		if (!Number.isSafeInteger(total) || total > file.byteLength) {
			throw new RangeError('A selected image-sequence file exceeds its declared length.');
		}
		digest.update(chunk);
	}
	if (total !== file.byteLength) throw new RangeError('A selected image-sequence file has a short byte stream.');
	return bytesToHex(digest.digest());
}

function admissionRequest(input: Readonly<{
	project: CandidateProject;
	sourceId: string;
	extension: string;
	frameRate: NativeMediaImageSequenceRateV1;
	frameCount: number;
	inventory: NativeMediaImageSequenceInventoryReferenceV25;
	sourcePack: NativeMediaImageSequenceSourcePackReferenceV25;
}>): FramescaperImageSequenceNativeAdmissionRequest {
	return Object.freeze({
		kind: 'framescaper-image-sequence-admission-v1',
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		projectId: stableId(input.project.id, 'project id'),
		projectRevision: nonNegativeInteger(input.project.revision, 'project revision'),
		sourceId: input.sourceId,
		profileId: decodeProfile(input.extension),
		frameRate: Object.freeze({ ...input.frameRate }),
		frameCount: input.frameCount,
		inventory: input.inventory,
		sourcePack: input.sourcePack,
	});
}

function admissionCharacteristics(
	value: unknown,
	request: FramescaperImageSequenceNativeAdmissionRequest,
): VideoSourceCharacteristicsV25 {
	const result = exactRecord(value, ADMISSION_RESPONSE_KEYS, 'image-sequence admission result');
	if (result.kind !== request.kind || result.admitted !== true
		|| result.schemaFamily !== request.schemaFamily
		|| result.schemaVersion !== request.schemaVersion
		|| result.projectId !== request.projectId || result.projectRevision !== request.projectRevision
		|| result.sourceId !== request.sourceId
		|| result.inventorySha256 !== request.inventory.sha256
		|| result.sourcePackSha256 !== request.sourcePack.sha256) {
		throw new Error('The native image-sequence admission result has the wrong project or asset identity.');
	}
	const characteristics = normalizeVideoSourceCharacteristicsV25(result.characteristics, {
		rate: request.frameRate,
	});
	if (!Number.isSafeInteger(characteristics.codedWidth) || Number(characteristics.codedWidth) < 1
		|| !Number.isSafeInteger(characteristics.codedHeight) || Number(characteristics.codedHeight) < 1) {
		throw new Error('Native image-sequence admission must report exact coded dimensions.');
	}
	return characteristics;
}

function projectSource(
	project: CandidateProject,
	descriptor: ReturnType<typeof createNativeMediaImageSequenceSourceV25>,
): Readonly<Record<string, unknown>> {
	const sampleFrameCount = videoFrameToSampleFrame(
		descriptor.frameCount, descriptor.frameRate, Number(project.sampleRate), 'enclosingEnd',
	);
	return Object.freeze({
		...createVideoSource({
			id: descriptor.id,
			name: descriptor.name,
			storageKey: descriptor.sourcePack.storageKey,
			mimeType: mimeType(descriptor.extension),
			contentSha256: descriptor.sourcePack.sha256,
			sampleFrameCount,
			sourceFrameCount: descriptor.frameCount,
			frameRate: descriptor.frameRate,
			width: descriptor.characteristics.codedWidth,
			height: descriptor.characteristics.codedHeight,
			videoCodec: descriptor.extension,
			hasAudio: false,
		}, Number(project.sampleRate)),
		characteristics: descriptor.characteristics,
		imageSequence: descriptor,
		proxyAttachment: null,
	});
}

export function framescaperImageSequenceProjectBinClip(
	project: CandidateProject,
	clipId: string,
	descriptor: ReturnType<typeof createNativeMediaImageSequenceSourceV25>,
): Readonly<Record<string, unknown>> {
	const sequences = project.sequences as readonly Readonly<Record<string, unknown>>[];
	const sequence = sequences.find(({ id }) => id === project.primarySequenceId);
	if (!sequence) throw new Error('Image-sequence import requires its primary sequence timing authority.');
	const sampleRate = Number(project.sampleRate);
	const sampleFrameCount = videoFrameToSampleFrame(
		descriptor.frameCount, descriptor.frameRate, sampleRate, 'enclosingEnd',
	);
	const sequenceFrameCount = Math.max(1, sampleFrameToVideoFrame(
		sampleFrameCount, sequence.rate as NativeMediaImageSequenceRateV1, sampleRate, 'point',
	));
	return Object.freeze({
		kind: 'video', id: clipId, binItemId: clipId, sourceId: descriptor.id,
		title: descriptor.name, sequenceId: project.primarySequenceId,
		sequenceStartFrame: 0, sequenceFrameCount,
		sourceInFrame: 0, sourceFrameCount: descriptor.frameCount, retimeMap: null,
	});
}

function assertPorts(options: ComposeFramescaperImageSequenceImportOptions): void {
	if (typeof options.select !== 'function' || typeof options.commit !== 'function') {
		throw new TypeError('Candidate image-sequence composition requires selection and commit ports.');
	}
	for (const method of [
		'capabilities', 'createSourcePackWriter',
		'publishInventory', 'cleanupInventory', 'admit',
	] as const) {
		if (typeof options.ports?.[method] !== 'function') {
			throw new TypeError(`Candidate image-sequence composition requires port ${method}.`);
		}
	}
	if (options.ports.complete !== undefined && typeof options.ports.complete !== 'function') {
		throw new TypeError('Candidate image-sequence composition requires a valid optional completion port.');
	}
}

function assertWriter(value: unknown): asserts value is NativeMediaImageSequenceSourcePackWriterV25 {
	for (const method of ['write', 'commit', 'discard'] as const) {
		if (!value || typeof value !== 'object'
			|| typeof (value as NativeMediaImageSequenceSourcePackWriterV25)[method] !== 'function') {
			throw new TypeError(`Candidate image-sequence source-pack writer requires ${method}.`);
		}
	}
}

function decodeProfile(extension: string): FramescaperImageSequenceNativeAdmissionRequest['profileId'] {
	if (extension === 'png') return 'decode-png-sequence';
	if (extension === 'tif' || extension === 'tiff') return 'decode-tiff-sequence';
	if (extension === 'exr') return 'decode-openexr-sequence';
	throw new RangeError('The candidate image-sequence decode profile is unsupported.');
}

function mimeType(extension: string): string {
	if (extension === 'png') return 'image/png';
	if (extension === 'tif' || extension === 'tiff') return 'image/tiff';
	if (extension === 'exr') return 'image/x-exr';
	throw new RangeError('The candidate image-sequence MIME type is unsupported.');
}

function exactRecord(value: unknown, keys: readonly string[], name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`A candidate ${name} must be a plain record.`);
	}
	const actual = Reflect.ownKeys(value);
	if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
		throw new TypeError(`A candidate ${name} must be an exact pathless record.`);
	}
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`A candidate ${name}.${key} must be an own data field.`);
		}
	}
	return value as Record<string, unknown>;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Candidate ${label} is invalid.`);
	return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new TypeError(`Candidate ${label} must be a non-negative safe integer.`);
	}
	return Number(value);
}
