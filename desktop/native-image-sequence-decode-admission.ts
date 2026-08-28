/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact project and decoded-pack admission for main-owned image-sequence claims. */

import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';

import {
	normalizeNativeMediaImageSequenceSourceV25,
	type NativeMediaImageSequenceSourceV25,
} from '../src/common/editor/native-media-image-sequence-v25.ts';
import {
	assertNativeImageSequenceRgba8DecodeCompatibility,
} from '../src/common/editor/native-media-image-sequence-rgba8-admission.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import { framescaperNativeImageSequenceAssetPath } from './native-image-sequence-import-contract.ts';
import { assertImageSequenceReferenceFile } from './native-image-sequence-import-storage.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
} from '../src/common/editor/project-schema-identity.ts';

const MAGIC = new TextEncoder().encode('framescaper-rgba-frame-pack-v1\n');
export const IMAGE_SEQUENCE_DECODE_HEADER_BYTES = 59;
export const IMAGE_SEQUENCE_DECODE_FRAME_HEADER_BYTES = 32;
const MAXIMUM_DIGEST_CHUNK_BYTES = 16 * 1024 * 1024;

export interface AdmittedNativeImageSequence {
	readonly source: NativeMediaImageSequenceSourceV25;
	readonly packPath: string;
	readonly inventoryPath: string;
}

export async function admitFramescaperNativeImageSequenceSource(options: Readonly<{
	schemaFamily: 'framescaper';
	schemaVersion: 1;
	root: string;
	projectId: string;
	projectRevision: number;
	sourceId: string;
	projectBundle: unknown;
}>): Promise<Readonly<AdmittedNativeImageSequence>> {
	assertFramescaperIdentity(options, 'image-sequence decode request');
	const bundle = exactProjectBundle(options.projectBundle, options.projectId, options.projectRevision);
	const source = exactProjectSequenceSource(bundle.document, options.sourceId);
	assertNativeImageSequenceRgba8DecodeCompatibility(source.characteristics);
	const packBody = exactBody(bundle.bodies, source.sourcePack.storageKey, 'image-sequence-source-pack');
	const inventoryBody = exactBody(bundle.bodies, source.inventory.storageKey, 'image-sequence-inventory');
	if (packBody.byteLength !== source.sourcePack.byteLength || packBody.sha256 !== source.sourcePack.sha256
		|| inventoryBody.byteLength !== source.inventory.byteLength || inventoryBody.sha256 !== source.inventory.sha256) {
		throw new Error('The image-sequence project bodies disagree with source authority.');
	}
	const packPath = framescaperNativeImageSequenceAssetPath(options.root, source.sourcePack);
	const inventoryPath = framescaperNativeImageSequenceAssetPath(options.root, source.inventory);
	await Promise.all([
		assertImageSequenceReferenceFile(packPath, source.sourcePack),
		assertImageSequenceReferenceFile(inventoryPath, source.inventory),
	]);
	return Object.freeze({ source, packPath, inventoryPath });
}

export function createFramescaperNativeImageSequenceDecodePlan(
	projectId: string,
	revision: number,
	source: NativeMediaImageSequenceSourceV25,
) {
	const width = source.characteristics.codedWidth;
	const height = source.characteristics.codedHeight;
	if (!Number.isSafeInteger(width) || Number(width) < 1 || !Number.isSafeInteger(height) || Number(height) < 1) {
		throw new RangeError('An admitted image sequence has no exact coded geometry.');
	}
	const planningRate = framescaperNativeImageSequenceDecodeCompatibilityPlanningRate(
		source.frameRate,
	);
	const sampleDuration = safeProduct(source.frameCount, planningRate.den);
	return createUnifiedExactRenderPlan({
		version: 11, strategy: 'framescaper-unified-exact-v1',
		project: { id: projectId, revision },
		format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		timebase: {
			sampleStart: 0, sampleDuration, sampleRate: planningRate.num,
			sequenceId: 'image-sequence-decode', sequenceRate: source.frameRate,
		},
		output: {
			frameRate: planningRate, frameCount: source.frameCount, quality: 'balanced',
			canvas: { width, height, fit: 'contain', pixelFormat: 'yuv420p', backgroundColor: '#000000' },
			includeAudio: false, audioLayout: null,
		},
		tracks: [],
		sources: [{
			inputIndex: 0, nodeId: 'image-sequence-source', sourceId: source.id,
			storageKey: source.sourcePack.storageKey,
			mimeType: 'application/vnd.soundscaper.image-sequence-pack',
			contentSha256: source.sourcePack.sha256,
			timing: { kind: 'cfr', frameCount: source.frameCount, rate: source.frameRate },
		}],
		nodes: [{
			kind: 'professional-media', nodeId: 'image-sequence-professional',
			sourceNodeId: 'image-sequence-source', characteristics: source.characteristics,
			imageSequence: source, proxyAttachment: null, exportAuthority: 'original',
		}],
	});
}

/**
 * Compatibility metadata for the legacy V11 envelope parser only.
 *
 * Image-sequence frame selection and time are authenticated independently by
 * the source timing, professional image-sequence node, helper grant, decoded
 * pack header, and renderer descriptor. This rate must never leave the plan's
 * legacy output/sample fields or become decoded-source authority.
 */
function framescaperNativeImageSequenceDecodeCompatibilityPlanningRate(
	rate: Readonly<{ readonly num: number; readonly den: number }>,
): Readonly<{ readonly num: number; readonly den: number }> {
	if (BigInt(rate.num) < BigInt(rate.den)) return Object.freeze({ num: 1, den: 1 });
	if (BigInt(rate.num) > 30n * BigInt(rate.den)) return Object.freeze({ num: 30, den: 1 });
	return Object.freeze({ num: rate.num, den: rate.den });
}

export function exactFramescaperDecodedImageSequenceByteLength(source: NativeMediaImageSequenceSourceV25): number {
	const frameBytes = safeProduct(source.characteristics.codedWidth!, source.characteristics.codedHeight!, 4);
	return safeAdd(IMAGE_SEQUENCE_DECODE_HEADER_BYTES,
		safeProduct(source.frameCount, safeAdd(IMAGE_SEQUENCE_DECODE_FRAME_HEADER_BYTES, frameBytes)));
}

export async function authenticateFramescaperDecodedImageSequencePack(
	handle: FileHandle,
	source: NativeMediaImageSequenceSourceV25,
	completion: Readonly<{ byteLength: number; sha256: string }>,
) {
	const before = await handle.stat();
	if (!before.isFile() || before.size !== completion.byteLength
		|| await digestHandle(handle, completion.byteLength) !== completion.sha256) {
		throw new Error('The installed decoded image-sequence claim changed authenticated identity.');
	}
	const header = new Uint8Array(IMAGE_SEQUENCE_DECODE_HEADER_BYTES);
	if ((await handle.read(header, 0, header.byteLength, 0)).bytesRead !== header.byteLength
		|| !MAGIC.every((byte, index) => header[index] === byte)) {
		throw new Error('Native image-sequence decode returned an invalid RGBA-pack header.');
	}
	const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
	const version = view.getUint32(31, true);
	const width = view.getUint32(35, true);
	const height = view.getUint32(39, true);
	const frameCount = safeBigInt(view.getBigUint64(43, true), 'decoded frame count');
	const rateDen = view.getUint32(51, true);
	const rateNum = view.getUint32(55, true);
	if (version !== 1 || width !== source.characteristics.codedWidth
		|| height !== source.characteristics.codedHeight || frameCount !== source.frameCount
		|| rateNum !== source.frameRate.num || rateDen !== source.frameRate.den) {
		throw new Error('Native image-sequence decode changed geometry, count, version, or rational rate.');
	}
	const rgbaBytes = safeProduct(width, height, 4);
	let offset = IMAGE_SEQUENCE_DECODE_HEADER_BYTES;
	const frameHeader = new Uint8Array(IMAGE_SEQUENCE_DECODE_FRAME_HEADER_BYTES);
	for (let ordinal = 0; ordinal < frameCount; ordinal += 1) {
		if ((await handle.read(frameHeader, 0, frameHeader.byteLength, offset)).bytesRead !== frameHeader.byteLength) {
			throw new Error('Native image-sequence decode truncated a frame header.');
		}
		const frame = new DataView(frameHeader.buffer, frameHeader.byteOffset, frameHeader.byteLength);
		if (safeBigInt(frame.getBigUint64(0, true), 'decoded frame ordinal') !== ordinal
			|| safeSignedBigInt(frame.getBigInt64(8, true), 'decoded frame timestamp') !== ordinal
			|| safeSignedBigInt(frame.getBigInt64(16, true), 'decoded frame duration') !== 1
			|| safeBigInt(frame.getBigUint64(24, true), 'decoded RGBA byte length') !== rgbaBytes) {
			throw new Error('Native image-sequence decode changed frame ordinal, time, duration, or byte extent.');
		}
		offset = safeAdd(offset, safeAdd(IMAGE_SEQUENCE_DECODE_FRAME_HEADER_BYTES, rgbaBytes));
	}
	if (offset !== completion.byteLength) throw new Error('Native image-sequence decode contains trailing or missing bytes.');
	const after = await handle.stat();
	if (!after.isFile() || after.size !== before.size || after.dev !== before.dev || after.ino !== before.ino) {
		throw new Error('The decoded image-sequence claim changed while its pack was authenticated.');
	}
	return Object.freeze({ width, height, frameCount });
}

async function digestHandle(handle: FileHandle, byteLength: number): Promise<string> {
	const hash = createHash('sha256');
	const bytes = Buffer.allocUnsafe(Math.min(MAXIMUM_DIGEST_CHUNK_BYTES, byteLength));
	for (let offset = 0; offset < byteLength;) {
		const length = Math.min(bytes.byteLength, byteLength - offset);
		const result = await handle.read(bytes, 0, length, offset);
		if (result.bytesRead !== length) throw new Error('The decoded image-sequence claim ended during authentication.');
		hash.update(bytes.subarray(0, length));
		offset += length;
	}
	return hash.digest('hex');
}

function exactProjectBundle(value: unknown, projectId: string, revision: number) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('The baseline project bundle is unavailable.');
	const row = value as Record<string, unknown>;
	const project = row.project as Record<string, unknown> | null;
	assertFramescaperIdentity(project, 'image-sequence project bundle');
	if (!project || project.projectRevision !== revision || typeof row.document !== 'string' || !Array.isArray(row.bodies)) {
		throw new Error('The baseline project bundle changed revision or body authority.');
	}
	let document: unknown;
	try { document = JSON.parse(row.document); } catch { throw new Error('The baseline project document is not JSON.'); }
	assertFramescaperIdentity(document, 'image-sequence project document');
	if (!document || typeof document !== 'object' || Array.isArray(document)
		|| (document as Record<string, unknown>).id !== projectId
		|| (document as Record<string, unknown>).revision !== revision) {
		throw new Error('The baseline project document changed selected identity.');
	}
	return Object.freeze({ document: document as Record<string, unknown>, bodies: row.bodies as readonly unknown[] });
}

function exactProjectSequenceSource(document: Record<string, unknown>, sourceId: string): NativeMediaImageSequenceSourceV25 {
	if (!Array.isArray(document.sources)) throw new TypeError('The baseline project has no source inventory.');
	const matches = document.sources.filter((value) => value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Record<string, unknown>).id === sourceId);
	if (matches.length !== 1) throw new Error('The image-sequence source is absent or duplicated.');
	const source = matches[0] as Record<string, unknown>;
	if (source.kind !== 'video' || source.imageSequence === null || source.imageSequence === undefined) {
		throw new Error('The requested baseline source is not an imported image sequence.');
	}
	const sequence = normalizeNativeMediaImageSequenceSourceV25(source.imageSequence);
	if (sequence.id !== sourceId || source.storageKey !== sequence.sourcePack.storageKey
		|| source.contentSha256 !== sequence.sourcePack.sha256) {
		throw new Error('The image-sequence source lost pack identity authority.');
	}
	return sequence;
}

function exactBody(bodies: readonly unknown[], storageKey: string, kind: string) {
	const matches = bodies.filter((value) => value && typeof value === 'object' && !Array.isArray(value)
		&& (value as Record<string, unknown>).kind === kind
		&& (value as Record<string, unknown>).storageKey === storageKey);
	if (matches.length !== 1) throw new Error(`The baseline ${kind} body is absent or duplicated.`);
	const body = matches[0] as Record<string, unknown>;
	if (!Number.isSafeInteger(body.byteLength) || Number(body.byteLength) < 1
		|| typeof body.sha256 !== 'string') throw new TypeError(`The baseline ${kind} body is malformed.`);
	return Object.freeze({ byteLength: Number(body.byteLength), sha256: body.sha256 });
}

function assertFramescaperIdentity(value: unknown, label: string): void {
	const identity = readProjectSchemaIdentity(value);
	if (identity.schemaFamily !== FRAMESCAPER_PROJECT_SCHEMA_FAMILY
		|| identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(`The ${label} requires the current Framescaper schema.`);
	}
}

function safeAdd(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) throw new RangeError('Image-sequence byte accounting overflowed.');
	return left + right;
}

function safeProduct(...values: number[]): number {
	return values.reduce((total, value) => {
		if (!Number.isSafeInteger(value) || value < 0 || (value !== 0 && total > Number.MAX_SAFE_INTEGER / value)) {
			throw new RangeError('Image-sequence byte accounting overflowed.');
		}
		return total * value;
	}, 1);
}

function safeBigInt(value: bigint, label: string): number {
	if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError(`The ${label} exceeds the safe integer domain.`);
	return Number(value);
}

function safeSignedBigInt(value: bigint, label: string): number {
	if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
		throw new RangeError(`The ${label} exceeds the safe integer domain.`);
	}
	return Number(value);
}
