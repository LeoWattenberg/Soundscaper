/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded visual-model frame custody shared by Guided Reframe's two primitive stages. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	createLocalAssistanceSelectedVideoVisualFramePacksV2,
	LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
	LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION,
	LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS,
	LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK,
	type LocalAssistanceSelectedVideoVisualFramePackRequest,
} from './local-assistance-selected-video-frame-pack.ts';
import type { LocalAssistanceSelectedVideoFramePackTiming } from
	'./local-assistance-selected-video-timing.ts';

export type LocalAssistanceSelectedVideoModelOperation = Extract<AssistanceOperation,
	'image-text-embedding' | 'optical-character-recognition'
	| 'subject-detection' | 'saliency-detection'>;
export type LocalAssistanceSelectedVideoModelOutputRole =
	'embeddings' | 'recognized-text' | 'subject-tracks' | 'saliency-map';

export interface LocalAssistanceSelectedVideoModelFramePackDependencies {
	readonly createFramePack?: (
		request: LocalAssistanceSelectedVideoVisualFramePackRequest,
	) => PromiseLike<Blob> | Blob;
}

export interface LocalAssistanceSelectedVideoModelFramePackRequest {
	readonly operation: LocalAssistanceSelectedVideoModelOperation;
	readonly body: Blob;
	readonly timing: LocalAssistanceSelectedVideoFramePackTiming;
	readonly sourceWidth: number;
	readonly sourceHeight: number;
	readonly signal: AbortSignal;
	readonly assertCurrent: () => void;
	readonly maximumInputBytes: number;
}

export interface LocalAssistanceSelectedVideoModelFramePackPrepared {
	readonly inputs: readonly Readonly<{
		readonly role: 'frame-pack';
		readonly mediaType: typeof LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE;
		readonly bytes: Blob;
	}>[];
	readonly outputs: readonly Readonly<{
		readonly role: LocalAssistanceSelectedVideoModelOutputRole;
		readonly mediaType: string;
		readonly maximumByteLength: number;
	}>[];
}

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;

export async function createLocalAssistanceSelectedVideoModelFramePack(
	dependencies: LocalAssistanceSelectedVideoModelFramePackDependencies,
	request: LocalAssistanceSelectedVideoModelFramePackRequest,
): Promise<LocalAssistanceSelectedVideoModelFramePackPrepared> {
	if (dependencies.createFramePack !== undefined
		&& typeof dependencies.createFramePack !== 'function') {
		throw new TypeError('Selected-video model packing requires an exact frame-pack factory.');
	}
	if (!['image-text-embedding', 'optical-character-recognition',
		'subject-detection', 'saliency-detection'].includes(request.operation)) {
		throw new RangeError('This selected-video model operation is unsupported.');
	}
	const sourceWidth = integer(request.sourceWidth, 1, 4_096, 'source width');
	const sourceHeight = integer(request.sourceHeight, 1, 4_096, 'source height');
	const raster = boundedRaster(sourceWidth, sourceHeight);
	const framePackRequest = Object.freeze({ body: request.body, timing: request.timing,
		sourceWidth, sourceHeight, rasterWidth: raster.width, rasterHeight: raster.height,
		signal: request.signal, assertCurrent: request.assertCurrent });
	request.signal.throwIfAborted();
	request.assertCurrent();
	const packs = dependencies.createFramePack
		? await createInjectedFramePacks(dependencies.createFramePack, framePackRequest)
		: await createLocalAssistanceSelectedVideoVisualFramePacksV2(framePackRequest);
	request.signal.throwIfAborted();
	request.assertCurrent();
	let aggregateBytes = 0;
	for (const bytes of packs) {
		if (!(bytes instanceof Blob) || bytes.size < 1
			|| bytes.type !== LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE) {
			throw new RangeError('Selected-video model frame custody requires exact frame-pack Blobs.');
		}
		aggregateBytes += bytes.size;
		if (!Number.isSafeInteger(aggregateBytes) || aggregateBytes > request.maximumInputBytes) {
			throw new RangeError('Selected-video model frame custody exceeds its exact byte bound.');
		}
	}
	const role = outputRole(request.operation);
	return Object.freeze({
		inputs: Object.freeze(packs.map((bytes) => Object.freeze({ role: 'frame-pack' as const,
			mediaType: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE, bytes }))),
		outputs: Object.freeze([Object.freeze({ role,
			mediaType: role === 'embeddings'
				? 'application/vnd.soundscaper.embedding-matrix-v1'
				: `application/vnd.soundscaper.${role}+json`,
			maximumByteLength: MAXIMUM_OUTPUT_BYTES })]),
	});
}

async function createInjectedFramePacks(
	create: NonNullable<LocalAssistanceSelectedVideoModelFramePackDependencies['createFramePack']>,
	request: LocalAssistanceSelectedVideoVisualFramePackRequest,
): Promise<readonly Blob[]> {
	const count = Math.ceil(request.timing.frames.length / LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK);
	if (count < 1 || count > LOCAL_ASSISTANCE_VIDEO_MAXIMUM_FRAME_PACKS) {
		throw new RangeError('Selected-video model frame custody exceeds its bounded pack inventory.');
	}
	const packs: Blob[] = [];
	for (let index = 0; index < count; index += 1) {
		const first = index * LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK;
		const timing = Object.freeze({ timescale: request.timing.timescale,
			frames: request.timing.frames.slice(first,
				first + LOCAL_ASSISTANCE_VISUAL_FRAMES_PER_PACK) });
		packs.push(await create(Object.freeze({ ...request, timing })));
	}
	return Object.freeze(packs);
}

function outputRole(operation: LocalAssistanceSelectedVideoModelOperation):
LocalAssistanceSelectedVideoModelOutputRole {
	if (operation === 'image-text-embedding') return 'embeddings';
	if (operation === 'optical-character-recognition') return 'recognized-text';
	return operation === 'subject-detection' ? 'subject-tracks' : 'saliency-map';
}

function boundedRaster(sourceWidth: number, sourceHeight: number): Readonly<{
	width: number; height: number;
}> {
	const scale = Math.min(1, LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION
		/ Math.max(sourceWidth, sourceHeight));
	return Object.freeze({ width: Math.max(1, Math.round(sourceWidth * scale)),
		height: Math.max(1, Math.round(sourceHeight * scale)) });
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The selected-video model ${label} is invalid.`);
	}
	return Number(value);
}
