/* SPDX-License-Identifier: AGPL-3.0-only */

import { AIFF_MAXIMUM_FILE_BYTES } from '../aiff.js';
import {
	commitDirectPcmDestination,
	createDirectPcmEncoder,
	directPcmMaximumPendingChunks,
	directPcmRenderQueueOptions,
	openDirectPcmDestination,
	type DirectPcmContainerEncoder,
	type DirectPcmDestination,
	type DirectPcmEncoder,
	type DirectPcmPreparation,
} from './direct-pcm-export.ts';

export {
	DIRECT_PCM_DESTINATION_WRITE_BYTES as DIRECT_AIFF_DESTINATION_WRITE_BYTES,
	DIRECT_PCM_MAXIMUM_PENDING_BYTES as DIRECT_AIFF_MAXIMUM_PENDING_PCM_BYTES,
	DIRECT_PCM_RENDER_CHUNK_FRAMES as DIRECT_AIFF_RENDER_CHUNK_FRAMES,
} from './direct-pcm-export.ts';

export const DIRECT_AIFF_MAXIMUM_FILE_BYTES = AIFF_MAXIMUM_FILE_BYTES;

const AIFF_CONTAINER_LABEL = 'AIFF';
const AIFF_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'AIFF audio',
	accept: Object.freeze({ 'audio/aiff': Object.freeze(['.aiff']) }),
})]);

interface DirectAiffPlan {
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
}

export type DirectAiffDestination = DirectPcmDestination;
export type DirectAiffEncoder = DirectPcmEncoder;
export type DirectAiffPreparation = DirectPcmPreparation;

export function directAiffMaximumPendingChunks(channelCount: number): number {
	return directPcmMaximumPendingChunks(channelCount, AIFF_CONTAINER_LABEL);
}

export function directAiffRenderQueueOptions(channelCount: number): Readonly<{
	chunkFrames: number;
	maximumPendingChunks: number;
}> {
	return directPcmRenderQueueOptions(channelCount, AIFF_CONTAINER_LABEL);
}

export async function prepareDirectAiffDestination(
	fileService: Readonly<{
		prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}>,
	plan: DirectAiffPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectAiffPreparation> {
	if (!directAiffPlan(plan) || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const fileName = String((plan.outputs as readonly Readonly<{ fileName?: unknown }>[])[0]?.fileName || 'mix.aiff');
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio-pcm-mix',
		suggestedName: fileName,
		mimeType: 'audio/aiff',
		target: settings.saveTarget,
		types: AIFF_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	return openDirectPcmDestination(
		prepared,
		plan.outputFileBytesPerRender as number,
		AIFF_CONTAINER_LABEL,
	);
}

export function createDirectAiffEncoder(
	destination: DirectAiffDestination,
	createEncoder: (options: Readonly<Record<string, unknown>>) => DirectPcmContainerEncoder,
	options: Readonly<Record<string, unknown>>,
): Promise<DirectAiffEncoder> {
	return createDirectPcmEncoder(destination, createEncoder, options, AIFF_CONTAINER_LABEL);
}

export function commitDirectAiffDestination(
	destination: DirectAiffDestination,
	plannedByteLength: number,
	encodedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	return commitDirectPcmDestination(
		destination,
		plannedByteLength,
		encodedByteLength,
		assertReadyToCommit,
		AIFF_CONTAINER_LABEL,
	);
}

function directAiffPlan(plan: DirectAiffPlan): plan is DirectAiffPlan & {
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly [Readonly<{ readonly fileName?: unknown }>];
} {
	return plan?.format === 'aiff'
		&& plan.mimeType === 'audio/aiff'
		&& plan.mode === 'mix'
		&& plan.render?.strategy === 'realtime-stream'
		&& Array.isArray(plan.outputs)
		&& plan.outputs.length === 1
		&& typeof plan.outputs[0]?.fileName === 'string'
		&& plan.outputs[0].fileName.toLowerCase().endsWith('.aiff')
		&& Number.isSafeInteger(plan.outputFileBytesPerRender)
		&& Number(plan.outputFileBytesPerRender) > 0
		&& Number(plan.outputFileBytesPerRender) <= DIRECT_AIFF_MAXIMUM_FILE_BYTES;
}

function emptyPreparation(): DirectAiffPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
