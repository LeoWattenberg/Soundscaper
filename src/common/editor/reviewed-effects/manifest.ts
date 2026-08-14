/* SPDX-License-Identifier: AGPL-3.0-only */

import { reviewedEffectError } from './errors.ts';

export const REVIEWED_EFFECT_MANIFEST_SCHEMA = 'soundscaper-reviewed-effect/v1' as const;
export const REVIEWED_EFFECT_ABI_SCHEMA = 'soundscaper-planar-f32/v1' as const;
export const REVIEWED_EFFECT_ABI_VERSION = 1;
export const REVIEWED_EFFECT_PROCESS_EXPORT = 'soundscaper_effect_process' as const;
export const REVIEWED_EFFECT_MEMORY_EXPORT = 'memory' as const;
export const REVIEWED_EFFECT_VERSION_EXPORT = 'soundscaper_effect_abi_version' as const;
export const REVIEWED_EFFECT_LATENCY_EXPORT = 'soundscaper_effect_latency_frames' as const;
export const REVIEWED_EFFECT_TAIL_EXPORT = 'soundscaper_effect_tail_frames' as const;

const MAXIMUM_PARAMETERS = 32;
const ROOT_KEYS = new Set([
	'schema',
	'id',
	'version',
	'displayName',
	'abi',
	'parameters',
	'resources',
	'latencyFrames',
	'tailFrames',
]);
const ABI_KEYS = new Set([
	'schema',
	'version',
	'inputLayout',
	'sampleFormat',
	'processExport',
	'memoryExport',
	'versionExport',
	'latencyFramesExport',
	'tailFramesExport',
]);
const PARAMETER_KEYS = new Set(['id', 'index', 'defaultValue', 'minimum', 'maximum']);
const RESOURCE_KEYS = new Set([
	'maximumModuleBytes',
	'maximumMemoryPages',
	'maximumChannels',
	'maximumBlockFrames',
	'maximumInputBytes',
	'maximumOutputBytes',
	'processingTimeoutMs',
]);
const IDENTIFIER_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/u;

export interface ReviewedEffectAbiManifest {
	readonly schema: typeof REVIEWED_EFFECT_ABI_SCHEMA;
	readonly version: typeof REVIEWED_EFFECT_ABI_VERSION;
	readonly inputLayout: 'planar';
	readonly sampleFormat: 'f32';
	readonly processExport: typeof REVIEWED_EFFECT_PROCESS_EXPORT;
	readonly memoryExport: typeof REVIEWED_EFFECT_MEMORY_EXPORT;
	readonly versionExport: typeof REVIEWED_EFFECT_VERSION_EXPORT;
	readonly latencyFramesExport: typeof REVIEWED_EFFECT_LATENCY_EXPORT;
	readonly tailFramesExport: typeof REVIEWED_EFFECT_TAIL_EXPORT;
}

export interface ReviewedEffectParameterManifest {
	readonly id: string;
	readonly index: number;
	readonly defaultValue: number;
	readonly minimum: number;
	readonly maximum: number;
}

export interface ReviewedEffectResourceManifest {
	readonly maximumModuleBytes: number;
	readonly maximumMemoryPages: number;
	readonly maximumChannels: number;
	readonly maximumBlockFrames: number;
	readonly maximumInputBytes: number;
	readonly maximumOutputBytes: number;
	readonly processingTimeoutMs: number;
}

export interface ReviewedEffectManifest {
	readonly schema: typeof REVIEWED_EFFECT_MANIFEST_SCHEMA;
	readonly id: string;
	readonly version: string;
	readonly displayName: string;
	readonly abi: ReviewedEffectAbiManifest;
	readonly parameters: readonly ReviewedEffectParameterManifest[];
	readonly resources: ReviewedEffectResourceManifest;
	readonly latencyFrames: number;
	readonly tailFrames: number;
}

/** Validate the closed v1 package manifest and return an immutable data-only copy. */
export function defineReviewedEffectManifest(value: unknown): ReviewedEffectManifest {
	try {
		const root = closedRecord(value, ROOT_KEYS, 'reviewed effect manifest');
		const id = boundedIdentifier(root.id, 'package id', 128);
		const version = boundedVersion(root.version);
		const displayName = boundedText(root.displayName, 'package display name', 96);
		if (root.schema !== REVIEWED_EFFECT_MANIFEST_SCHEMA) {
			throw new RangeError(`Manifest schema must be ${REVIEWED_EFFECT_MANIFEST_SCHEMA}.`);
		}
		const abi = normalizeAbi(root.abi);
		const parameters = normalizeParameters(root.parameters);
		const resources = normalizeResources(root.resources, parameters.length);
		return Object.freeze({
			schema: REVIEWED_EFFECT_MANIFEST_SCHEMA,
			id,
			version,
			displayName,
			abi,
			parameters,
			resources,
			latencyFrames: boundedInteger(root.latencyFrames, 'latencyFrames', 0, 0x7fff_ffff),
			tailFrames: boundedInteger(root.tailFrames, 'tailFrames', 0, 0x7fff_ffff),
		});
	} catch (error) {
		if (error instanceof Error && error.name === 'ReviewedEffectError') throw error;
		throw reviewedEffectError(
			'MANIFEST_INVALID',
			error instanceof Error ? error.message : 'The reviewed effect manifest is invalid.',
			error,
		);
	}
}

export function normalizeReviewedEffectPackageReference(
	value: unknown,
): Readonly<{ id: string; version: string }> {
	try {
		const reference = closedRecord(value, new Set(['id', 'version']), 'reviewed effect package reference');
		return Object.freeze({
			id: boundedIdentifier(reference.id, 'package id', 128),
			version: boundedVersion(reference.version),
		});
	} catch (error) {
		throw reviewedEffectError(
			'MANIFEST_INVALID',
			error instanceof Error ? error.message : 'The reviewed effect package reference is invalid.',
			error,
		);
	}
}

export function reviewedEffectPackageKey(reference: Readonly<{ id: string; version: string }>): string {
	return `${reference.id}@${reference.version}`;
}

function normalizeAbi(value: unknown): ReviewedEffectAbiManifest {
	const abi = closedRecord(value, ABI_KEYS, 'reviewed effect ABI');
	if (abi.schema !== REVIEWED_EFFECT_ABI_SCHEMA
		|| abi.version !== REVIEWED_EFFECT_ABI_VERSION
		|| abi.inputLayout !== 'planar'
		|| abi.sampleFormat !== 'f32'
		|| abi.processExport !== REVIEWED_EFFECT_PROCESS_EXPORT
		|| abi.memoryExport !== REVIEWED_EFFECT_MEMORY_EXPORT
		|| abi.versionExport !== REVIEWED_EFFECT_VERSION_EXPORT
		|| abi.latencyFramesExport !== REVIEWED_EFFECT_LATENCY_EXPORT
		|| abi.tailFramesExport !== REVIEWED_EFFECT_TAIL_EXPORT) {
		throw new RangeError('The reviewed effect ABI declaration is unsupported.');
	}
	return Object.freeze({
		schema: REVIEWED_EFFECT_ABI_SCHEMA,
		version: REVIEWED_EFFECT_ABI_VERSION,
		inputLayout: 'planar',
		sampleFormat: 'f32',
		processExport: REVIEWED_EFFECT_PROCESS_EXPORT,
		memoryExport: REVIEWED_EFFECT_MEMORY_EXPORT,
		versionExport: REVIEWED_EFFECT_VERSION_EXPORT,
		latencyFramesExport: REVIEWED_EFFECT_LATENCY_EXPORT,
		tailFramesExport: REVIEWED_EFFECT_TAIL_EXPORT,
	});
}

function normalizeParameters(value: unknown): readonly ReviewedEffectParameterManifest[] {
	if (!Array.isArray(value) || value.length > MAXIMUM_PARAMETERS) {
		throw new RangeError(`Reviewed effects support at most ${String(MAXIMUM_PARAMETERS)} parameters.`);
	}
	const identifiers = new Set<string>();
	const parameters = value.map((candidate, index) => {
		const parameter = closedRecord(candidate, PARAMETER_KEYS, `reviewed effect parameter ${String(index)}`);
		const id = boundedIdentifier(parameter.id, `parameter ${String(index)} id`, 64);
		if (identifiers.has(id)) throw new RangeError(`Duplicate reviewed effect parameter id: ${id}.`);
		identifiers.add(id);
		const parameterIndex = boundedInteger(parameter.index, `${id} index`, 0, MAXIMUM_PARAMETERS - 1);
		if (parameterIndex !== index) throw new RangeError('Reviewed effect parameter indexes must be contiguous and ordered.');
		const minimum = finiteNumber(parameter.minimum, `${id} minimum`);
		const maximum = finiteNumber(parameter.maximum, `${id} maximum`);
		const defaultValue = finiteNumber(parameter.defaultValue, `${id} defaultValue`);
		if (!(maximum > minimum) || defaultValue < minimum || defaultValue > maximum) {
			throw new RangeError(`Reviewed effect parameter ${id} has an invalid range or default.`);
		}
		return Object.freeze({ id, index, defaultValue, minimum, maximum });
	});
	return Object.freeze(parameters);
}

function normalizeResources(value: unknown, parameterCount: number): ReviewedEffectResourceManifest {
	const resources = closedRecord(value, RESOURCE_KEYS, 'reviewed effect resources');
	const maximumChannels = boundedInteger(resources.maximumChannels, 'maximumChannels', 1, 32);
	const maximumBlockFrames = boundedInteger(resources.maximumBlockFrames, 'maximumBlockFrames', 1, 16_384);
	const exactPcmBytes = maximumChannels * maximumBlockFrames * Float32Array.BYTES_PER_ELEMENT;
	const maximumInputBytes = boundedInteger(resources.maximumInputBytes, 'maximumInputBytes', 4, 2 ** 31 - 1);
	const maximumOutputBytes = boundedInteger(resources.maximumOutputBytes, 'maximumOutputBytes', 4, 2 ** 31 - 1);
	if (maximumInputBytes !== exactPcmBytes || maximumOutputBytes !== exactPcmBytes) {
		throw new RangeError('Reviewed effect PCM byte limits must exactly match the declared block and channel limits.');
	}
	const maximumMemoryPages = boundedInteger(resources.maximumMemoryPages, 'maximumMemoryPages', 1, 256);
	const requiredBytes = maximumInputBytes + maximumOutputBytes
		+ parameterCount * Float32Array.BYTES_PER_ELEMENT;
	if (maximumMemoryPages * 65_536 < requiredBytes) {
		throw new RangeError('Reviewed effect memory cannot contain its declared input, output, and parameters.');
	}
	return Object.freeze({
		maximumModuleBytes: boundedInteger(resources.maximumModuleBytes, 'maximumModuleBytes', 8, 1024 * 1024),
		maximumMemoryPages,
		maximumChannels,
		maximumBlockFrames,
		maximumInputBytes,
		maximumOutputBytes,
		processingTimeoutMs: boundedInteger(resources.processingTimeoutMs, 'processingTimeoutMs', 10, 10_000),
	});
}

function closedRecord(value: unknown, keys: ReadonlySet<string>, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be an object.`);
	const prototype = Object.getPrototypeOf(value) as unknown;
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a plain object.`);
	const ownKeys = Reflect.ownKeys(value);
	if (ownKeys.length !== keys.size) throw new RangeError(`${name} must contain exactly its closed schema fields.`);
	for (const key of ownKeys) {
		if (typeof key !== 'string' || !keys.has(key)) throw new RangeError(`Unknown ${name} field: ${String(key)}.`);
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name} fields must be enumerable data properties.`);
		}
	}
	return value as Record<string, unknown>;
}

function boundedIdentifier(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength
		|| !IDENTIFIER_PATTERN.test(value)) {
		throw new RangeError(`Reviewed effect ${name} is invalid.`);
	}
	return value;
}

function boundedVersion(value: unknown): string {
	if (typeof value !== 'string' || value.length > 96 || !VERSION_PATTERN.test(value)) {
		throw new RangeError('Reviewed effect package version must be an exact semantic version.');
	}
	return value;
}

function boundedText(value: unknown, name: string, maximumLength: number): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength || value.trim() !== value) {
		throw new RangeError(`Reviewed effect ${name} is invalid.`);
	}
	return value;
}

function boundedInteger(value: unknown, name: string, minimum: number, maximum: number): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`Reviewed effect ${name} must be an integer from ${String(minimum)} to ${String(maximum)}.`);
	}
	return value as number;
}

function finiteNumber(value: unknown, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new RangeError(`Reviewed effect ${name} must be finite.`);
	}
	return value;
}
