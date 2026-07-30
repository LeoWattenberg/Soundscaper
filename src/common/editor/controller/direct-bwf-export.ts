/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeBextMetadata,
	type BextMetadata,
	type BextMetadataInput,
} from '../broadcast-wave.ts';
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
const BEXT_FIELDS = Object.freeze([
	'description',
	'originator',
	'originatorReference',
	'originationDate',
	'originationTime',
	'timeReference',
	'version',
	'umid',
	'loudnessValue',
	'loudnessRange',
	'maxTruePeakLevel',
	'maxMomentaryLoudness',
	'maxShortTermLoudness',
	'codingHistory',
] as const satisfies readonly (keyof BextMetadata)[]);

interface DirectBwfEncoding {
	readonly bext?: unknown;
	readonly bitDepth?: unknown;
	readonly floatingPoint?: unknown;
	readonly sampleFormat?: unknown;
}

interface DirectBwfPlan {
	readonly adm?: unknown;
	readonly bext?: unknown;
	readonly container?: unknown;
	readonly encoding?: DirectBwfEncoding;
	readonly format?: unknown;
	readonly mimeType?: unknown;
	readonly mode?: unknown;
	readonly outputFileBytesPerRender?: unknown;
	readonly outputs?: unknown;
	readonly preDataChunks?: unknown;
	readonly render?: Readonly<{ readonly strategy?: unknown }>;
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
	if (directPlan && requestedSettings?.measureLoudness === true) {
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
	return plan?.format === 'bwf'
		&& plan.mimeType === 'audio/wav'
		&& plan.mode === 'mix'
		&& plan.render?.strategy === 'realtime-stream'
		&& plan.container === undefined
		&& plan.adm === undefined
		&& plan.preDataChunks === undefined
		&& plan.trailingChunks === undefined
		&& Array.isArray(plan.outputs)
		&& plan.outputs.length === 1
		&& typeof plan.outputs[0]?.fileName === 'string'
		&& plan.outputs[0].fileName.toLowerCase().endsWith('.wav')
		&& Number.isSafeInteger(plan.outputFileBytesPerRender)
		&& Number(plan.outputFileBytesPerRender) > 0
		&& Number(plan.outputFileBytesPerRender) <= DIRECT_BWF_MAXIMUM_FILE_BYTES
		&& (bitDepth === 16 || bitDepth === 20 || bitDepth === 24)
		&& encoding?.floatingPoint === false
		&& encoding.sampleFormat === `int${String(bitDepth)}`
		&& isNormalizedBext(plan.bext)
		&& isNormalizedBext(encoding.bext)
		&& sameBext(plan.bext, encoding.bext);
}

function isNormalizedBext(value: unknown): value is BextMetadata {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const candidate = value as Readonly<Record<string, unknown>>;
	if (Object.keys(candidate).length !== BEXT_FIELDS.length) return false;
	let normalized: BextMetadata;
	try {
		normalized = normalizeBextMetadata(candidate as BextMetadataInput, { version: 2 });
	} catch {
		return false;
	}
	return BEXT_FIELDS.every((field) => (
		Object.hasOwn(candidate, field)
		&& Object.is(candidate[field], normalized[field])
	));
}

function sameBext(left: BextMetadata, right: BextMetadata): boolean {
	return BEXT_FIELDS.every((field) => Object.is(left[field], right[field]));
}

function emptyPreparation(): DirectPcmPreparation {
	return Object.freeze({ cancelled: null, destination: null });
}
