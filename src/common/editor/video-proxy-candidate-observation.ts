/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './storage/media-content-digest.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from './video-source-timing-view.ts';
import {
	createVideoTimingAssetPublication,
	validateVideoTimingAssetBytes,
	type VideoTimingAssetPublication,
} from './video-timing-asset.ts';
import {
	probeVideoTiming,
	type VideoTimingProbePort,
} from './video-timing-probe.ts';

export const VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES = 512 * 1024 * 1024;
export const VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES = 8;

type Awaitable<Value> = PromiseLike<Value> | Value;

export interface VideoProxyCandidateRecipe extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly version: number;
}

export interface VideoProxyCandidateOriginalIdentity extends Readonly<Record<string, unknown>> {
	readonly authority: 'owned' | 'linked';
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly generationToken: string;
}

export interface VideoProxyCandidateGeneratorPort {
	readonly id: string;
	readonly version: number;
	generate(
		original: Blob,
		identity: VideoProxyCandidateOriginalIdentity,
		recipe: VideoProxyCandidateRecipe,
		options: Readonly<{ readonly signal?: AbortSignal; assertCurrent(): void }>,
	): Awaitable<unknown>;
}

export interface VideoProxyCandidateObserverDependencies {
	readonly generator: VideoProxyCandidateGeneratorPort;
	readonly recipe: VideoProxyCandidateRecipe;
	readonly probes: readonly VideoTimingProbePort[];
	readonly maximumBytes?: number;
}

export interface VideoProxyCandidateObserver {
	readonly kind: 'video-proxy-candidate-observer';
	readonly version: 1;
}

/** @internal One-use capability returned only to the relationship authority. */
export interface VideoProxyCandidateObservation {
	readonly kind: 'video-proxy-candidate-observation';
	readonly version: 1;
}

/** @internal Closed request issued only by the relationship authority. */
export interface VideoProxyCandidateObservationRequest {
	readonly original: Blob;
	readonly identity: VideoProxyCandidateOriginalIdentity;
	readonly originalSourceId: string;
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
}

/** @internal Private observation material consumed exactly once by the relationship authority. */
export interface VideoProxyCandidateObservationMaterial {
	readonly candidate: Blob;
	readonly timing: BoundVideoSourceTimingView;
	readonly timingPublication: VideoTimingAssetPublication;
	readonly sha256: string;
	readonly byteLength: number;
	readonly mimeType: string;
	readonly generatorId: string;
	readonly generatorVersion: number;
	readonly recipeId: string;
	readonly recipeVersion: number;
	readonly timingBackendId: string;
}

interface CandidateObserverState {
	readonly generator: Readonly<{
		readonly id: string;
		readonly version: number;
		readonly generate: VideoProxyCandidateGeneratorPort['generate'];
	}>;
	readonly recipe: Readonly<VideoProxyCandidateRecipe>;
	readonly probes: readonly VideoTimingProbePort[];
	readonly maximumBytes: number;
}

const OBSERVERS = new WeakMap<object, CandidateObserverState>();
const OBSERVATIONS = new WeakMap<object, VideoProxyCandidateObservationMaterial>();
const SHA256 = /^[a-f0-9]{64}$/u;
const IDENTIFIER = /^[\x20-\x7e]{1,128}$/u;

/** Capture one maintained generator/recipe/probe composition as an opaque authority. */
export function createVideoProxyCandidateObserver(
	dependenciesValue: VideoProxyCandidateObserverDependencies,
): VideoProxyCandidateObserver {
	const dependencies = closedDataRecord(dependenciesValue, [
		'generator', 'recipe', 'probes', 'maximumBytes',
	], ['generator', 'recipe', 'probes'], 'video proxy candidate dependencies');
	const generator = captureGenerator(dependencies.generator);
	const recipe = captureIdentity(dependencies.recipe, 'video proxy candidate recipe');
	const probes = captureProbes(dependencies.probes);
	const maximumBytes = dependencies.maximumBytes === undefined
		? VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES
		: positiveSafeInteger(dependencies.maximumBytes, 'video proxy candidate maximumBytes');
	if (maximumBytes > VIDEO_PROXY_CANDIDATE_MAXIMUM_BYTES) {
		throw new RangeError('Video proxy candidate maximumBytes cannot raise its hard limit.');
	}
	const observer: VideoProxyCandidateObserver = Object.freeze({
		kind: 'video-proxy-candidate-observer',
		version: 1,
	});
	OBSERVERS.set(observer, Object.freeze({ generator, recipe, probes, maximumBytes }));
	return observer;
}

/** @internal Authenticate an observer before any public field can be inspected. */
export function assertVideoProxyCandidateObserver(value: unknown): VideoProxyCandidateObserver {
	observerState(value);
	return value as VideoProxyCandidateObserver;
}

/** @internal Generate and exactly observe one candidate byte sequence. */
export async function observeVideoProxyCandidate(
	observerValue: VideoProxyCandidateObserver,
	requestValue: VideoProxyCandidateObservationRequest,
): Promise<VideoProxyCandidateObservation> {
	const state = observerState(observerValue);
	const request = captureObservationRequest(requestValue);
	if (request.identity.sourceId !== request.originalSourceId) {
		throw new RangeError('The video proxy candidate original source identities must match.');
	}
	assertCurrent(request);
	const original = Object.freeze(canonicalMediaContentBlob(request.original));
	if (original.size !== request.identity.byteLength || original.type !== request.identity.mimeType) {
		throw new Error('The observed original Blob disagrees with its repository identity.');
	}
	const generated = await state.generator.generate(
		original,
		request.identity,
		state.recipe,
		Object.freeze({
			...(request.signal ? { signal: request.signal } : {}),
			assertCurrent: () => assertCurrent(request),
		}),
	);
	assertCurrent(request);
	const candidate = Object.freeze(canonicalMediaContentBlob(generated));
	if (candidate.size < 1) throw new RangeError('A video proxy candidate Blob cannot be empty.');
	if (candidate.size > state.maximumBytes) {
		throw new RangeError('The video proxy candidate Blob exceeds its maximum byte length.');
	}
	if (candidate.type.length > 128 || !/^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(candidate.type)) {
		throw new TypeError('A video proxy candidate requires a canonical video MIME type.');
	}
	const sha256 = await digestMediaContent(candidate, { signal: request.signal });
	assertCurrent(request);
	const resolved = await probeVideoTiming(candidate, {
		probes: state.probes,
		signal: request.signal,
	});
	assertCurrent(request);
	if (resolved.decision !== 'timing-asset') {
		throw new Error('Video proxy candidate timing requires an exact timing-asset probe.');
	}
	const publication = createVideoTimingAssetPublication(sha256, resolved.timing);
	const index = validateVideoTimingAssetBytes(publication.reference, publication.bytes);
	const proxySourceId = privateProxySourceId(request.originalSourceId, sha256);
	const source = Object.freeze({
		id: proxySourceId,
		kind: 'video',
		contentSha256: sha256,
		frameRate: resolved.nominalRate,
		sourceFrameCount: index.frameCount,
		timingAsset: publication.reference,
		timingDecision: Object.freeze({ mode: 'exact', rate: resolved.nominalRate }),
	});
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr',
		reference: publication.reference,
		index,
	});
	const timing = bindVideoSourceTimingView(new Map([[proxySourceId, view]]), source);
	const observation: VideoProxyCandidateObservation = Object.freeze({
		kind: 'video-proxy-candidate-observation',
		version: 1,
	});
	OBSERVATIONS.set(observation, Object.freeze({
		candidate,
		timing,
		timingPublication: publication,
		sha256,
		byteLength: candidate.size,
		mimeType: candidate.type,
		generatorId: state.generator.id,
		generatorVersion: state.generator.version,
		recipeId: state.recipe.id,
		recipeVersion: state.recipe.version,
		timingBackendId: resolved.backend,
	}));
	return observation;
}

/** @internal Consume one observation and remove its Blob/timing state from this authority. */
export function consumeVideoProxyCandidateObservation(
	value: VideoProxyCandidateObservation,
): VideoProxyCandidateObservationMaterial {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An authenticated video proxy candidate observation is required.');
	}
	const material = OBSERVATIONS.get(value);
	if (!material) {
		throw new TypeError('An authenticated unconsumed video proxy candidate observation is required.');
	}
	OBSERVATIONS.delete(value);
	return material;
}

function observerState(value: unknown): CandidateObserverState {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An authenticated video proxy candidate observer is required.');
	}
	const state = OBSERVERS.get(value);
	if (!state) throw new TypeError('An authenticated video proxy candidate observer is required.');
	return state;
}

function captureGenerator(value: unknown): CandidateObserverState['generator'] {
	const raw = closedDataRecord(value, ['id', 'version', 'generate'], [
		'id', 'version', 'generate',
	], 'video proxy candidate generator');
	if (typeof raw.generate !== 'function') {
		throw new TypeError('A video proxy candidate generator function is required.');
	}
	const generate = raw.generate as VideoProxyCandidateGeneratorPort['generate'];
	const id = boundedIdentifier(raw.id, 'video proxy candidate generator.id');
	const version = positiveSafeInteger(raw.version, 'video proxy candidate generator.version');
	const receiver = Object.freeze({ id, version, generate });
	return Object.freeze({
		id,
		version,
		generate: (original, identity, recipe, options) => Reflect.apply(
			generate, receiver, [original, identity, recipe, options],
		) as Awaitable<unknown>,
	});
}

function captureIdentity(value: unknown, name: string): Readonly<VideoProxyCandidateRecipe> {
	const raw = closedDataRecord(value, ['id', 'version'], ['id', 'version'], name);
	return Object.freeze({
		id: boundedIdentifier(raw.id, `${name}.id`),
		version: positiveSafeInteger(raw.version, `${name}.version`),
	});
}

function captureProbes(value: unknown): readonly VideoTimingProbePort[] {
	const entries = denseDataArray(
		value,
		'video proxy timing probes',
		VIDEO_PROXY_CANDIDATE_MAXIMUM_TIMING_PROBES,
	);
	return Object.freeze(entries.map((entry, index) => {
		const name = `video proxy timing probe[${String(index)}]`;
		const raw = closedDataRecord(entry, ['id', 'probe'], ['id', 'probe'], name);
		if (typeof raw.probe !== 'function') throw new TypeError(`${name}.probe must be a function.`);
		const probe = raw.probe as VideoTimingProbePort['probe'];
		const id = boundedIdentifier(raw.id, `${name}.id`);
		const receiver = Object.freeze({ id, probe });
		return Object.freeze({
			id,
			probe: (input: Blob, options?: Readonly<{ signal?: AbortSignal }>) => Reflect.apply(
				probe, receiver, [input, options],
			) as ReturnType<VideoTimingProbePort['probe']>,
		});
	}));
}

function captureObservationRequest(value: unknown): Readonly<VideoProxyCandidateObservationRequest> {
	const raw = closedDataRecord(value, [
		'original', 'identity', 'originalSourceId', 'signal', 'assertCurrent',
	], ['original', 'identity', 'originalSourceId', 'assertCurrent'], 'video proxy candidate observation request');
	if (typeof raw.assertCurrent !== 'function') {
		throw new TypeError('Video proxy candidate observation assertCurrent must be a function.');
	}
	if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
		throw new TypeError('Video proxy candidate observation signal must be an AbortSignal.');
	}
	return Object.freeze({
		original: raw.original as Blob,
		identity: captureOriginalIdentity(raw.identity),
		originalSourceId: nonEmptyString(raw.originalSourceId, 'video proxy candidate originalSourceId'),
		...(raw.signal ? { signal: raw.signal as AbortSignal } : {}),
		assertCurrent: raw.assertCurrent as () => void,
	});
}

function captureOriginalIdentity(value: unknown): VideoProxyCandidateOriginalIdentity {
	const keys = [
		'authority', 'projectId', 'sourceId', 'storageKey', 'mimeType',
		'byteLength', 'sha256', 'generationToken',
	] as const;
	const raw = closedDataRecord(value, keys, keys, 'video proxy original identity');
	if (raw.authority !== 'owned' && raw.authority !== 'linked') {
		throw new RangeError('Video proxy original authority must be owned or linked.');
	}
	const sha256 = nonEmptyString(raw.sha256, 'video proxy original sha256');
	if (!SHA256.test(sha256)) throw new TypeError('Video proxy original sha256 is invalid.');
	return Object.freeze({
		authority: raw.authority,
		projectId: nonEmptyString(raw.projectId, 'video proxy original projectId'),
		sourceId: nonEmptyString(raw.sourceId, 'video proxy original sourceId'),
		storageKey: nonEmptyString(raw.storageKey, 'video proxy original storageKey'),
		mimeType: videoMimeType(raw.mimeType, 'video proxy original mimeType'),
		byteLength: positiveSafeInteger(raw.byteLength, 'video proxy original byteLength'),
		sha256,
		generationToken: nonEmptyString(raw.generationToken, 'video proxy original generationToken'),
	});
}

function assertCurrent(request: Readonly<VideoProxyCandidateObservationRequest>): void {
	throwIfAborted(request.signal);
	request.assertCurrent();
	throwIfAborted(request.signal);
}

function privateProxySourceId(originalSourceId: string, sha256: string): string {
	const candidate = `video-proxy-observation-${sha256.slice(0, 24)}`;
	return candidate === originalSourceId ? `${candidate}-candidate` : candidate;
}

function denseDataArray(value: unknown, name: string, maximumLength: number): readonly unknown[] {
	if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
		throw new TypeError(`${name} must be a standard dense array.`);
	}
	const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
	const length = lengthDescriptor?.value;
	if (!Number.isSafeInteger(length) || Number(length) < 0) throw new TypeError(`${name} length is invalid.`);
	if (Number(length) > maximumLength) {
		throw new RangeError(`${name} exceed their maximum of ${String(maximumLength)}.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== Number(length) + 1) throw new TypeError(`${name} must be dense without extra properties.`);
	const result: unknown[] = [];
	for (let index = 0; index < Number(length); index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function closedDataRecord(
	value: unknown,
	allowed: readonly (string | symbol)[],
	required: readonly (string | symbol)[],
	name: string,
): Record<string | symbol, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a closed object.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} must be a closed object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => !allowed.includes(key)) || required.some((key) => !keys.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	const result: Record<string | symbol, unknown> = {};
	for (const key of keys) {
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}.${String(key)} must be an enumerable data property, not an accessor.`);
		}
		result[key] = descriptor.value;
	}
	return result;
}

function boundedIdentifier(value: unknown, name: string): string {
	const result = nonEmptyString(value, name);
	if (!IDENTIFIER.test(result) || result.includes('/') || result.includes('\\')) {
		throw new TypeError(`${name} must be a printable pathless identifier of at most 128 characters.`);
	}
	return result;
}

function videoMimeType(value: unknown, name: string): string {
	const result = nonEmptyString(value, name);
	if (result.length > 128 || !/^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u.test(result)) {
		throw new TypeError(`${name} is invalid.`);
	}
	return result;
}

function nonEmptyString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be a non-empty string.`);
	return value;
}

function positiveSafeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) {
		throw new RangeError(`${name} must be a positive safe integer.`);
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video proxy candidate observation was cancelled.', 'AbortError');
}
