/* SPDX-License-Identifier: AGPL-3.0-only */

import type { IxmlMetadataInput } from '../ixml.ts';
import type { RiffMarkerInput } from '../riff-markers.ts';
import { inspectWavLayout } from '../wav.js';
import {
	commitDirectPcmDestination,
	createDirectPcmEncoder,
	DIRECT_PCM_MAXIMUM_FILE_BYTES,
	directPcmMaximumPendingChunks,
	directPcmRenderQueueOptions,
	openDirectPcmDestination,
	type DirectPcmContainerEncoder,
	type DirectPcmDestination,
	type DirectPcmEncoder,
	type DirectPcmPreparation,
} from './direct-pcm-export.ts';

export {
	DIRECT_PCM_DESTINATION_WRITE_BYTES as DIRECT_WAV_DESTINATION_WRITE_BYTES,
	DIRECT_PCM_MAXIMUM_PENDING_BYTES as DIRECT_WAV_MAXIMUM_PENDING_PCM_BYTES,
	DIRECT_PCM_RENDER_CHUNK_FRAMES as DIRECT_WAV_RENDER_CHUNK_FRAMES,
} from './direct-pcm-export.ts';

export const DIRECT_WAV_MAXIMUM_FILE_BYTES = DIRECT_PCM_MAXIMUM_FILE_BYTES;

const WAV_CONTAINER_LABEL = 'WAV';
const WAV_MAXIMUM_SAMPLE_RATE = 0xffff_ffff;
const WAV_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'WAV audio',
	accept: Object.freeze({ 'audio/wav': Object.freeze(['.wav']) }),
})]);

type DirectWavSampleFormat = 'int16' | 'int20' | 'int24' | 'float32';

interface DirectWavEncoding {
	readonly bitDepth?: unknown;
	readonly floatingPoint?: unknown;
	readonly sampleFormat?: unknown;
}

interface DirectWavPlan {
	readonly adm?: unknown;
	readonly bext?: unknown;
	readonly cart?: unknown;
	readonly channelCount?: number;
	readonly container?: unknown;
	readonly encoding?: DirectWavEncoding;
	readonly format?: unknown;
	readonly ixml?: IxmlMetadataInput | null;
	readonly markers?: readonly RiffMarkerInput[];
	readonly metadata?: Readonly<Record<string, unknown>>;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputFrames?: number;
	readonly outputs?: unknown;
	readonly preDataChunks?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
	readonly sampleRate?: number;
	readonly trailingChunks?: unknown;
}

export type DirectWavDestination = DirectPcmDestination;
export type DirectWavEncoder = DirectPcmEncoder;
export type DirectWavPreparation = DirectPcmPreparation;

export function directWavMaximumPendingChunks(channelCount: number): number {
	return directPcmMaximumPendingChunks(channelCount, WAV_CONTAINER_LABEL);
}

export function directWavRenderQueueOptions(channelCount: number): Readonly<{
	chunkFrames: number;
	maximumPendingChunks: number;
	backpressureHighWaterChunks: number;
}> {
	return directPcmRenderQueueOptions(channelCount, WAV_CONTAINER_LABEL);
}

export async function prepareDirectWavDestination(
	fileService: Readonly<{
		prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}>,
	plan: DirectWavPlan,
	requestedSettings: Readonly<Record<string, unknown>> | null | undefined,
	signal: AbortSignal,
): Promise<DirectWavPreparation> {
	if (!directWavPlan(plan) || typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const fileName = String((plan.outputs as readonly Readonly<{ fileName?: unknown }>[])[0]?.fileName || 'mix.wav');
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio-pcm-mix',
		suggestedName: fileName,
		mimeType: String(plan.mimeType || 'audio/wav'),
		target: settings.saveTarget,
		types: WAV_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	return openDirectPcmDestination(
		prepared,
		plan.outputFileBytesPerRender as number,
		WAV_CONTAINER_LABEL,
	);
}

export function createDirectWavEncoder(
	destination: DirectWavDestination,
	createEncoder: (options: Readonly<Record<string, unknown>>) => DirectPcmContainerEncoder,
	options: Readonly<Record<string, unknown>>,
): Promise<DirectWavEncoder> {
	return createDirectPcmEncoder(destination, createEncoder, options, WAV_CONTAINER_LABEL);
}

export function commitDirectWavDestination(
	destination: DirectWavDestination,
	plannedByteLength: number,
	encodedByteLength: number,
	assertReadyToCommit: () => void,
): Promise<Readonly<Record<string, unknown>>> {
	return commitDirectPcmDestination(
		destination,
		plannedByteLength,
		encodedByteLength,
		assertReadyToCommit,
		WAV_CONTAINER_LABEL,
	);
}

function directWavPlan(plan: DirectWavPlan): plan is DirectWavPlan & {
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly [Readonly<{ readonly fileName?: unknown }>];
} {
	const sampleFormat = canonicalWavSampleFormat(plan?.encoding);
	if (plan?.format !== 'wav'
		|| plan.mimeType !== 'audio/wav'
		|| plan.mode !== 'mix'
		|| plan.render?.strategy !== 'realtime-stream'
		|| plan.container !== undefined
		|| plan.bext !== undefined
		|| plan.adm !== undefined
		|| plan.preDataChunks !== undefined
		|| plan.trailingChunks !== undefined
		|| plan.cart !== null
		|| !Number.isSafeInteger(plan.sampleRate)
		|| Number(plan.sampleRate) <= 0
		|| Number(plan.sampleRate) > WAV_MAXIMUM_SAMPLE_RATE
		|| !Number.isSafeInteger(plan.channelCount)
		|| Number(plan.channelCount) <= 0
		|| Number(plan.channelCount) > 32
		|| !Number.isSafeInteger(plan.outputFrames)
		|| Number(plan.outputFrames) < 0
		|| !isRecord(plan.metadata)
		|| !Array.isArray(plan.markers)
		|| !isOptionalRecord(plan.ixml)
		|| sampleFormat === null
		|| !Array.isArray(plan.outputs)
		|| plan.outputs.length !== 1
		|| typeof plan.outputs[0]?.fileName !== 'string'
		|| !plan.outputs[0].fileName.toLowerCase().endsWith('.wav')
		|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
		|| Number(plan.outputFileBytesPerRender) <= 0
		|| Number(plan.outputFileBytesPerRender) > DIRECT_WAV_MAXIMUM_FILE_BYTES) return false;
	return hasExactWavLayout(plan, sampleFormat);
}

function canonicalWavSampleFormat(encoding: DirectWavEncoding | undefined): DirectWavSampleFormat | null {
	if (!isRecord(encoding)) return null;
	if (encoding.sampleFormat === 'int16'
		&& encoding.bitDepth === 16
		&& encoding.floatingPoint === false) return 'int16';
	if (encoding.sampleFormat === 'int20'
		&& encoding.bitDepth === 20
		&& encoding.floatingPoint === false) return 'int20';
	if (encoding.sampleFormat === 'int24'
		&& encoding.bitDepth === 24
		&& encoding.floatingPoint === false) return 'int24';
	if (encoding.sampleFormat === 'float32'
		&& encoding.bitDepth === 32
		&& encoding.floatingPoint === true) return 'float32';
	return null;
}

function hasExactWavLayout(plan: DirectWavPlan, sampleFormat: DirectWavSampleFormat): boolean {
	try {
		const floatingPoint = sampleFormat === 'float32';
		const bitDepth = sampleFormat === 'int16' ? 16 : sampleFormat === 'int20' ? 20
			: sampleFormat === 'int24' ? 24 : 32;
		const layout = inspectWavLayout({
			container: 'auto',
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: floatingPoint,
			metadata: plan.metadata,
			markers: plan.markers,
			ixml: plan.ixml,
		});
		return (layout.container === 'riff' || layout.container === 'rf64')
			&& layout.byteLength === plan.outputFileBytesPerRender
			&& layout.byteLength <= DIRECT_WAV_MAXIMUM_FILE_BYTES;
	} catch {
		return false;
	}
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalRecord(value: unknown): value is Readonly<Record<string, unknown>> | null {
	return value === null || isRecord(value);
}

function emptyPreparation(): DirectWavPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
