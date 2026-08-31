/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admBedChannelOrder,
	validateAdmProjectMetadata,
	type AdmAuthoredMetadata,
	type AdmBedLayout,
	type AdmPassthroughMetadata,
} from '../adm-project-metadata.ts';
import {
	inspectPreservedAdmRiffChunks,
	splitAdmRiffChunkSequence,
	validateAdmPassthroughPayload,
	validateAdmRiffChunkSequence,
	type PreservedAdmRiffKinds,
} from '../adm-riff-passthrough.ts';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../adm-metadata.ts';
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

export const DIRECT_BW64_MAXIMUM_FILE_BYTES = DIRECT_PCM_MAXIMUM_FILE_BYTES;

const BW64_CONTAINER_LABEL = 'BW64';
const BW64_FILE_TYPES = Object.freeze([Object.freeze({
	description: 'BW64 / ADM audio',
	accept: Object.freeze({ 'audio/wav': Object.freeze(['.wav']) }),
})]);
const ADM_PLAN_FIELDS = Object.freeze([
	'mode',
	'metadata',
	'channelCount',
	'channelOrder',
	'preDataChunks',
	'trailingChunks',
] as const);

interface DirectBw64Encoding {
	readonly bext?: unknown;
	readonly bitDepth?: unknown;
	readonly channelCount?: unknown;
	readonly channelMapping?: unknown;
	readonly dither?: unknown;
	readonly floatingPoint?: unknown;
	readonly inputChannelCount?: unknown;
	readonly sampleRate?: unknown;
	readonly sampleFormat?: unknown;
}

interface DirectBw64AdmPlan {
	readonly mode?: unknown;
	readonly metadata?: unknown;
	readonly channelCount?: number;
	readonly channelOrder?: unknown;
	readonly preDataChunks?: unknown;
	readonly trailingChunks?: unknown;
}

interface DirectBw64Plan {
	readonly adm?: unknown;
	readonly bext?: unknown;
	readonly cart?: CartMetadataInput | null;
	readonly channelCount?: unknown;
	readonly channelMapping?: unknown;
	readonly container?: unknown;
	readonly dither?: unknown;
	readonly ditherMode?: unknown;
	readonly encoding?: DirectBw64Encoding;
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
	readonly range?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
	readonly sampleRate?: number;
	readonly tailFrames?: unknown;
	readonly trailingChunks?: unknown;
}

type DirectRiffChunks = Uint8Array | readonly Uint8Array[] | undefined;

interface CanonicalPassthroughAdmPlan {
	readonly adm: DirectBw64AdmPlan & {
		readonly mode: 'passthrough';
		readonly metadata: AdmPassthroughMetadata;
		readonly channelCount: number;
		readonly channelOrder: readonly string[];
	};
	readonly metadata: AdmPassthroughMetadata;
	readonly preDataChunks: DirectRiffChunks;
	readonly preserved: PreservedAdmRiffKinds;
	readonly trailingChunks: DirectRiffChunks;
}

interface DirectBw64RequestedSettings extends Readonly<Record<string, unknown>> {
	readonly measureLoudness?: unknown;
}

export async function prepareDirectBw64Destination(
	fileService: Readonly<{
		prepareSave?: (request: Readonly<Record<string, unknown>>) => PromiseLike<unknown> | unknown;
	}>,
	plan: Readonly<Record<string, unknown>>,
	requestedSettings: DirectBw64RequestedSettings | null | undefined,
	signal: AbortSignal,
): Promise<DirectPcmPreparation> {
	const candidate = plan as DirectBw64Plan;
	if (requestedSettings?.measureLoudness === true) {
		const passthrough = canonicalPassthroughAdmPlan(candidate.adm);
		if (candidate.render?.strategy === 'realtime-stream') {
			throw new Error('Realtime BW64 loudness measurement is not supported.');
		}
		if (passthrough?.preserved.bext === true) {
			throw new Error('Preserved-BEXT BW64 loudness measurement is not supported.');
		}
	}
	if (!directBw64Plan(plan)) return emptyPreparation();
	if (typeof fileService.prepareSave !== 'function') return emptyPreparation();
	const fileName = String(plan.outputs[0].fileName || 'mix.wav');
	const settings = requestedSettings || {};
	const prepared = await fileService.prepareSave({
		purpose: 'audio-pcm-mix',
		suggestedName: fileName,
		mimeType: 'audio/wav',
		target: settings.saveTarget,
		types: BW64_FILE_TYPES,
		useFileSystemAccess: settings.useFileSystemAccess !== false,
		signal,
	});
	return openDirectPcmDestination(
		prepared,
		plan.outputFileBytesPerRender,
		BW64_CONTAINER_LABEL,
	);
}

function directBw64Plan(value: Readonly<Record<string, unknown>>): value is Readonly<Record<string, unknown>> & DirectBw64Plan & {
	readonly outputFileBytesPerRender: number;
	readonly outputs: readonly [Readonly<{ readonly fileName: string }>];
} {
	const plan = value as DirectBw64Plan;
	const encoding = plan?.encoding;
	const bitDepth = encoding?.bitDepth;
	if (plan?.format !== 'bw64'
		|| plan.mimeType !== 'audio/wav'
		|| plan.mode !== 'mix'
		|| directAudioRenderStrategy(plan) === null
		|| plan.container !== 'bw64'
		|| !Number.isSafeInteger(plan.sampleRate)
		|| Number(plan.sampleRate) <= 0
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
		|| Number(plan.outputFileBytesPerRender) > DIRECT_BW64_MAXIMUM_FILE_BYTES
		|| (bitDepth !== 16 && bitDepth !== 20 && bitDepth !== 24)
		|| encoding?.floatingPoint !== false
		|| encoding.sampleFormat !== `int${String(bitDepth)}`) {
		return false;
	}
	const adm = canonicalAuthoredAdmPlan(plan.adm);
	if (adm) return directAuthoredBw64Plan(plan, encoding, bitDepth, adm);
	const passthrough = canonicalPassthroughAdmPlan(plan.adm);
	return passthrough !== null && directPassthroughBw64Plan(plan, encoding, bitDepth, passthrough);
}

/**
 * The authored bed layouts this route will stream.
 *
 * Deliberately narrower than the layouts an authored bed can carry. This is the
 * direct packaged path, and its acceptance evidence names mono, stereo and 5.1
 * and states that it does not qualify other ADM layouts; an immersive bed
 * renders through the ordinary offline export instead. Deriving the admission
 * from the layout table would have enrolled every new layout here silently, the
 * moment the table grew, with nothing measured behind it.
 */
const DIRECT_BW64_ADMITTED_BED_LAYOUTS: ReadonlySet<AdmBedLayout> = new Set([
	'mono', 'stereo', '5.1',
]);

function directAuthoredBw64Plan(
	plan: DirectBw64Plan,
	encoding: DirectBw64Encoding,
	bitDepth: 16 | 20 | 24,
	adm: NonNullable<ReturnType<typeof canonicalAuthoredAdmPlan>>,
): boolean {
	if (!isCanonicalBextV2(plan.bext)
		|| !isCanonicalBextV2(encoding.bext)
		|| !sameCanonicalBext(plan.bext, encoding.bext)) return false;
	if (!DIRECT_BW64_ADMITTED_BED_LAYOUTS.has(adm.metadata.bed.layout)) return false;
	const channelOrder = admBedChannelOrder(adm.metadata.bed.layout);
	if (plan.channelCount !== channelOrder.length
		|| adm.channelCount !== channelOrder.length
		|| !sameStrings(adm.channelOrder, channelOrder)
		|| !isCanonicalPreserveMapping(plan.channelMapping, channelOrder.length)) return false;
	const preDataChunks = createRiffChnaChunk(createAdmChna({ layout: adm.metadata.bed.layout }));
	const trailingChunks = createRiffAxmlChunk({
		programmeName: adm.metadata.programme.name,
		contentName: adm.metadata.content.name,
		programmeLanguage: adm.metadata.programme.language,
		contentLanguage: adm.metadata.content.language,
		bedName: adm.metadata.bed.name,
		layout: adm.metadata.bed.layout,
	});
	if (!sameBytes(adm.preDataChunks, preDataChunks)
		|| !sameBytes(plan.preDataChunks, preDataChunks)
		|| !sameBytes(adm.trailingChunks, trailingChunks)
		|| !sameBytes(plan.trailingChunks, trailingChunks)) return false;
	return hasExactWavLayout(plan, bitDepth, plan.bext, preDataChunks, trailingChunks);
}

function directPassthroughBw64Plan(
	plan: DirectBw64Plan,
	encoding: DirectBw64Encoding,
	bitDepth: 16 | 20 | 24,
	validated: CanonicalPassthroughAdmPlan,
): boolean {
	const { adm, metadata, preDataChunks, preserved, trailingChunks } = validated;
	const { geometry } = metadata;
	if (plan.sampleRate !== geometry.sampleRate
		|| encoding.sampleRate !== geometry.sampleRate
		|| plan.channelCount !== geometry.channelCount
		|| encoding.channelCount !== geometry.channelCount
		|| encoding.inputChannelCount !== geometry.channelCount
		|| adm.channelCount !== geometry.channelCount
		|| plan.outputFrames !== geometry.frameCount
		|| bitDepth !== geometry.bitDepth
		|| geometry.float !== false
		|| plan.tailFrames !== 0
		|| plan.dither !== false
		|| plan.ditherMode !== 'none'
		|| encoding.dither !== 'none'
		|| !isFullRange(plan.range, geometry.frameCount)
		|| !isCanonicalPreserveMapping(plan.channelMapping, geometry.channelCount)
		|| !isCanonicalPreserveMapping(encoding.channelMapping, geometry.channelCount)
		|| !sameRiffChunks(adm.preDataChunks, preDataChunks)
		|| !sameRiffChunks(plan.preDataChunks, preDataChunks)
		|| !sameRiffChunks(adm.trailingChunks, trailingChunks)
		|| !sameRiffChunks(plan.trailingChunks, trailingChunks)) return false;
	if ((preserved.markers && plan.markers?.length !== 0)
		|| (preserved.ixml && plan.ixml !== null)
		|| (preserved.cart && plan.cart !== null)
		|| ((preserved.id3 || preserved.info) && Object.keys(plan.metadata ?? {}).length !== 0)) return false;
	let bext: BextMetadata | undefined;
	if (preserved.bext) {
		if (Object.hasOwn(plan, 'bext')
			|| Object.hasOwn(encoding, 'bext')
			|| plan.bext !== undefined
			|| encoding.bext !== undefined) return false;
	} else {
		if (!Object.hasOwn(plan, 'bext')
			|| !Object.hasOwn(encoding, 'bext')
			|| !isCanonicalBextV2(plan.bext)
			|| !isCanonicalBextV2(encoding.bext)
			|| !sameCanonicalBext(plan.bext, encoding.bext)) return false;
		bext = plan.bext;
	}
	return hasExactWavLayout(plan, bitDepth, bext, preDataChunks, trailingChunks);
}

function hasExactWavLayout(
	plan: DirectBw64Plan,
	bitDepth: 16 | 20 | 24,
	bext: BextMetadata | undefined,
	preDataChunks: DirectRiffChunks,
	trailingChunks: DirectRiffChunks,
): boolean {
	try {
		const options: Parameters<typeof inspectWavLayout>[0] = {
			container: 'bw64' as const,
			sampleRate: plan.sampleRate,
			channelCount: Number(plan.channelCount),
			totalFrames: plan.outputFrames,
			bitDepth,
			float: false,
			metadata: plan.metadata,
			markers: plan.markers,
			ixml: plan.ixml,
			cart: plan.cart,
			bext,
			preDataChunks,
			trailingChunks,
		};
		const layout = inspectWavLayout(options);
		return layout.container === 'bw64'
			&& layout.byteLength === plan.outputFileBytesPerRender
			&& layout.byteLength <= DIRECT_BW64_MAXIMUM_FILE_BYTES;
	} catch {
		return false;
	}
}

function canonicalPassthroughAdmPlan(value: unknown): CanonicalPassthroughAdmPlan | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as DirectBw64AdmPlan;
	if (candidate.mode !== 'passthrough'
		|| Object.keys(candidate).length !== ADM_PLAN_FIELDS.length
		|| !ADM_PLAN_FIELDS.every((field) => Object.hasOwn(candidate, field))
		|| !candidate.metadata
		|| typeof candidate.metadata !== 'object'
		|| Array.isArray(candidate.metadata)) return null;
	try {
		validateAdmProjectMetadata({ adm: candidate.metadata });
	} catch {
		return null;
	}
	const metadata = candidate.metadata as AdmPassthroughMetadata;
	if (metadata.mode !== 'passthrough'
		|| metadata.valid !== true
		|| metadata.warnings.length !== 0
		|| !metadata.riffChunkSequence?.length
		|| !Number.isSafeInteger(candidate.channelCount)
		|| !Array.isArray(candidate.channelOrder)) return null;
	let channelOrder: readonly string[];
	let split: ReturnType<typeof splitAdmRiffChunkSequence>;
	try {
		channelOrder = validateAdmPassthroughPayload(metadata);
		validateAdmRiffChunkSequence(metadata);
		split = splitAdmRiffChunkSequence(metadata);
	} catch {
		return null;
	}
	const preDataChunks = compactRiffChunks(split.preDataChunks);
	const trailingChunks = compactRiffChunks(split.trailingChunks);
	if (!sameStrings(candidate.channelOrder, channelOrder)
		|| !sameRiffChunks(candidate.preDataChunks, preDataChunks)
		|| !sameRiffChunks(candidate.trailingChunks, trailingChunks)) return null;
	return Object.freeze({
		adm: candidate as CanonicalPassthroughAdmPlan['adm'],
		metadata,
		preDataChunks,
		preserved: inspectPreservedAdmRiffChunks(metadata),
		trailingChunks,
	});
}

function canonicalAuthoredAdmPlan(value: unknown): (DirectBw64AdmPlan & {
	readonly mode: 'authored';
	readonly metadata: AdmAuthoredMetadata;
	readonly channelCount: number;
	readonly channelOrder: readonly string[];
	readonly preDataChunks: Uint8Array;
	readonly trailingChunks: Uint8Array;
}) | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as DirectBw64AdmPlan;
	if (candidate.mode !== 'authored'
		|| Object.keys(candidate).length !== ADM_PLAN_FIELDS.length
		|| !ADM_PLAN_FIELDS.every((field) => Object.hasOwn(candidate, field))
		|| !candidate.metadata
		|| typeof candidate.metadata !== 'object'
		|| Array.isArray(candidate.metadata)) {
		return null;
	}
	try {
		validateAdmProjectMetadata({ adm: candidate.metadata });
	} catch {
		return null;
	}
	const metadata = candidate.metadata as AdmAuthoredMetadata;
	if (metadata.mode !== 'authored'
		|| !Number.isSafeInteger(candidate.channelCount)
		|| !Array.isArray(candidate.channelOrder)
		|| !(candidate.preDataChunks instanceof Uint8Array)
		|| !(candidate.trailingChunks instanceof Uint8Array)) {
		return null;
	}
	return candidate as DirectBw64AdmPlan & {
		readonly mode: 'authored';
		readonly metadata: AdmAuthoredMetadata;
		readonly channelCount: number;
		readonly channelOrder: readonly string[];
		readonly preDataChunks: Uint8Array;
		readonly trailingChunks: Uint8Array;
	};
}

function isCanonicalPreserveMapping(value: unknown, channelCount: number): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const mapping = value as Readonly<Record<string, unknown>>;
	if (!sameKeys(mapping, ['inputChannelCount', 'outputChannelCount', 'mode', 'channels'])
		|| mapping.inputChannelCount !== channelCount
		|| mapping.outputChannelCount !== channelCount
		|| mapping.mode !== 'preserve'
		|| !Array.isArray(mapping.channels)
		|| mapping.channels.length !== channelCount) {
		return false;
	}
	return mapping.channels.every((channel, index) => {
		if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return false;
		const output = channel as Readonly<Record<string, unknown>>;
		if (!sameKeys(output, ['inputs']) || !Array.isArray(output.inputs) || output.inputs.length !== 1) return false;
		const input = output.inputs[0];
		if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
		const contribution = input as Readonly<Record<string, unknown>>;
		return sameKeys(contribution, ['channel', 'gain'])
			&& contribution.channel === index
			&& contribution.gain === 1;
	});
}

function isFullRange(value: unknown, frameCount: number): boolean {
	if (!isRecord(value) || !sameKeys(value, ['startFrame', 'endFrame', 'durationFrames'])) return false;
	return value.startFrame === 0
		&& value.endFrame === frameCount
		&& value.durationFrames === frameCount;
}

function compactRiffChunks(chunks: readonly Uint8Array[]): DirectRiffChunks {
	if (chunks.length === 0) return undefined;
	return chunks.length === 1 ? chunks[0] : chunks;
}

function sameRiffChunks(value: unknown, expected: DirectRiffChunks): boolean {
	if (expected === undefined) return value === undefined;
	if (expected instanceof Uint8Array) return sameBytes(value, expected);
	return Array.isArray(value)
		&& value.length === expected.length
		&& value.every((chunk, index) => {
			const expectedChunk = expected[index];
			return expectedChunk !== undefined && sameBytes(chunk, expectedChunk);
		});
}

function sameKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const expected = [...keys].sort();
	return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalRecord(value: unknown): value is Readonly<Record<string, unknown>> | null {
	return value === null || isRecord(value);
}

function sameStrings(value: unknown, expected: readonly string[]): boolean {
	return Array.isArray(value)
		&& value.length === expected.length
		&& value.every((item, index) => item === expected[index]);
}

function sameBytes(value: unknown, expected: Uint8Array): boolean {
	return value instanceof Uint8Array
		&& value.byteLength === expected.byteLength
		&& value.every((byte, index) => byte === expected[index]);
}

function emptyPreparation(): DirectPcmPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
