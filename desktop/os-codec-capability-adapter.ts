/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-owned, fail-closed verification of exact operating-system codec canary results. */

import { createHash } from 'node:crypto';

import {
	DESKTOP_CODEC_TARGETS,
	type DesktopCodecCapability,
	type DesktopCodecIntegerConstraint,
	type DesktopCodecVerifiedCapability,
	type DesktopCodecTarget,
	type OperatingSystemDesktopCodecProviderOptions,
} from '../src/common/editor/desktop-codec-provider-catalog.ts';

export type OperatingSystemCodecImplementation =
	| 'windows-media-foundation'
	| 'apple-audiotoolbox-avfoundation'
	| 'apple-avfoundation-videotoolbox';

export interface OperatingSystemCodecCanaryCandidate {
	readonly capability: DesktopCodecCapability;
}

export interface OperatingSystemCodecCanaryRequest {
	readonly contractVersion: 1;
	readonly target: DesktopCodecTarget;
	readonly osVersion: string;
	readonly implementation: OperatingSystemCodecImplementation;
	readonly capability: DesktopCodecCapability;
	readonly capabilityDigest: string;
	readonly maximumDurationMs: number;
}

export type OperatingSystemCodecCanaryResult = Readonly<{
	readonly contractVersion: 1;
	readonly status: 'passed';
	readonly target: DesktopCodecTarget;
	readonly osVersion: string;
	readonly capabilityId: string;
	readonly capabilityDigest: string;
	readonly implementation: OperatingSystemCodecImplementation;
	readonly nativeApiReached: true;
	readonly exactTuplePassed: true;
	readonly resultDigest: string;
}> | Readonly<{
	readonly contractVersion: 1;
	readonly status: 'unavailable';
	readonly reason: 'api-unavailable' | 'tuple-unsupported' | 'canary-refused';
}>;

export interface OperatingSystemCodecCanaryRunner {
	/** The adapter has no built-in native binary. Main must inject the supervised native canary. */
	run(request: OperatingSystemCodecCanaryRequest, signal: AbortSignal): Promise<unknown>;
}

export type OperatingSystemCodecCanaryObservationReason =
	| 'canary-adapter-unavailable' | 'canary-failed' | 'canary-timeout'
	| 'malformed-canary-result' | 'mismatched-canary-result'
	| 'api-unavailable' | 'tuple-unsupported' | 'canary-refused';

export interface OperatingSystemCodecCanaryObservation {
	readonly capabilityId: string;
	readonly disposition: 'verified' | 'unavailable' | 'rejected';
	readonly reason: OperatingSystemCodecCanaryObservationReason | null;
}

export interface OperatingSystemCodecCapabilityVerification {
	readonly status: 'available' | 'unavailable';
	readonly unavailableReason:
		| 'linux-no-system-codec-provider'
		| 'native-canary-adapter-unavailable'
		| 'no-canary-verified-tuples'
		| null;
	readonly providerOptions: OperatingSystemDesktopCodecProviderOptions;
	readonly observations: readonly OperatingSystemCodecCanaryObservation[];
}

export interface OperatingSystemCodecCapabilityOptions {
	readonly target: DesktopCodecTarget;
	readonly osVersion: string;
	readonly candidates: readonly OperatingSystemCodecCanaryCandidate[];
	readonly runner: OperatingSystemCodecCanaryRunner | null;
	readonly maximumDurationMs?: number;
	readonly signal?: AbortSignal;
}

interface CanonicalCandidate {
	readonly capability: DesktopCodecCapability;
	readonly implementation: OperatingSystemCodecImplementation;
	readonly capabilityDigest: string;
}

type CanaryInvocation = Readonly<{
	readonly status: 'returned';
	readonly value: unknown;
}> | Readonly<{
	readonly status: 'failed' | 'timeout';
}>;

const TARGETS = new Set<string>(DESKTOP_CODEC_TARGETS);
const TOKEN = /^[A-Za-z0-9][A-Za-z0-9+._:/-]{0,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
const CAPABILITY_FIELDS = [
	'id', 'direction', 'mediaKind', 'container', 'codec', 'profile', 'sampleFormat',
	'pixelFormat', 'sampleRate', 'channelCount', 'width', 'height',
] as const;
const PASSED_FIELDS = [
	'contractVersion', 'status', 'target', 'osVersion', 'capabilityId', 'capabilityDigest',
	'implementation', 'nativeApiReached', 'exactTuplePassed', 'resultDigest',
] as const;
const UNAVAILABLE_FIELDS = ['contractVersion', 'status', 'reason'] as const;
const DEFAULT_CANARY_DURATION_MS = 5_000;
const MAXIMUM_CANARY_DURATION_MS = 30_000;

export async function verifyOperatingSystemCodecCapabilities(
	options: OperatingSystemCodecCapabilityOptions,
): Promise<OperatingSystemCodecCapabilityVerification> {
	const target = desktopTarget(options?.target);
	const osVersion = token(options?.osVersion, 'operating-system version');
	throwIfAborted(options?.signal);
	if (target.startsWith('linux-')) {
		return verification(target, osVersion, [], [], 'linux-no-system-codec-provider');
	}
	const maximumDurationMs = integer(
		options.maximumDurationMs ?? DEFAULT_CANARY_DURATION_MS,
		1, MAXIMUM_CANARY_DURATION_MS, 'canary maximum duration',
	);
	const candidates = canonicalCandidates(options?.candidates, target);
	const runner = canaryRunner(options?.runner);
	if (runner === null) {
		return verification(target, osVersion, [], candidates.map(({ capability }) => observation(
			capability.id, 'unavailable', 'canary-adapter-unavailable',
		)), 'native-canary-adapter-unavailable');
	}
	const verified: DesktopCodecVerifiedCapability[] = [];
	const resultDigests: string[] = [];
	const observations: OperatingSystemCodecCanaryObservation[] = [];
	for (const candidate of candidates) {
		throwIfAborted(options.signal);
		const request = Object.freeze({
			contractVersion: 1 as const, target, osVersion,
			implementation: candidate.implementation, capability: candidate.capability,
			capabilityDigest: candidate.capabilityDigest, maximumDurationMs,
		});
		const invocation = await invokeCanary(runner, request, maximumDurationMs, options.signal);
		throwIfAborted(options.signal);
		if (invocation.status !== 'returned') {
			observations.push(observation(candidate.capability.id, 'unavailable',
				invocation.status === 'timeout' ? 'canary-timeout' : 'canary-failed'));
			continue;
		}
		const inspected = inspectCanaryResult(invocation.value, request);
		observations.push(inspected.observation);
		if (inspected.binding !== null) {
			verified.push(inspected.binding);
			resultDigests.push(`${candidate.capabilityDigest}:${inspected.resultDigest}`);
		}
	}
	return verification(
		target, osVersion, verified, observations,
		verified.length === 0 ? 'no-canary-verified-tuples' : null,
		resultDigests,
	);
}

function verification(
	target: DesktopCodecTarget,
	osVersion: string,
	verifiedValue: readonly DesktopCodecVerifiedCapability[],
	observationsValue: readonly OperatingSystemCodecCanaryObservation[],
	unavailableReason: OperatingSystemCodecCapabilityVerification['unavailableReason'],
	resultDigests: readonly string[] = [],
): OperatingSystemCodecCapabilityVerification {
	const canaryVerifiedCapabilities = Object.freeze(verifiedValue.map((entry) => Object.freeze({
		capability: entry.capability, implementation: entry.implementation,
	})));
	const observations = Object.freeze([...observationsValue]);
	const capabilityGeneration = `os-canary-${digest(JSON.stringify({
		target, osVersion, resultDigests: [...resultDigests].sort(),
	}))}`;
	const providerOptions = Object.freeze({
		target, osVersion, capabilityGeneration, canaryVerifiedCapabilities,
	});
	return Object.freeze({
		status: canaryVerifiedCapabilities.length > 0 ? 'available' : 'unavailable',
		unavailableReason, providerOptions, observations,
	});
}

function canonicalCandidates(value: unknown, target: DesktopCodecTarget): readonly CanonicalCandidate[] {
	if (!Array.isArray(value) || value.length > 256) throw new TypeError('OS codec canary candidates are invalid.');
	const identifiers = new Set<string>();
	return Object.freeze(value.map((candidateValue: unknown) => {
		const record = closedRecord(candidateValue, ['capability'], 'OS codec canary candidate');
		const capability = cloneCapability(record.capability);
		if (identifiers.has(capability.id)) throw new TypeError('OS codec canary capability identifiers must be unique.');
		identifiers.add(capability.id);
		const implementation: OperatingSystemCodecImplementation = target.startsWith('win-')
			? 'windows-media-foundation'
			: capability.mediaKind === 'audio'
				? 'apple-audiotoolbox-avfoundation'
				: 'apple-avfoundation-videotoolbox';
		return Object.freeze({ capability, implementation, capabilityDigest: digest(JSON.stringify(capability)) });
	}));
}

function cloneCapability(value: unknown): DesktopCodecCapability {
	const record = closedRecord(value, CAPABILITY_FIELDS, 'OS codec capability');
	if (!['probe', 'decode', 'encode', 'transform'].includes(String(record.direction))) {
		throw new TypeError('OS codec capability direction is invalid.');
	}
	if (record.mediaKind !== 'audio' && record.mediaKind !== 'video') {
		throw new TypeError('OS codec canaries require one exact audio or video tuple.');
	}
	const result = Object.freeze({
		id: token(record.id, 'OS codec capability identifier'),
		direction: record.direction as DesktopCodecCapability['direction'],
		mediaKind: record.mediaKind,
		container: token(record.container, 'OS codec capability container'),
		codec: token(record.codec, 'OS codec capability codec'),
		profile: nullableToken(record.profile, 'OS codec capability profile'),
		sampleFormat: nullableToken(record.sampleFormat, 'OS codec capability sample format'),
		pixelFormat: nullableToken(record.pixelFormat, 'OS codec capability pixel format'),
		sampleRate: numericConstraint(record.sampleRate, 1, 768_000, 'OS codec capability sample rate'),
		channelCount: numericConstraint(record.channelCount, 1, 64, 'OS codec capability channel count'),
		width: numericConstraint(record.width, 1, 32_768, 'OS codec capability width'),
		height: numericConstraint(record.height, 1, 32_768, 'OS codec capability height'),
	});
	if (result.mediaKind === 'audio' && (result.sampleFormat === null || result.sampleRate === null
		|| result.channelCount === null || result.pixelFormat !== null || result.width !== null || result.height !== null)) {
		throw new TypeError('An OS audio codec canary must carry exact audio constraints only.');
	}
	if (result.mediaKind === 'video' && (result.pixelFormat === null || result.width === null
		|| result.height === null || result.sampleFormat !== null || result.sampleRate !== null
		|| result.channelCount !== null)) {
		throw new TypeError('An OS video codec canary must carry exact video constraints only.');
	}
	return result;
}

function inspectCanaryResult(
	value: unknown,
	request: OperatingSystemCodecCanaryRequest,
): Readonly<{
	readonly observation: OperatingSystemCodecCanaryObservation;
	readonly binding: DesktopCodecVerifiedCapability | null;
	readonly resultDigest: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return malformedInspection(request.capability.id);
	const statusDescriptor = Object.getOwnPropertyDescriptor(value, 'status');
	if (!statusDescriptor || !Object.hasOwn(statusDescriptor, 'value')) return malformedInspection(request.capability.id);
	if (statusDescriptor.value === 'unavailable') {
		let record: Record<string, unknown>;
		try { record = closedRecord(value, UNAVAILABLE_FIELDS, 'OS codec unavailable canary result'); }
		catch { return malformedInspection(request.capability.id); }
		if (record.contractVersion !== 1
			|| !['api-unavailable', 'tuple-unsupported', 'canary-refused'].includes(String(record.reason))) {
			return malformedInspection(request.capability.id);
		}
		const reason = record.reason as Extract<OperatingSystemCodecCanaryObservationReason,
			'api-unavailable' | 'tuple-unsupported' | 'canary-refused'>;
		return Object.freeze({
			observation: observation(request.capability.id, 'unavailable', reason),
			binding: null, resultDigest: '',
		});
	}
	let record: Record<string, unknown>;
	try { record = closedRecord(value, PASSED_FIELDS, 'OS codec passed canary result'); }
	catch { return malformedInspection(request.capability.id); }
	if (record.contractVersion !== 1 || record.status !== 'passed'
		|| typeof record.target !== 'string' || typeof record.osVersion !== 'string'
		|| typeof record.capabilityId !== 'string' || typeof record.capabilityDigest !== 'string'
		|| typeof record.implementation !== 'string' || record.nativeApiReached !== true
		|| record.exactTuplePassed !== true || typeof record.resultDigest !== 'string'
		|| !SHA256.test(record.resultDigest)) return malformedInspection(request.capability.id);
	if (record.target !== request.target || record.osVersion !== request.osVersion
		|| record.capabilityId !== request.capability.id
		|| record.capabilityDigest !== request.capabilityDigest
		|| record.implementation !== request.implementation) {
		return Object.freeze({
			observation: observation(request.capability.id, 'rejected', 'mismatched-canary-result'),
			binding: null, resultDigest: '',
		});
	}
	return Object.freeze({
		observation: observation(request.capability.id, 'verified', null),
		binding: Object.freeze({ capability: request.capability, implementation: request.implementation }),
		resultDigest: record.resultDigest,
	});
}

function malformedInspection(capabilityId: string): ReturnType<typeof inspectCanaryResult> {
	return Object.freeze({
		observation: observation(capabilityId, 'rejected', 'malformed-canary-result'),
		binding: null, resultDigest: '',
	});
}

function observation(
	capabilityId: string,
	disposition: OperatingSystemCodecCanaryObservation['disposition'],
	reason: OperatingSystemCodecCanaryObservation['reason'],
): OperatingSystemCodecCanaryObservation {
	return Object.freeze({ capabilityId, disposition, reason });
}

async function invokeCanary(
	runner: OperatingSystemCodecCanaryRunner,
	request: OperatingSystemCodecCanaryRequest,
	maximumDurationMs: number,
	outerSignal?: AbortSignal,
): Promise<CanaryInvocation> {
	throwIfAborted(outerSignal);
	const controller = new AbortController();
	return await new Promise<CanaryInvocation>((resolve) => {
		let settled = false;
		const finish = (result: CanaryInvocation): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			outerSignal?.removeEventListener('abort', cancelled);
			resolve(result);
		};
		const cancelled = (): void => {
			controller.abort(outerSignal?.reason);
			finish(Object.freeze({ status: 'failed' }));
		};
		const timer = setTimeout(() => {
			controller.abort(new Error('OS codec canary timed out.'));
			finish(Object.freeze({ status: 'timeout' }));
		}, maximumDurationMs);
		outerSignal?.addEventListener('abort', cancelled, { once: true });
		if (outerSignal?.aborted === true) cancelled();
		if (settled) return;
		const pending = Promise.resolve().then(() => runner.run(request, controller.signal));
		void pending.then(
			(value) => finish(Object.freeze({ status: 'returned', value })),
			() => finish(Object.freeze({ status: 'failed' })),
		);
	});
}

function canaryRunner(value: unknown): OperatingSystemCodecCanaryRunner | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || typeof (value as OperatingSystemCodecCanaryRunner).run !== 'function') {
		throw new TypeError('The OS codec canary runner is invalid.');
	}
	return value as OperatingSystemCodecCanaryRunner;
}

function closedRecord(
	value: unknown, fields: readonly string[], label: string,
): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${label} must be one plain record.`);
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const keys = Object.keys(descriptors).sort();
	const expected = [...fields].sort();
	if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])
		|| Object.values(descriptors).some((descriptor) => !Object.hasOwn(descriptor, 'value'))) {
		throw new TypeError(`${label} must have only its closed data fields.`);
	}
	return value as Record<string, unknown>;
}

function numericConstraint(
	value: unknown, minimum: number, maximum: number, label: string,
): DesktopCodecIntegerConstraint | null {
	if (value === null) return null;
	if (typeof value === 'number') return integer(value, minimum, maximum, label);
	const record = closedRecord(value, ['minimum', 'maximum', 'multipleOf'], label);
	const lower = integer(record.minimum, minimum, maximum, `${label} minimum`);
	const upper = integer(record.maximum, minimum, maximum, `${label} maximum`);
	const multipleOf = integer(record.multipleOf, 1, maximum, `${label} multiple`);
	if (lower > upper) throw new RangeError(`${label} range is invalid.`);
	return Object.freeze({ minimum: lower, maximum: upper, multipleOf });
}

function desktopTarget(value: unknown): DesktopCodecTarget {
	if (typeof value !== 'string' || !TARGETS.has(value)) throw new TypeError('The OS codec target is unsupported.');
	return value as DesktopCodecTarget;
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

function digest(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason instanceof Error) throw signal.reason;
	throw new DOMException('OS codec capability admission was cancelled.', 'AbortError');
}
