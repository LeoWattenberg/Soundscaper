/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	admBedChannelOrder,
	validateAdmProjectMetadata,
	type AdmAuthoredMetadata,
} from '../adm-project-metadata.ts';
import { createAdmChna, createRiffAxmlChunk, createRiffChnaChunk } from '../adm-metadata.ts';
import type { CartMetadataInput } from '../cart-metadata.ts';
import type { IxmlMetadataInput } from '../ixml.ts';
import type { RiffMarkerInput } from '../riff-markers.ts';
import { inspectWavLayout } from '../wav.js';
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
	readonly floatingPoint?: unknown;
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
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
	readonly sampleRate?: number;
	readonly trailingChunks?: unknown;
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
	if (!directBw64Plan(plan)) return emptyPreparation();
	if (requestedSettings?.measureLoudness === true) {
		throw new Error('Realtime BW64 loudness measurement is not supported.');
	}
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
		|| plan.render?.strategy !== 'realtime-stream'
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
		|| encoding.sampleFormat !== `int${String(bitDepth)}`
		|| !isCanonicalBextV2(plan.bext)
		|| !isCanonicalBextV2(encoding.bext)
		|| !sameCanonicalBext(plan.bext, encoding.bext)) {
		return false;
	}
	const adm = canonicalAuthoredAdmPlan(plan.adm);
	if (!adm) return false;
	const channelOrder = admBedChannelOrder(adm.metadata.bed.layout);
	if (plan.channelCount !== channelOrder.length
		|| adm.channelCount !== channelOrder.length
		|| !sameStrings(adm.channelOrder, channelOrder)
		|| !isCanonicalPreserveMapping(plan.channelMapping, channelOrder.length)) {
		return false;
	}
	const canonicalChna = createRiffChnaChunk(createAdmChna({ layout: adm.metadata.bed.layout }));
	const canonicalAxml = createRiffAxmlChunk({
		programmeName: adm.metadata.programme.name,
		contentName: adm.metadata.content.name,
		programmeLanguage: adm.metadata.programme.language,
		contentLanguage: adm.metadata.content.language,
		bedName: adm.metadata.bed.name,
		layout: adm.metadata.bed.layout,
	});
	if (!sameBytes(adm.preDataChunks, canonicalChna)
		|| !sameBytes(plan.preDataChunks, canonicalChna)
		|| !sameBytes(adm.trailingChunks, canonicalAxml)
		|| !sameBytes(plan.trailingChunks, canonicalAxml)) {
		return false;
	}
	try {
		const options: Parameters<typeof inspectWavLayout>[0] = {
			container: 'bw64' as const,
			sampleRate: plan.sampleRate,
			channelCount: plan.channelCount,
			totalFrames: plan.outputFrames,
			bitDepth,
			float: false,
			metadata: plan.metadata,
			markers: plan.markers,
			ixml: plan.ixml,
			cart: plan.cart,
			bext: plan.bext,
			preDataChunks: canonicalChna,
			trailingChunks: canonicalAxml,
		};
		const layout = inspectWavLayout(options);
		return layout.container === 'bw64'
			&& layout.byteLength === plan.outputFileBytesPerRender
			&& layout.byteLength <= DIRECT_BW64_MAXIMUM_FILE_BYTES;
	} catch {
		return false;
	}
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
