/* SPDX-License-Identifier: AGPL-3.0-only */

/** Reviewed OS audio codec tuples. Every candidate still requires an exact native canary. */

import {
	DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
	DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE,
	DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
	normalizeDesktopAudioCodecRequest,
	type DesktopAudioCodecRequest,
} from './desktop-audio-codec-operation-contract.ts';
import type {
	OperatingSystemCodecCanaryCandidate,
	OperatingSystemCodecImplementation,
} from './os-codec-capability-adapter.ts';
import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecCapability,
	type DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type { DesktopCodecOperation } from '../src/common/editor/desktop-codec-coordinator.ts';

export type DesktopAudioOperatingSystemImplementation = Exclude<
	OperatingSystemCodecImplementation,
	'apple-avfoundation-videotoolbox'
>;

export interface DesktopAudioOperatingSystemCandidateSet {
	readonly target: DesktopCodecTarget;
	readonly implementation: DesktopAudioOperatingSystemImplementation | null;
	readonly candidates: readonly OperatingSystemCodecCanaryCandidate[];
}

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._:/-]{0,127}$/u;
const OPERATION_FIELDS = Object.freeze([
	'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat',
	'pixelFormat', 'sampleRate', 'channelCount', 'width', 'height',
] as const);

export function deriveDesktopAudioOperatingSystemCandidates(
	targetValue: unknown,
	requestValue: unknown,
): DesktopAudioOperatingSystemCandidateSet {
	const target = desktopTarget(targetValue);
	const request = normalizeDesktopAudioCodecRequest(requestValue);
	const operation = reviewedOperationFromRequest(request);
	return candidateSet(target, operation);
}

export function deriveDesktopAudioOperatingSystemCandidatesFromOperation(
	targetValue: unknown,
	operationValue: unknown,
): DesktopAudioOperatingSystemCandidateSet {
	const target = desktopTarget(targetValue);
	const operation = canonicalAudioOperation(operationValue);
	return candidateSet(target, reviewedOperation(operation) ? operation : null);
}

function candidateSet(
	target: DesktopCodecTarget,
	operation: DesktopCodecOperation | null,
): DesktopAudioOperatingSystemCandidateSet {
	const implementation = implementationForTarget(target);
	if (implementation === null || operation === null) {
		return Object.freeze({ target, implementation, candidates: Object.freeze([]) });
	}
	const capability: DesktopCodecCapability = Object.freeze({
		id: capabilityId(implementation, operation),
		...operation,
	});
	return Object.freeze({
		target,
		implementation,
		candidates: Object.freeze([Object.freeze({ capability })]),
	});
}

function reviewedOperationFromRequest(request: DesktopAudioCodecRequest): DesktopCodecOperation | null {
	if (request.operation === 'audio-decode') return null;
	if (request.format === 'aac-m4a') return Object.freeze({
		direction: 'encode',
		mediaKind: 'audio', container: 'm4a', codec: 'aac', profile: 'lc',
		sampleFormat: 'f32p', pixelFormat: null,
		sampleRate: request.sampleRate, channelCount: request.channelCount,
		width: null, height: null,
	});
	return null;
}

function reviewedOperation(operation: DesktopCodecOperation): boolean {
	return operation.container === 'm4a' && operation.codec === 'aac'
		&& operation.profile === 'lc' && operation.sampleFormat === 'f32p'
		&& (operation.direction === 'encode' || operation.direction === 'decode')
		|| operation.container === 'mp3' && operation.codec === 'mp3'
			&& operation.profile === null && operation.sampleFormat === 'f32'
			&& operation.direction === 'decode';
}

function canonicalAudioOperation(value: unknown): DesktopCodecOperation {
	const record = closedRecord(value, OPERATION_FIELDS, 'desktop OS audio operation');
	if (record.direction !== 'encode' && record.direction !== 'decode') {
		throw new TypeError('The desktop OS audio operation direction is unsupported.');
	}
	if (record.mediaKind !== 'audio' || record.pixelFormat !== null
		|| record.width !== null || record.height !== null) {
		throw new TypeError('The desktop OS codec candidate requires one audio operation.');
	}
	const sampleFormat = token(record.sampleFormat, 'desktop OS audio sample format');
	const operation: DesktopCodecOperation = Object.freeze({
		direction: record.direction,
		mediaKind: 'audio',
		container: token(record.container, 'desktop OS audio container'),
		codec: token(record.codec, 'desktop OS audio codec'),
		profile: nullableToken(record.profile, 'desktop OS audio profile'),
		sampleFormat,
		pixelFormat: null,
		sampleRate: integer(
			record.sampleRate, DESKTOP_AUDIO_CODEC_MINIMUM_SAMPLE_RATE,
			DESKTOP_AUDIO_CODEC_MAXIMUM_SAMPLE_RATE, 'desktop OS audio sample rate',
		),
		channelCount: integer(
			record.channelCount, 1, DESKTOP_AUDIO_CODEC_MAXIMUM_CHANNEL_COUNT,
			'desktop OS audio channel count',
		),
		width: null,
		height: null,
	});
	return operation;
}

function implementationForTarget(
	target: DesktopCodecTarget,
): DesktopAudioOperatingSystemImplementation | null {
	if (target === 'win-x64' || target === 'win-arm64') return 'windows-media-foundation';
	if (target === 'mac-arm64') return 'apple-audiotoolbox-avfoundation';
	return null;
}

function capabilityId(
	implementation: DesktopAudioOperatingSystemImplementation,
	operation: DesktopCodecOperation,
): string {
	return [
		implementation, operation.direction, operation.container, operation.codec,
		operation.profile ?? 'default', operation.sampleFormat,
		`${String(operation.sampleRate)}hz`, `${String(operation.channelCount)}ch`,
	].join('-');
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (value === 'mac-x64') throw new TypeError('macOS x64 is explicitly unsupported.');
	if (typeof value !== 'string' || !TARGETS.has(value)) {
		throw new TypeError('The desktop OS audio codec target is unsupported.');
	}
	return value as DesktopCodecTarget;
}

function closedRecord(
	value: unknown, fields: readonly string[], label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`The ${label} must be a plain record.`);
	}
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Reflect.ownKeys(descriptors);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))
		|| keys.some((key) => {
			const descriptor = descriptors[key as keyof typeof descriptors];
			return descriptor !== undefined && !Object.hasOwn(descriptor, 'value');
		})) throw new TypeError(`The ${label} has an inexact shape.`);
	return value as Record<string, unknown>;
}

function token(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function nullableToken(value: unknown, label: string): string | null {
	return value === null ? null : token(value, label);
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return Number(value);
}
