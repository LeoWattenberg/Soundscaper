/* SPDX-License-Identifier: AGPL-3.0-only */

/** Bounded, pathless bridge from OS codec verification to an injected native canary host. */

import { createHash } from 'node:crypto';

import type {
	DesktopCodecCapability,
	DesktopCodecIntegerConstraint,
	DesktopCodecTarget,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';
import type {
	OperatingSystemCodecCanaryRequest,
	OperatingSystemCodecCanaryResult,
	OperatingSystemCodecCanaryRunner,
	OperatingSystemCodecImplementation,
} from './os-codec-capability-adapter.ts';

export interface OperatingSystemCodecNativeHostAdapter {
	/** Runs an embedded deterministic canary; this boundary grants no process or file authority. */
	runCanary(request: OperatingSystemCodecCanaryRequest, signal: AbortSignal): unknown | Promise<unknown>;
}

const SUPPORTED_TARGETS = new Set<string>(['win-x64', 'win-arm64', 'mac-arm64']);
const IMPLEMENTATIONS = new Set<string>([
	'windows-media-foundation',
	'apple-audiotoolbox-avfoundation',
	'apple-avfoundation-videotoolbox',
]);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const MAXIMUM_DURATION_MS = 30_000;
const REQUEST_FIELDS = [
	'contractVersion', 'target', 'osVersion', 'implementation', 'capability',
	'capabilityDigest', 'maximumDurationMs',
] as const;
const CAPABILITY_FIELDS = [
	'id', 'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat',
	'pixelFormat', 'sampleRate', 'channelCount', 'width', 'height',
] as const;
const PASSED_FIELDS = [
	'contractVersion', 'status', 'target', 'osVersion', 'capabilityId',
	'capabilityDigest', 'implementation', 'nativeApiReached', 'exactTuplePassed',
	'resultDigest',
] as const;
const UNAVAILABLE_FIELDS = ['contractVersion', 'status', 'reason'] as const;
const UNAVAILABLE_REASONS = new Set<string>([
	'api-unavailable', 'tuple-unsupported', 'canary-refused',
]);

export function createOperatingSystemCodecNativeCanaryRunner(
	adapterValue: OperatingSystemCodecNativeHostAdapter,
): OperatingSystemCodecCanaryRunner {
	const adapter = nativeHostAdapter(adapterValue);
	return Object.freeze({
		async run(requestValue: OperatingSystemCodecCanaryRequest, signal: AbortSignal): Promise<unknown> {
			const request = canonicalRequest(requestValue);
			const result = await invokeBounded(adapter, request, requiredSignal(signal));
			return inspectNativeResult(result, request);
		},
	});
}

function canonicalRequest(value: unknown): OperatingSystemCodecCanaryRequest {
	const record = closedRecord(value, REQUEST_FIELDS, 'OS codec native canary request');
	if (record.contractVersion !== 1) throw new TypeError('The OS codec native canary contract version is unsupported.');
	const target = supportedTarget(record.target);
	const osVersion = token(record.osVersion, 'OS codec native canary operating-system version');
	const implementation = nativeImplementation(record.implementation);
	const capability = canonicalCapability(record.capability);
	assertFrameworkTuple(target, implementation, capability.mediaKind);
	const capabilityDigest = sha256(JSON.stringify(capability));
	if (record.capabilityDigest !== capabilityDigest) {
		throw new TypeError('The OS codec native canary capability digest does not bind its exact tuple.');
	}
	const maximumDurationMs = integer(
		record.maximumDurationMs, 1, MAXIMUM_DURATION_MS,
		'OS codec native canary maximum duration',
	);
	return Object.freeze({
		contractVersion: 1,
		target,
		osVersion,
		implementation,
		capability,
		capabilityDigest,
		maximumDurationMs,
	});
}

function canonicalCapability(value: unknown): DesktopCodecCapability {
	const record = closedRecord(value, CAPABILITY_FIELDS, 'OS codec native canary capability');
	if (!['probe', 'decode', 'encode', 'transform'].includes(String(record.direction))) {
		throw new TypeError('The OS codec native canary direction is unsupported.');
	}
	if (record.mediaKind !== 'audio' && record.mediaKind !== 'video') {
		throw new TypeError('The OS codec native canary media kind is unsupported.');
	}
	const capability: DesktopCodecCapability = Object.freeze({
		id: token(record.id, 'OS codec native canary capability identifier'),
		direction: record.direction as DesktopCodecCapability['direction'],
		mediaKind: record.mediaKind,
		container: token(record.container, 'OS codec native canary container'),
		codec: token(record.codec, 'OS codec native canary codec'),
		profile: nullableToken(record.profile, 'OS codec native canary profile'),
		sampleFormat: nullableToken(record.sampleFormat, 'OS codec native canary sample format'),
		pixelFormat: nullableToken(record.pixelFormat, 'OS codec native canary pixel format'),
		sampleRate: numericConstraint(record.sampleRate, 1, 768_000, 'OS codec native canary sample rate'),
		channelCount: numericConstraint(record.channelCount, 1, 64, 'OS codec native canary channel count'),
		width: numericConstraint(record.width, 1, 32_768, 'OS codec native canary width'),
		height: numericConstraint(record.height, 1, 32_768, 'OS codec native canary height'),
	});
	if (capability.mediaKind === 'audio' && (capability.sampleFormat === null
		|| capability.sampleRate === null || capability.channelCount === null
		|| capability.pixelFormat !== null || capability.width !== null || capability.height !== null)) {
		throw new TypeError('An OS codec native audio canary requires only exact audio constraints.');
	}
	if (capability.mediaKind === 'video' && (capability.pixelFormat === null
		|| capability.width === null || capability.height === null
		|| capability.sampleFormat !== null || capability.sampleRate !== null
		|| capability.channelCount !== null)) {
		throw new TypeError('An OS codec native video canary requires only exact video constraints.');
	}
	return capability;
}

function assertFrameworkTuple(
	target: DesktopCodecTarget,
	implementation: OperatingSystemCodecImplementation,
	mediaKind: DesktopCodecCapability['mediaKind'],
): void {
	if (target.startsWith('win-')) {
		if (implementation !== 'windows-media-foundation') {
			throw new TypeError('A Windows OS codec native canary requires the Media Foundation framework.');
		}
		return;
	}
	const expected = mediaKind === 'audio'
		? 'apple-audiotoolbox-avfoundation'
		: 'apple-avfoundation-videotoolbox';
	if (implementation !== expected) {
		throw new TypeError(`The macOS OS codec native canary framework does not match its ${mediaKind} tuple.`);
	}
}

async function invokeBounded(
	adapter: OperatingSystemCodecNativeHostAdapter,
	request: OperatingSystemCodecCanaryRequest,
	outerSignal: AbortSignal,
): Promise<unknown> {
	outerSignal.throwIfAborted();
	const deadline = new AbortController();
	const nativeSignal = AbortSignal.any([outerSignal, deadline.signal]);
	let abortListener: (() => void) | undefined;
	const aborted = new Promise<never>((_resolve, reject) => {
		abortListener = () => { reject(abortReason(nativeSignal)); };
		nativeSignal.addEventListener('abort', abortListener, { once: true });
		if (nativeSignal.aborted) abortListener();
	});
	const timer = setTimeout(() => {
		deadline.abort(new DOMException('OS codec native canary timed out.', 'TimeoutError'));
	}, request.maximumDurationMs);
	try {
		const invocation = Promise.resolve().then(() => adapter.runCanary(request, nativeSignal));
		return await Promise.race([invocation, aborted]);
	} finally {
		clearTimeout(timer);
		if (abortListener !== undefined) nativeSignal.removeEventListener('abort', abortListener);
	}
}

function inspectNativeResult(
	value: unknown,
	request: OperatingSystemCodecCanaryRequest,
): OperatingSystemCodecCanaryResult {
	const status = dataProperty(value, 'status', 'OS codec native canary result');
	if (status === 'unavailable') {
		const record = closedRecord(value, UNAVAILABLE_FIELDS, 'OS codec native canary unavailable result');
		if (record.contractVersion !== 1 || typeof record.reason !== 'string'
			|| !UNAVAILABLE_REASONS.has(record.reason)) {
			throw new TypeError('The OS codec native canary unavailable result is invalid.');
		}
		return Object.freeze({
			contractVersion: 1,
			status: 'unavailable',
			reason: record.reason as Extract<OperatingSystemCodecCanaryResult, { status: 'unavailable' }>['reason'],
		});
	}
	const record = closedRecord(value, PASSED_FIELDS, 'OS codec native canary passed result');
	if (record.contractVersion !== 1 || record.status !== 'passed'
		|| record.target !== request.target || record.osVersion !== request.osVersion
		|| record.capabilityId !== request.capability.id
		|| record.capabilityDigest !== request.capabilityDigest
		|| record.implementation !== request.implementation
		|| record.nativeApiReached !== true || record.exactTuplePassed !== true
		|| typeof record.resultDigest !== 'string' || !SHA256.test(record.resultDigest)) {
		throw new TypeError('The OS codec native canary passed result does not match its exact request.');
	}
	return Object.freeze({
		contractVersion: 1,
		status: 'passed',
		target: request.target,
		osVersion: request.osVersion,
		capabilityId: request.capability.id,
		capabilityDigest: request.capabilityDigest,
		implementation: request.implementation,
		nativeApiReached: true,
		exactTuplePassed: true,
		resultDigest: record.resultDigest,
	});
}

function nativeHostAdapter(value: unknown): OperatingSystemCodecNativeHostAdapter {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An injected OS codec native host adapter is required.');
	}
	const method = Object.getOwnPropertyDescriptor(value, 'runCanary');
	if (!method || !Object.hasOwn(method, 'value') || typeof method.value !== 'function') {
		throw new TypeError('The injected OS codec native host adapter is invalid.');
	}
	return value as OperatingSystemCodecNativeHostAdapter;
}

function supportedTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !SUPPORTED_TARGETS.has(value)) {
		throw new TypeError('The OS codec native canary target is unsupported.');
	}
	return value as DesktopCodecTarget;
}

function nativeImplementation(value: unknown): OperatingSystemCodecImplementation {
	if (typeof value !== 'string' || !IMPLEMENTATIONS.has(value)) {
		throw new TypeError('The OS codec native canary implementation is unsupported.');
	}
	return value as OperatingSystemCodecImplementation;
}

function numericConstraint(
	value: unknown,
	minimum: number,
	maximum: number,
	label: string,
): DesktopCodecIntegerConstraint | null {
	if (value === null) return null;
	if (typeof value === 'number') return integer(value, minimum, maximum, label);
	const record = closedRecord(value, ['minimum', 'maximum', 'multipleOf'], label);
	const lower = integer(record.minimum, minimum, maximum, `${label} minimum`);
	const upper = integer(record.maximum, minimum, maximum, `${label} maximum`);
	const multipleOf = integer(record.multipleOf, 1, maximum, `${label} multiple`);
	if (lower > upper) throw new RangeError(`The ${label} range is invalid.`);
	return Object.freeze({ minimum: lower, maximum: upper, multipleOf });
}

function closedRecord(
	value: unknown,
	fields: readonly string[],
	label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${label} must be one plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	const expected = [...fields].sort();
	if (keys.some((key) => typeof key !== 'string')) {
		throw new TypeError(`${label} must have only its closed data fields.`);
	}
	const names = (keys as string[]).sort();
	if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
		throw new TypeError(`${label} must have only its closed data fields.`);
	}
	for (const name of names) {
		const descriptor = Object.getOwnPropertyDescriptor(value, name);
		if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${label} must have only its closed data fields.`);
		}
	}
	return value as Record<string, unknown>;
}

function dataProperty(value: unknown, name: string, label: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be one plain record.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${label} must use closed data fields.`);
	}
	return descriptor.value;
}

function requiredSignal(value: unknown): AbortSignal {
	if (!(value instanceof AbortSignal)) throw new TypeError('An OS codec native canary AbortSignal is required.');
	return value;
}

function nullableToken(value: unknown, label: string): string | null {
	return value === null ? null : token(value, label);
}

function token(value: unknown, label: string): string {
	if (typeof value !== 'string' || !TOKEN.test(value)) throw new TypeError(`The ${label} is invalid.`);
	return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		throw new RangeError(`The ${label} is invalid.`);
	}
	return value as number;
}

function abortReason(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException('OS codec native canary was cancelled.', 'AbortError');
}

function sha256(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}
