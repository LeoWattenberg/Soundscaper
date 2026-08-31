/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BextMetadata } from '../broadcast-wave.ts';
import type { CartMetadataInput } from '../cart-metadata.ts';
import type { IxmlMetadataInput } from '../ixml.ts';
import type { RiffMarkerInput } from '../riff-markers.ts';
import { inspectWavLayout } from '../wav.js';
import { directAudioRenderStrategy } from './direct-audio-render-plan.ts';
import { isCanonicalBextV2, sameCanonicalBext } from './direct-broadcast-wave-export.ts';
import {
	DIRECT_PCM_MAXIMUM_FILE_BYTES,
	openDirectPcmDestination,
	type DirectPcmPreparation,
} from './direct-pcm-export.ts';

export const DIRECT_BWF_MAXIMUM_FILE_BYTES = DIRECT_PCM_MAXIMUM_FILE_BYTES;

const BWF_CONTAINER_LABEL = 'BWF';
const BWF_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'Broadcast WAV (BWF) audio',
	accept: Object.freeze({ 'audio/wav': Object.freeze(['.wav']) }),
})]);
interface DirectBwfEncoding {
	readonly bext?: unknown;
	readonly bitDepth?: unknown;
	readonly floatingPoint?: unknown;
	readonly sampleFormat?: unknown;
}

interface DirectBwfPlan {
	readonly adm?: unknown;
	readonly bext?: unknown;
	readonly cart?: CartMetadataInput | null;
	readonly channelCount?: number;
	readonly container?: unknown;
	readonly encoding?: DirectBwfEncoding;
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

interface DirectBwfRequestedSettings extends Readonly<Record<string, unknown>> {
	readonly measureLoudness?: unknown;
}

export async function prepareDirectBwfDestination(
	fileService: Readonly<{
		prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}>,
	plan: DirectBwfPlan,
	requestedSettings: DirectBwfRequestedSettings | null | undefined,
	signal: AbortSignal,
): Promise<DirectPcmPreparation> {
	const directPlan = directBwfPlan(plan);
	if (plan.render?.strategy === 'realtime-stream'
		&& requestedSettings?.measureLoudness === true) {
		throw new Error('Realtime Broadcast WAV loudness measurement is not supported.');
	}
	if (!directPlan || typeof fileService.prepareSave !== 'function') {
		return emptyPreparation();
	}
	const fileName = String((plan.outputs as readonly Readonly<{ fileName?: unknown }>[])[0]?.fileName || 'mix.wav');
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio-pcm-mix',
		suggestedName: fileName,
		mimeType: 'audio/wav',
		target: settings.saveTarget,
		types: BWF_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	return openDirectPcmDestination(
		prepared,
		plan.outputFileBytesPerRender as number,
		BWF_CONTAINER_LABEL,
	);
}

function directBwfPlan(plan: DirectBwfPlan): plan is DirectBwfPlan & {
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly [Readonly<{ readonly fileName?: unknown }>];
} {
	const encoding = plan?.encoding;
	const bitDepth = encoding?.bitDepth;
	if (plan?.format !== 'bwf'
		|| plan.mimeType !== 'audio/wav'
		|| plan.mode !== 'mix'
		|| directAudioRenderStrategy(plan) === null
		|| plan.container !== undefined
		|| plan.adm !== undefined
		|| plan.preDataChunks !== undefined
		|| plan.trailingChunks !== undefined
		|| !Number.isSafeInteger(plan.sampleRate)
		|| Number(plan.sampleRate) <= 0
		|| !Number.isSafeInteger(plan.channelCount)
		|| Number(plan.channelCount) <= 0
		|| Number(plan.channelCount) > 32
		|| !Number.isSafeInteger(plan.outputFrames)
		|| Number(plan.outputFrames) < 0
		|| !isRecord(plan.metadata)
		|| !Array.isArray(plan.markers)
		|| !isOptionalRecord(plan.ixml)
		|| !isOptionalRecord(plan.cart)
		|| !Array.isArray(plan.outputs)
		|| plan.outputs.length !== 1
		|| typeof plan.outputs[0]?.fileName !== 'string'
		|| !plan.outputs[0].fileName.toLowerCase().endsWith('.wav')
		|| !Number.isSafeInteger(plan.outputFileBytesPerRender)
		|| Number(plan.outputFileBytesPerRender) <= 0
		|| Number(plan.outputFileBytesPerRender) > DIRECT_BWF_MAXIMUM_FILE_BYTES
		|| (bitDepth !== 16 && bitDepth !== 20 && bitDepth !== 24)
		|| encoding?.floatingPoint !== false
		|| encoding.sampleFormat !== `int${String(bitDepth)}`
		|| !isCanonicalBextV2(plan.bext)
		|| !isCanonicalBextV2(encoding.bext)
		|| !sameCanonicalBext(plan.bext, encoding.bext)) return false;
	return hasExactWavLayout(plan, bitDepth, plan.bext);
}

function hasExactWavLayout(
	plan: DirectBwfPlan,
	bitDepth: 16 | 20 | 24,
	bext: BextMetadata,
): boolean {
	try {
		const layout = inspectWavLayout({
			container: 'auto',
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: false,
			metadata: plan.metadata,
			markers: plan.markers,
			ixml: plan.ixml,
			cart: plan.cart,
			bext,
		});
		return (layout.container === 'riff' || layout.container === 'rf64')
			&& layout.byteLength === plan.outputFileBytesPerRender
			&& layout.byteLength <= DIRECT_BWF_MAXIMUM_FILE_BYTES;
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

function emptyPreparation(): DirectPcmPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
