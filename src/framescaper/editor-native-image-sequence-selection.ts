/* SPDX-License-Identifier: AGPL-3.0-only */

/** Candidate renderer adapter for the main-owned pathless image-sequence picker. */

import {
	NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES,
} from '../common/editor/native-media-image-sequence-pack-v25.ts';
import type {
	NativeMediaImageSequenceRateV1,
} from '../common/editor/native-media-image-sequence.ts';
import { resolveNativeMediaImageSequence } from '../common/editor/native-media-image-sequence.ts';
import type {
	FramescaperNativeServicesBridge,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type {
	FramescaperImageSequenceSelection,
} from './editor-native-image-sequence-import.ts';

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const OPAQUE_ID = /^[a-f0-9]{40}$/u;

export interface SelectFramescaperDesktopImageSequenceProfessionalMediaOptions {
	readonly bridge: Pick<FramescaperNativeServicesBridge,
		'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'> | unknown;
	readonly sourceId: string;
	readonly projectBinClipId: string;
	readonly name: string;
	readonly frameRate: NativeMediaImageSequenceRateV1;
	readonly maximumChunkBytes?: number;
}

/**
 * Select once, expose two fresh streams per file to the existing digest/pack
 * composition, and release the main-owned capability as soon as both passes
 * have completed. Native paths never enter this module.
 */
export async function selectFramescaperDesktopImageSequenceProfessionalMedia(
	options: SelectFramescaperDesktopImageSequenceProfessionalMediaOptions,
): Promise<FramescaperImageSequenceSelection | null> {
	const bridge = exactBridge(options.bridge);
	const maximumChunkBytes = chunkCeiling(options.maximumChunkBytes);
	const sourceId = stableId(options.sourceId, 'source ID');
	const projectBinClipId = stableId(options.projectBinClipId, 'Project Bin clip ID');
	const name = stableId(options.name, 'source name');
	const frameRate = exactRate(options.frameRate);
	const selected = await bridge.selectImageSequence();
	if (selected === null) return null;
	const selection = selectionProjection(selected);
	let releasePromise: Promise<void> | null = null;
	const release = (): Promise<void> => {
		releasePromise ??= Promise.resolve(bridge.releaseImageSequence({
			selectionId: selection.selectionId,
		})).then((released) => {
			if (released !== true) throw new Error('The desktop image-sequence selection was not released.');
		});
		return releasePromise;
	};
	try {
		resolveNativeMediaImageSequence({
			fileNames: selection.files.map((file) => file.name), frameRate,
		});
	} catch (error) {
		await release();
		throw error;
	}
	const completed = selection.files.map(() => 0);
	return Object.freeze({
		sourceId,
		projectBinClipId,
		name,
		frameRate,
		files: Object.freeze(selection.files.map((file, index) => Object.freeze({
			name: file.name,
			byteLength: file.byteLength,
			chunks: () => readFileChunks({
				bridge, selectionId: selection.selectionId, file,
				maximumChunkBytes,
				onComplete: async () => {
					completed[index] = (completed[index] ?? 0) + 1;
					if (completed.every((count) => count >= 2)) await release();
				},
				onIncomplete: release,
			}),
		}))),
	});
}

async function* readFileChunks(input: Readonly<{
	bridge: Required<Pick<FramescaperNativeServicesBridge,
		'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'>>;
	selectionId: string;
	file: Readonly<{ fileId: string; name: string; byteLength: number }>;
	maximumChunkBytes: number;
	onComplete: () => Promise<void>;
	onIncomplete: () => Promise<void>;
}>): AsyncGenerator<Uint8Array> {
	let complete = false;
	try {
		for (let offset = 0; offset < input.file.byteLength;) {
			const length = Math.min(input.maximumChunkBytes, input.file.byteLength - offset);
			const bytes = await input.bridge.readImageSequenceFile({
				selectionId: input.selectionId, fileId: input.file.fileId, offset, length,
			});
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
				throw new Error('The desktop image-sequence selection returned an inexact range.');
			}
			offset += length;
			yield bytes.slice();
		}
		complete = true;
		await input.onComplete();
	} finally {
		if (!complete) await input.onIncomplete();
	}
}

function exactBridge(value: unknown): Required<Pick<FramescaperNativeServicesBridge,
	'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'>> {
	if (!value || typeof value !== 'object' || [
		'selectImageSequence', 'readImageSequenceFile', 'releaseImageSequence',
	].some((method) => typeof (value as Readonly<Record<string, unknown>>)[method] !== 'function')) {
		throw new TypeError('Candidate import requires the complete pathless desktop image-sequence bridge.');
	}
	return value as Required<Pick<FramescaperNativeServicesBridge,
		'selectImageSequence' | 'readImageSequenceFile' | 'releaseImageSequence'>>;
}

function selectionProjection(value: unknown) {
	const record = exactRecord(value, ['selectionId', 'files'], 'desktop image-sequence selection');
	const selectionId = opaqueId(record.selectionId, 'selection ID');
	if (!Array.isArray(record.files) || record.files.length === 0 || record.files.length > 1_000_000
		|| Reflect.ownKeys(record.files).length !== record.files.length + 1) {
		throw new TypeError('Desktop image-sequence selection has an invalid file inventory.');
	}
	const ids = new Set<string>();
	const files = record.files.map((value, index) => {
		const file = exactRecord(value, ['fileId', 'name', 'byteLength'], `selected file ${String(index)}`);
		const fileId = opaqueId(file.fileId, 'file ID');
		if (ids.has(fileId) || typeof file.name !== 'string' || file.name.length < 1
			|| file.name.length > 512 || file.name.includes('/') || file.name.includes('\\')
			|| file.name.includes('\0') || !Number.isSafeInteger(file.byteLength)
			|| Number(file.byteLength) < 1 || Number(file.byteLength) > 512 * 1024 * 1024) {
			throw new TypeError('Desktop image-sequence selection contains an invalid pathless file.');
		}
		ids.add(fileId);
		return Object.freeze({ fileId, name: file.name, byteLength: Number(file.byteLength) });
	});
	return Object.freeze({ selectionId, files: Object.freeze(files) });
}

function chunkCeiling(value: unknown): number {
	if (value === undefined) return NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES;
	if (!Number.isSafeInteger(value) || Number(value) < 1
		|| Number(value) > NATIVE_MEDIA_IMAGE_SEQUENCE_PACK_MAXIMUM_CHUNK_BYTES) {
		throw new RangeError('Desktop image-sequence chunk ceiling is invalid.');
	}
	return Number(value);
}

function exactRate(value: unknown): NativeMediaImageSequenceRateV1 {
	const rate = exactRecord(value, ['num', 'den'], 'image-sequence frame rate');
	if (!Number.isSafeInteger(rate.num) || Number(rate.num) < 1
		|| !Number.isSafeInteger(rate.den) || Number(rate.den) < 1
		|| gcd(Number(rate.num), Number(rate.den)) !== 1) {
		throw new TypeError('Image-sequence frame rate must be an exact reduced rational.');
	}
	return Object.freeze({ num: Number(rate.num), den: Number(rate.den) });
}

function gcd(left: number, right: number): number {
	while (right !== 0) [left, right] = [right, left % right];
	return left;
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Image-sequence ${label} is invalid.`);
	return value;
}

function opaqueId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !OPAQUE_ID.test(value)) throw new TypeError(`Image-sequence ${label} is invalid.`);
	return value;
}

function exactRecord(value: unknown, fields: readonly string[], label: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length
		|| fields.some((field) => !Object.hasOwn(value, field))) {
		throw new TypeError(`${label} must be an exact record.`);
	}
	return value as Readonly<Record<string, unknown>>;
}
