/* SPDX-License-Identifier: AGPL-3.0-only */

import { AIFF_MAXIMUM_FILE_BYTES, inspectAiffLayout } from '../aiff.js';
import { directAudioRenderStrategy } from './direct-audio-render-plan.ts';
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
const AIFF_MAXIMUM_FRAME_COUNT = 0xffff_ffff;
const AIFF_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'AIFF audio',
	accept: Object.freeze({ 'audio/aiff': Object.freeze(['.aiff']) }),
})]);

type DirectAiffSampleFormat = 'int16' | 'int24' | 'int32' | 'float32';

interface DirectAiffEncoding {
	readonly bitDepth?: unknown;
	readonly floatingPoint?: unknown;
	readonly sampleFormat?: unknown;
}

interface DirectAiffPlan {
	readonly channelCount?: number;
	readonly encoding?: DirectAiffEncoding;
	readonly format?: unknown;
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputFrames?: number;
	readonly outputs?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
	readonly sampleRate?: number;
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
	backpressureHighWaterChunks: number;
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
	const sampleFormat = canonicalAiffSampleFormat(plan?.encoding);
	if (plan?.format !== 'aiff'
		|| plan.mimeType !== 'audio/aiff'
		|| plan.mode !== 'mix'
		|| directAudioRenderStrategy(plan) === null
		|| !Number.isSafeInteger(plan.sampleRate)
		|| Number(plan.sampleRate) <= 0
		|| !Number.isSafeInteger(plan.channelCount)
		|| Number(plan.channelCount) <= 0
		|| Number(plan.channelCount) > 32
		|| !Number.isSafeInteger(plan.outputFrames)
		|| Number(plan.outputFrames) < 0
		|| Number(plan.outputFrames) > AIFF_MAXIMUM_FRAME_COUNT
		|| !isRecord(plan.metadata)
		|| sampleFormat === null
		|| !Array.isArray(plan.outputs)
		|| plan.outputs.length !== 1
		|| typeof plan.outputs[0]?.fileName !== 'string'
		|| !plan.outputs[0].fileName.toLowerCase().endsWith('.aiff')
		|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
		|| Number(plan.outputFileBytesPerRender) <= 0
		|| Number(plan.outputFileBytesPerRender) > DIRECT_AIFF_MAXIMUM_FILE_BYTES) return false;
	return hasExactAiffLayout(plan, sampleFormat);
}

function canonicalAiffSampleFormat(encoding: DirectAiffEncoding | undefined): DirectAiffSampleFormat | null {
	if (!isRecord(encoding)) return null;
	if (encoding.sampleFormat === 'int16'
		&& encoding.bitDepth === 16
		&& encoding.floatingPoint === false) return 'int16';
	if (encoding.sampleFormat === 'int24'
		&& encoding.bitDepth === 24
		&& encoding.floatingPoint === false) return 'int24';
	if (encoding.sampleFormat === 'int32'
		&& encoding.bitDepth === 32
		&& encoding.floatingPoint === false) return 'int32';
	if (encoding.sampleFormat === 'float32'
		&& encoding.bitDepth === 32
		&& encoding.floatingPoint === true) return 'float32';
	return null;
}

function hasExactAiffLayout(plan: DirectAiffPlan, sampleFormat: DirectAiffSampleFormat): boolean {
	try {
		const floatingPoint = sampleFormat === 'float32';
		const bitDepth = sampleFormat === 'int16' ? 16 : sampleFormat === 'int24' ? 24 : 32;
		const layout = inspectAiffLayout({
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: floatingPoint,
			sampleFormat,
			metadata: plan.metadata,
		});
		return layout.container === (floatingPoint ? 'aifc' : 'aiff')
			&& layout.byteLength === plan.outputFileBytesPerRender
			&& layout.byteLength <= DIRECT_AIFF_MAXIMUM_FILE_BYTES;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function emptyPreparation(): DirectAiffPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
