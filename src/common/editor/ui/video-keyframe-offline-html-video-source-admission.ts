/* SPDX-License-Identifier: AGPL-3.0-only */

import type { VideoRetimeFrameDescriptor } from '../video-retime-frame-dispatch.ts';
import { planVideoPreviewCapture } from '../video-preview-capture-admission.ts';

export interface VideoKeyframeOfflineHtmlVideoSourceAsset {
	readonly sourceId: string;
	readonly identity: string;
	readonly blob: Blob;
	readonly clipIds: readonly string[];
	readonly decodedWidth: number;
	readonly decodedHeight: number;
	readonly displayWidth: number;
	readonly displayHeight: number;
	readonly presentationForEntry: (
		entry: Readonly<Record<string, unknown>>,
	) => VideoRetimeFrameDescriptor;
}

export interface VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot extends Omit<
	VideoKeyframeOfflineHtmlVideoSourceAsset,
	'clipIds'
> {
	readonly clipIds: ReadonlySet<string>;
}

export interface VideoKeyframeOfflineHtmlVideoEntryBinding {
	readonly asset: VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot;
	readonly entry: Readonly<Record<string, unknown>>;
	readonly occurrenceKey: string;
}

const ID_MAXIMUM_LENGTH = 256;
const MAXIMUM_SOURCE_COUNT = 4_096;
const MAXIMUM_CLIP_REFERENCES = 100_000;
const SHA256 = /^[a-f0-9]{64}$/u;
const NATIVE_BLOB_SLICE = Blob.prototype.slice;
const NATIVE_BLOB_SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')?.get;
const NATIVE_BLOB_TYPE = Object.getOwnPropertyDescriptor(Blob.prototype, 'type')?.get;

/** Snapshot immutable source/occurrence authority before any browser media allocation. */
export function admitVideoKeyframeOfflineHtmlVideoSourceAssets(
	value: unknown,
): ReadonlyMap<string, VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot> {
	const values = denseArray(value, 'offline HTML video sources', MAXIMUM_SOURCE_COUNT);
	if (values.length < 1) throw new RangeError('At least one offline HTML video source is required.');
	const assets = new Map<string, VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot>();
	let clipReferences = 0;
	for (const [index, sourceValue] of values.entries()) {
		const name = `offline HTML video sources[${String(index)}]`;
		const source = closedRecord(sourceValue, name, [
			'sourceId', 'identity', 'blob', 'clipIds', 'decodedWidth', 'decodedHeight',
			'displayWidth', 'displayHeight', 'presentationForEntry',
		]);
		const sourceId = boundedId(source.sourceId, `${name}.sourceId`);
		if (assets.has(sourceId)) throw new RangeError(`Duplicate offline HTML video source ID ${sourceId}.`);
		const identity = digest(source.identity, `${name}.identity`);
		const blob = canonicalBlob(source.blob);
		if (blob.size < 1) throw new RangeError(`${name}.blob must not be empty.`);
		const decodedWidth = dimension(source.decodedWidth, `${name}.decodedWidth`);
		const decodedHeight = dimension(source.decodedHeight, `${name}.decodedHeight`);
		planVideoPreviewCapture({ sourceWidth: decodedWidth, sourceHeight: decodedHeight });
		const displayWidth = dimension(source.displayWidth, `${name}.displayWidth`);
		const displayHeight = dimension(source.displayHeight, `${name}.displayHeight`);
		const clipValues = denseArray(source.clipIds, `${name}.clipIds`, MAXIMUM_CLIP_REFERENCES);
		clipReferences += clipValues.length;
		if (clipReferences > MAXIMUM_CLIP_REFERENCES || clipValues.length < 1) {
			throw new RangeError('Offline HTML video clip references exceed their hard limit.');
		}
		const clipIds = new Set<string>();
		for (const [clipIndex, clipValue] of clipValues.entries()) {
			const clipId = boundedId(clipValue, `${name}.clipIds[${String(clipIndex)}]`);
			if (clipIds.has(clipId)) throw new RangeError(`${name}.clipIds contains a duplicate clip ID.`);
			clipIds.add(clipId);
		}
		if (typeof source.presentationForEntry !== 'function') {
			throw new TypeError(`${name}.presentationForEntry must be a function.`);
		}
		assets.set(sourceId, Object.freeze({
			sourceId,
			identity,
			blob,
			clipIds,
			decodedWidth,
			decodedHeight,
			displayWidth,
			displayHeight,
			presentationForEntry: source.presentationForEntry as VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot['presentationForEntry'],
		}));
	}
	return assets;
}

/** Bind a renderer entry to its admitted digest and exact clip occurrence. */
export function bindVideoKeyframeOfflineHtmlVideoEntry(
	value: unknown,
	assets: ReadonlyMap<string, VideoKeyframeOfflineHtmlVideoSourceAssetSnapshot>,
): VideoKeyframeOfflineHtmlVideoEntryBinding {
	const entry = dataRecord(value, 'offline video frame entry');
	const sourceId = boundedId(data(entry, 'sourceId', 'offline video frame entry'), 'offline video frame entry.sourceId');
	const clipId = boundedId(data(entry, 'clipId', 'offline video frame entry'), 'offline video frame entry.clipId');
	const asset = assets.get(sourceId);
	if (!asset) throw new ReferenceError(`Offline video source ${sourceId} is not admitted.`);
	if (!asset.clipIds.has(clipId)) throw new RangeError('The offline video clip is not bound to its admitted source.');
	const source = dataRecord(data(entry, 'source', 'offline video frame entry'), 'offline video frame source');
	const clip = dataRecord(data(entry, 'clip', 'offline video frame entry'), 'offline video frame clip');
	if (data(source, 'kind', 'offline video frame source') !== 'video'
		|| data(source, 'id', 'offline video frame source') !== sourceId
		|| data(source, 'contentSha256', 'offline video frame source') !== asset.identity) {
		throw new Error('The offline video frame source identity or digest does not match its admitted Blob.');
	}
	if (data(clip, 'kind', 'offline video frame clip') !== 'video'
		|| data(clip, 'id', 'offline video frame clip') !== clipId
		|| data(clip, 'sourceId', 'offline video frame clip') !== sourceId) {
		throw new Error('The offline video frame clip identity does not match its admitted source.');
	}
	return Object.freeze({ asset, entry, occurrenceKey: `${String(sourceId.length)}:${sourceId}${clipId}` });
}

function closedRecord(value: unknown, name: string, required: readonly string[]): Readonly<Record<string, unknown>> {
	const record = dataRecord(value, name);
	const keys = Reflect.ownKeys(record);
	if (keys.length !== required.length || keys.some((key) => typeof key !== 'string' || !required.includes(key))
		|| required.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} must be a closed own-data record.`);
	}
	const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const key of keys) snapshot[String(key)] = data(record, String(key), name);
	return Object.freeze(snapshot);
}

function dataRecord(value: unknown, name: string): Readonly<Record<string, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain record.`);
	return value as Readonly<Record<string, unknown>>;
}

function data(value: object, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an enumerable data property.`);
	}
	return descriptor.value;
}

function denseArray(value: unknown, name: string, maximum: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
		|| value.length > maximum) throw new RangeError(`${name} must be a bounded ordinary array.`);
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).length !== value.length + 1) throw new TypeError(`${name} cannot contain named properties.`);
	return Object.freeze(result);
}

function boundedId(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > ID_MAXIMUM_LENGTH) {
		throw new TypeError(`${name} must be a bounded nonempty string.`);
	}
	return value;
}

function digest(value: unknown, name: string): string {
	if (typeof value !== 'string' || !SHA256.test(value)) throw new TypeError(`${name} must be a lowercase SHA-256 digest.`);
	return value;
}

function canonicalBlob(value: unknown): Blob {
	try {
		if (!NATIVE_BLOB_SIZE || !NATIVE_BLOB_TYPE) throw new TypeError();
		const size = Reflect.apply(NATIVE_BLOB_SIZE, value, []) as unknown;
		const type = Reflect.apply(NATIVE_BLOB_TYPE, value, []) as unknown;
		if (!Number.isSafeInteger(size) || Number(size) < 0 || typeof type !== 'string') throw new TypeError();
		const blob = Reflect.apply(NATIVE_BLOB_SLICE, value, [0, size, type]) as unknown;
		if (!(blob instanceof Blob)) throw new TypeError();
		return blob;
	} catch {
		throw new TypeError('An offline video source requires a genuine Blob or File.');
	}
}

function dimension(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 65_536) {
		throw new RangeError(`${name} is outside its hard limit.`);
	}
	return Number(value);
}
