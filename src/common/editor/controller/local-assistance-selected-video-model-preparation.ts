/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded visual-model frame custody shared by Guided Reframe's two primitive stages. */

import type { AssistanceOperation } from '../assistance/operation.ts';
import {
	createLocalAssistanceSelectedVideoVisualFramePackV2,
	LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE,
	LOCAL_ASSISTANCE_REFRAME_MAXIMUM_RASTER_DIMENSION,
	type LocalAssistanceSelectedVideoVisualFramePackRequest,
} from './local-assistance-selected-video-frame-pack.ts';
import type { LocalAssistanceSelectedVideoFramePackTiming } from
	'./local-assistance-selected-video-timing.ts';

export type LocalAssistanceSelectedVideoModelOperation = Extract<AssistanceOperation,
	'subject-detection' | 'saliency-detection'>;
export type LocalAssistanceSelectedVideoModelOutputRole = 'subject-tracks' | 'saliency-map';

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
	if (request.operation !== 'subject-detection' && request.operation !== 'saliency-detection') {
		throw new RangeError('This selected-video model operation is unsupported.');
	}
	const sourceWidth = integer(request.sourceWidth, 1, 4_096, 'source width');
	const sourceHeight = integer(request.sourceHeight, 1, 4_096, 'source height');
	const raster = boundedRaster(sourceWidth, sourceHeight);
	const create = dependencies.createFramePack
		?? createLocalAssistanceSelectedVideoVisualFramePackV2;
	const framePackRequest = Object.freeze({ body: request.body, timing: request.timing,
		sourceWidth, sourceHeight, rasterWidth: raster.width, rasterHeight: raster.height,
		signal: request.signal, assertCurrent: request.assertCurrent });
	request.signal.throwIfAborted();
	request.assertCurrent();
	const bytes = await create(framePackRequest);
	request.signal.throwIfAborted();
	request.assertCurrent();
	if (!(bytes instanceof Blob) || bytes.size < 1
		|| bytes.size > request.maximumInputBytes
		|| bytes.type !== LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE) {
		throw new RangeError('Selected-video model frame custody exceeds its exact byte bound.');
	}
	const role = request.operation === 'subject-detection' ? 'subject-tracks' : 'saliency-map';
	return Object.freeze({
		inputs: Object.freeze([Object.freeze({ role: 'frame-pack' as const,
			mediaType: LOCAL_ASSISTANCE_FRAME_PACK_MEDIA_TYPE, bytes })]),
		outputs: Object.freeze([Object.freeze({ role,
			mediaType: `application/vnd.soundscaper.${role}+json`,
			maximumByteLength: MAXIMUM_OUTPUT_BYTES })]),
	});
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
