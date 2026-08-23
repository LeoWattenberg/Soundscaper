/* SPDX-License-Identifier: AGPL-3.0-only */
import { validateAudioEditorProjectV17 } from './project-v17-validation.ts';
import { parseScapeProjectDocument, serializeScapeProjectDocument } from './scape-project-document.ts';
import { snapshotVideoProxyProject } from './video-proxy-project-snapshot.ts';
import {
	assertVideoProxyCandidateObserver,
	consumeVideoProxyCandidateObservation,
	observeVideoProxyCandidate,
	type VideoProxyCandidateObserver,
	type VideoProxyCandidateOriginalIdentity,
} from './video-proxy-candidate-observation.ts';
import {
	proveVideoProxyTimingConformance,
	videoProxyTimingConformanceInfo,
} from './video-proxy-timing-conformance.ts';
import {
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingView,
} from './video-source-timing-view.ts';
import {
	videoProxyScalarFingerprint as scalarFingerprint,
	videoProxyTimelineOwnership as timelineOwnership,
	videoProxyTimingFingerprint as timingFingerprint,
} from './video-proxy-relationship-fingerprint.ts';
import {
	captureVideoProxyOriginalLease,
	releaseVideoProxyOriginalLease,
	sameVideoProxyOriginalIdentity,
	type CapturedVideoProxyOriginalLease,
} from './video-proxy-relationship-lease.ts';
import {
	closedDataRecord,
	dataArrayProperty,
	dataProperty,
	dataRecord,
	deepFreeze,
	nonEmptyString,
	positiveSafeInteger,
} from './video-proxy-relationship-values.ts';
import type { VideoTimingAssetPublication } from './video-timing-asset.ts';
type Awaitable<Value> = PromiseLike<Value> | Value;
export interface VideoProxyOriginalObservationRequest {
	readonly projectId: string; readonly sourceId: string; readonly storageKey: string;
	readonly mimeType: string; readonly contentSha256: string; readonly signal?: AbortSignal;
}
export interface VideoProxyOriginalLease {
	readonly blob: Blob; readonly fingerprint: VideoProxyCandidateOriginalIdentity;
	assertCurrent(): void; release(): Awaitable<void>;
}
export interface VideoProxyRelationshipAuthorityDependencies {
	readonly getProject: () => unknown; readonly captureTask: () => unknown;
	readonly assertTaskCurrent: (token: unknown) => void;
	readonly resolveOriginalTiming: (source: Readonly<Record<string, unknown>>) => BoundVideoSourceTimingView;
	readonly observeOriginal: (request: Readonly<VideoProxyOriginalObservationRequest>) => Awaitable<VideoProxyOriginalLease>;
	readonly candidateObserver: VideoProxyCandidateObserver;
}
export interface VideoProxyRelationshipAuthority { readonly kind: 'video-proxy-relationship-authority'; readonly version: 1 }
export interface VideoProxyRelationship { readonly kind: 'video-proxy-relationship'; readonly version: 1 }
export interface VideoProxyRelationshipRequest { readonly sourceId: string; readonly signal?: AbortSignal }
export interface PreparedVideoProxyRelationship { readonly relationship: VideoProxyRelationship; readonly candidate: Blob }
/** @internal Opaque fresh-original lease held only by atomic Framescaper adoption. */
export interface VideoProxyRelationshipAdoptionLease {
	readonly kind: 'video-proxy-relationship-adoption-lease'; readonly version: 1;
}
/** @internal One-use material retained only for the later Framescaper adoption owner. */
export interface VideoProxyRelationshipPreparationMaterial {
	readonly relationship: VideoProxyRelationship;
	readonly candidate: Blob;
	readonly timingPublication: VideoTimingAssetPublication;
	readonly info: VideoProxyRelationshipInfo;
}
export interface VideoProxyRelationshipInfo {
	readonly kind: 'video-proxy-relationship'; readonly version: 1;
	readonly rule: 'exact-original-generation-proxy-content-and-timing-v1';
	readonly projectId: string; readonly originalSourceId: string; readonly originalSha256: string;
	readonly originalAuthorityKind: 'owned' | 'linked';
	readonly candidateSha256: string; readonly candidateByteLength: number; readonly candidateMimeType: string;
	readonly generatorId: string; readonly generatorVersion: number;
	readonly recipeId: string; readonly recipeVersion: number; readonly timingBackendId: string;
	readonly timingRule: 'exact-presentation-boundaries-v1';
	readonly frameCount: number; readonly boundaryCount: number;
	readonly audioPolicy: 'ignore-proxy-container-audio-v1';
}
interface AuthorityState {
	readonly id: number; readonly getProject: () => unknown; readonly captureTask: () => unknown;
	readonly assertTaskCurrent: (token: unknown) => void;
	readonly resolveOriginalTiming: (source: Readonly<Record<string, unknown>>) => BoundVideoSourceTimingView;
	readonly observeOriginal: (request: Readonly<VideoProxyOriginalObservationRequest>) => Awaitable<VideoProxyOriginalLease>;
	readonly candidateObserver: VideoProxyCandidateObserver;
}
interface RelationshipState {
	readonly authorityId: number; readonly info: VideoProxyRelationshipInfo; readonly targetFingerprint: string;
	readonly originalIdentity: VideoProxyCandidateOriginalIdentity;
}
interface AdoptionState {
	readonly authority: AuthorityState; readonly relationship: RelationshipState;
	readonly target: TargetSnapshot; readonly task: unknown; readonly signal?: AbortSignal;
	readonly lease: CapturedVideoProxyOriginalLease;
}
interface TargetSnapshot {
	readonly projectId: string; readonly sourceId: string; readonly storageKey: string; readonly mimeType: string;
	readonly contentSha256: string; readonly timing: BoundVideoSourceTimingView;
	readonly structuralFingerprint: string; readonly fingerprint: string;
}
const AUTHORITIES = new WeakMap<object, AuthorityState>();
const RELATIONSHIPS = new WeakMap<object, RelationshipState>();
const PREPARATIONS = new WeakMap<object, VideoProxyRelationshipPreparationMaterial>();
const ADOPTIONS = new WeakMap<object, AdoptionState>();
const SHA256 = /^[a-f0-9]{64}$/u;
const NO_FAILURE = Symbol('no video proxy relationship failure');
let nextAuthorityId = 0;
/** Capture trusted relationship dependencies as an opaque process-local authority. */
export function createVideoProxyRelationshipAuthority(
	dependenciesValue: VideoProxyRelationshipAuthorityDependencies): VideoProxyRelationshipAuthority {
	const dependencies = closedDataRecord(dependenciesValue, [
		'getProject', 'captureTask', 'assertTaskCurrent', 'resolveOriginalTiming',
		'observeOriginal', 'candidateObserver',
	], 'video proxy relationship dependencies');
	for (const key of [
		'getProject', 'captureTask', 'assertTaskCurrent', 'resolveOriginalTiming', 'observeOriginal',
	] as const) {
		if (typeof dependencies[key] !== 'function') {
			throw new TypeError(`Video proxy relationship ${key} must be a function.`);
		}
	}
	const candidateObserver = assertVideoProxyCandidateObserver(dependencies.candidateObserver);
	const target = Object.freeze({ ...dependencies, candidateObserver });
	const invoke = <Arguments extends readonly unknown[], Result>(key: string) => {
		const method = dependencies[key] as (...values: Arguments) => Result;
		return (...values: Arguments): Result => Reflect.apply(method, target, values) as Result;
	};
	const authority: VideoProxyRelationshipAuthority = Object.freeze({
		kind: 'video-proxy-relationship-authority',
		version: 1,
	});
	AUTHORITIES.set(authority, Object.freeze({
		id: ++nextAuthorityId,
		getProject: invoke<[], unknown>('getProject'),
		captureTask: invoke<[], unknown>('captureTask'),
		assertTaskCurrent: invoke<[unknown], void>('assertTaskCurrent'),
		resolveOriginalTiming: invoke<[Readonly<Record<string, unknown>>], BoundVideoSourceTimingView>('resolveOriginalTiming'),
		observeOriginal: invoke<[Readonly<VideoProxyOriginalObservationRequest>], Awaitable<VideoProxyOriginalLease>>('observeOriginal'),
		candidateObserver,
	}));
	return authority;
}
/** Admit the target synchronously, then generate and prove one exact proxy relationship. */
export function proveVideoProxyRelationship(
	authorityValue: VideoProxyRelationshipAuthority, requestValue: VideoProxyRelationshipRequest,
): Promise<PreparedVideoProxyRelationship> {
	const authority = authorityState(authorityValue);
	const request = captureRequest(requestValue);
	throwIfAborted(request.signal);
	const task = authority.captureTask();
	authority.assertTaskCurrent(task);
	const target = captureTarget(authority, request.sourceId);
	authority.assertTaskCurrent(task);
	return proveVideoProxyRelationshipAsync(authority, target, task, request);
}
/** Recheck one authentic process proof against current project, timing, and original authority. */
export function assertVideoProxyRelationshipCurrent(
	authorityValue: VideoProxyRelationshipAuthority,
	relationshipValue: VideoProxyRelationship,
	requestValue: VideoProxyRelationshipRequest,
): Promise<void> {
	const authority = authorityState(authorityValue);
	const relationship = relationshipState(relationshipValue);
	if (relationship.authorityId !== authority.id) {
		throw new TypeError('The video proxy relationship belongs to a different authority.');
	}
	const request = captureRequest(requestValue);
	throwIfAborted(request.signal);
	if (request.sourceId !== relationship.info.originalSourceId) {
		throw new RangeError('The video proxy relationship source identity changed.');
	}
	const task = authority.captureTask();
	authority.assertTaskCurrent(task);
	const target = captureTarget(authority, request.sourceId);
	authority.assertTaskCurrent(task);
	if (target.fingerprint !== relationship.targetFingerprint) {
		throw new Error('The video proxy relationship target is no longer current.');
	}
	return assertVideoProxyRelationshipCurrentAsync(
		authority,
		relationship,
		target,
		task,
		request,
	);
}
/** Read diagnostic facts only from a live relationship proof identity. */
export function videoProxyRelationshipInfo(relationshipValue: VideoProxyRelationship): VideoProxyRelationshipInfo {
	return relationshipState(relationshipValue).info;
}
/** @internal Consume preparation-only bytes without exposing them through the public proof. */
export function consumePreparedVideoProxyRelationship(
	preparationValue: PreparedVideoProxyRelationship,
): VideoProxyRelationshipPreparationMaterial {
	if (!preparationValue || typeof preparationValue !== 'object') {
		throw new TypeError('An authenticated video proxy relationship preparation is required.');
	}
	const material = PREPARATIONS.get(preparationValue);
	if (!material) {
		throw new TypeError('An authenticated unconsumed video proxy relationship preparation is required.');
	}
	PREPARATIONS.delete(preparationValue);
	return material;
}
/** @internal Capture and hold the relationship authority's fresh exact original lease. */
export async function captureVideoProxyRelationshipAdoptionLease(
	authorityValue: VideoProxyRelationshipAuthority,
	relationshipValue: VideoProxyRelationship,
	requestValue: VideoProxyRelationshipRequest,
): Promise<VideoProxyRelationshipAdoptionLease> {
	const authority = authorityState(authorityValue);
	const relationship = relationshipState(relationshipValue);
	if (relationship.authorityId !== authority.id) throw new TypeError('The relationship belongs to a different authority.');
	const request = captureRequest(requestValue);
	if (request.sourceId !== relationship.info.originalSourceId) throw new RangeError('The adoption source identity changed.');
	throwIfAborted(request.signal);
	const task = authority.captureTask(); authority.assertTaskCurrent(task);
	const target = captureTarget(authority, request.sourceId);
	if (target.fingerprint !== relationship.targetFingerprint) throw new Error('The adoption target is stale.');
	let lease: CapturedVideoProxyOriginalLease | null = null;
	try {
		lease = await captureVideoProxyOriginalLease(await authority.observeOriginal(originalRequest(target, request.signal)));
		assertOperationCurrent(authority, task, request.signal, lease);
		assertOriginalMatchesTarget(lease, target);
		if (!sameVideoProxyOriginalIdentity(lease.fingerprint, relationship.originalIdentity)) {
			throw new Error('The adoption original generation is stale.');
		}
		const token = Object.freeze({ kind: 'video-proxy-relationship-adoption-lease', version: 1 }) as VideoProxyRelationshipAdoptionLease;
		ADOPTIONS.set(token, { authority, relationship, target, task, lease, ...(request.signal ? { signal: request.signal } : {}) });
		return token;
	} catch (error) {
		const cleanup = await releaseVideoProxyOriginalLease(lease, NO_FAILURE);
		if (cleanup !== NO_FAILURE) throw new AggregateError([error, cleanup], 'Adoption lease capture and cleanup failed.', { cause: error });
		throw error;
	}
}
/** @internal Reassert target, task, relationship, and held original generation. */
export function assertVideoProxyRelationshipAdoptionCurrent(value: VideoProxyRelationshipAdoptionLease): void {
	const state = adoptionState(value);
	assertOperationCurrent(state.authority, state.task, state.signal, state.lease);
	const current = recaptureTarget(state.authority, state.target.sourceId);
	assertOperationCurrent(state.authority, state.task, state.signal, state.lease);
	if (current.fingerprint !== state.target.fingerprint
		|| current.fingerprint !== state.relationship.targetFingerprint) throw new Error('The adoption target is stale.');
}
/** @internal Release the fresh original generation exactly once. */
export async function releaseVideoProxyRelationshipAdoptionLease(value: VideoProxyRelationshipAdoptionLease): Promise<void> {
	const state = adoptionState(value); ADOPTIONS.delete(value); await state.lease.release();
}
async function proveVideoProxyRelationshipAsync(
	authority: AuthorityState,
	target: TargetSnapshot,
	task: unknown,
	request: Readonly<VideoProxyRelationshipRequest>,
): Promise<PreparedVideoProxyRelationship> {
	let lease: CapturedVideoProxyOriginalLease | null = null;
	let result: PreparedVideoProxyRelationship | undefined;
	let preparationMaterial: VideoProxyRelationshipPreparationMaterial | undefined;
	let issuedRelationship: VideoProxyRelationship | null = null;
	let failure: unknown = NO_FAILURE;
	try {
		const rawLease = await authority.observeOriginal(originalRequest(target, request.signal));
		lease = await captureVideoProxyOriginalLease(rawLease);
		const activeLease = lease;
		assertOperationCurrent(authority, task, request.signal, activeLease);
		assertOriginalMatchesTarget(activeLease, target);
		const observation = await observeVideoProxyCandidate(authority.candidateObserver, {
			original: activeLease.blob,
			identity: activeLease.fingerprint,
			originalSourceId: target.sourceId,
			...(request.signal ? { signal: request.signal } : {}),
			assertCurrent: () => assertOperationCurrent(authority, task, request.signal, activeLease),
		});
		const candidate = consumeVideoProxyCandidateObservation(observation);
		assertOperationCurrent(authority, task, request.signal, activeLease);
		const timingProof = proveVideoProxyTimingConformance(target.timing, candidate.timing);
		const current = recaptureTarget(authority, target.sourceId);
		authority.assertTaskCurrent(task);
		activeLease.assertCurrent();
		const finalStructure = captureTargetStructure(authority, target.sourceId);
		throwIfAborted(request.signal);
		if (current.fingerprint !== target.fingerprint
			|| finalStructure.structuralFingerprint !== target.structuralFingerprint) {
			throw new Error('The video proxy relationship target changed during final validation.');
		}
		const timingInfo = videoProxyTimingConformanceInfo(timingProof);
		const info: VideoProxyRelationshipInfo = Object.freeze({
			kind: 'video-proxy-relationship',
			version: 1,
			rule: 'exact-original-generation-proxy-content-and-timing-v1',
			projectId: target.projectId,
			originalSourceId: target.sourceId,
			originalSha256: nonNullable(lease).fingerprint.sha256,
			originalAuthorityKind: nonNullable(lease).fingerprint.authority,
			candidateSha256: candidate.sha256,
			candidateByteLength: candidate.byteLength,
			candidateMimeType: candidate.mimeType,
			generatorId: candidate.generatorId,
			generatorVersion: candidate.generatorVersion,
			recipeId: candidate.recipeId,
			recipeVersion: candidate.recipeVersion,
			timingBackendId: candidate.timingBackendId,
			timingRule: timingInfo.rule,
			frameCount: timingInfo.frameCount,
			boundaryCount: timingInfo.boundaryCount,
			audioPolicy: 'ignore-proxy-container-audio-v1',
		});
		const relationship: VideoProxyRelationship = Object.freeze({
			kind: 'video-proxy-relationship',
			version: 1,
		});
		RELATIONSHIPS.set(relationship, Object.freeze({
			authorityId: authority.id,
			info,
			targetFingerprint: target.fingerprint,
			originalIdentity: activeLease.fingerprint,
		}));
		issuedRelationship = relationship;
		result = Object.freeze({ relationship, candidate: candidate.candidate });
		preparationMaterial = Object.freeze({
			relationship,
			candidate: candidate.candidate,
			timingPublication: candidate.timingPublication,
			info,
		});
	} catch (error) {
		failure = error;
	}
	const cleanupFailure = await releaseVideoProxyOriginalLease(lease, NO_FAILURE);
	try {
		assertCompletion(authority, task, request.signal, failure, cleanupFailure);
		if (captureCompletionTarget(authority, task, request.signal, target.sourceId).fingerprint !== target.fingerprint) {
			throw new Error('The video proxy relationship target changed during completion.');
		}
	} catch (error) {
		if (issuedRelationship) RELATIONSHIPS.delete(issuedRelationship);
		throw error;
	}
	const prepared = nonNullable(result);
	PREPARATIONS.set(prepared, nonNullable(preparationMaterial));
	return prepared;
}
async function assertVideoProxyRelationshipCurrentAsync(
	authority: AuthorityState,
	relationship: RelationshipState, target: TargetSnapshot, task: unknown,
	request: Readonly<VideoProxyRelationshipRequest>,
): Promise<void> {
	let lease: CapturedVideoProxyOriginalLease | null = null;
	let failure: unknown = NO_FAILURE;
	try {
		lease = await captureVideoProxyOriginalLease(await authority.observeOriginal(originalRequest(target, request.signal)));
		assertOperationCurrent(authority, task, request.signal, lease);
		assertOriginalMatchesTarget(lease, target);
		if (!sameVideoProxyOriginalIdentity(lease.fingerprint, relationship.originalIdentity)) {
			throw new Error('The video proxy relationship original fingerprint is stale.');
		}
		const current = recaptureTarget(authority, target.sourceId);
		authority.assertTaskCurrent(task);
		lease.assertCurrent();
		const finalStructure = captureTargetStructure(authority, target.sourceId);
		throwIfAborted(request.signal);
		if (current.fingerprint !== relationship.targetFingerprint
			|| finalStructure.structuralFingerprint !== target.structuralFingerprint) {
			throw new Error('The video proxy relationship target is no longer current.');
		}
	} catch (error) {
		failure = error;
	}
	const cleanupFailure = await releaseVideoProxyOriginalLease(lease, NO_FAILURE);
	assertCompletion(authority, task, request.signal, failure, cleanupFailure);
	if (captureCompletionTarget(authority, task, request.signal, target.sourceId).fingerprint
		!== relationship.targetFingerprint) {
		throw new Error('The video proxy relationship target changed during completion.');
	}
}
function captureTarget(authority: AuthorityState, sourceId: string): TargetSnapshot {
	const captured = captureTargetStructure(authority, sourceId);
	const timing = authority.resolveOriginalTiming(captured.source);
	const timingInfo = boundVideoSourceTimingViewInfo(timing);
	if (timingInfo.sourceId !== captured.sourceId || timingInfo.frameCount !== captured.sourceFrameCount) {
		throw new RangeError('The authentic original timing token disagrees with the proxy target source.');
	}
	const timingHash = timingFingerprint(timing);
	const afterResolver = captureTargetStructure(authority, sourceId);
	if (afterResolver.structuralFingerprint !== captured.structuralFingerprint) {
		throw new Error('The video proxy target changed during timing resolution.');
	}
	return Object.freeze({
		projectId: captured.projectId, sourceId: captured.sourceId, storageKey: captured.storageKey,
		mimeType: captured.mimeType, contentSha256: captured.contentSha256, timing,
		structuralFingerprint: captured.structuralFingerprint,
		fingerprint: scalarFingerprint(captured.structuralFingerprint, timingHash),
	});
}
interface TargetStructure {
	readonly projectId: string; readonly source: Readonly<Record<string, unknown>>;
	readonly sourceId: string; readonly sourceFrameCount: number;
	readonly storageKey: string; readonly mimeType: string; readonly contentSha256: string;
	readonly structuralFingerprint: string;
}
function captureTargetStructure(authority: AuthorityState, sourceId: string): TargetStructure {
	const projectValue = snapshotVideoProxyProject(authority.getProject());
	validateAudioEditorProjectV17(projectValue);
	const project = projectValue as Record<string, unknown>;
	const projectId = nonEmptyString(dataProperty(project, 'id', 'project'), 'project.id');
	const sources = dataArrayProperty(project, 'sources', 'project.sources');
	for (const source of sources) {
		if (Object.hasOwn(dataRecord(source, 'project source'), 'proxyAttachment')) {
			throw new TypeError('Exact V17 proxy relationship sources reserve proxyAttachment for V18.');
		}
	}
	const matchingSources = sources.filter((source) => (
		nonEmptyString(dataProperty(dataRecord(source, 'project source'), 'id', 'project source'), 'source.id')
		=== sourceId
	));
	if (matchingSources.length !== 1) throw new ReferenceError('The video proxy target source is missing or duplicated.');
	const sourceValue = dataRecord(matchingSources[0], 'video proxy target source');
	if (dataProperty(sourceValue, 'kind', 'video proxy target source') !== 'video') {
		throw new TypeError('Video proxy relationships require a video source.');
	}
	const timelineClips = dataArrayProperty(project, 'clips', 'project.clips');
	const projectBin = dataRecord(dataProperty(project, 'projectBin', 'project'), 'project.projectBin');
	const binClips = dataArrayProperty(projectBin, 'clips', 'project.projectBin.clips');
	const tracks = dataArrayProperty(project, 'tracks', 'project.tracks');
	const sequences = dataArrayProperty(project, 'sequences', 'project.sequences');
	const ownership = timelineOwnership(tracks, sequences);
	const occurrences: Record<string, unknown>[] = [];
	captureOccurrences(timelineClips, 'timeline', sourceId, ownership, occurrences);
	captureOccurrences(binClips, 'project-bin', sourceId, ownership, occurrences);
	const structural = serializeScapeProjectDocument({
		schemaVersion: 17,
		projectId,
		source: sourceValue,
		occurrences,
	});
	const decoded = dataRecord(parseScapeProjectDocument(structural), 'captured video proxy target');
	const source = dataRecord(dataProperty(decoded, 'source', 'captured video proxy target'), 'captured source');
	const capturedSourceId = nonEmptyString(dataProperty(source, 'id', 'captured source'), 'captured source.id');
	const storageKey = nonEmptyString(dataProperty(source, 'storageKey', 'captured source'), 'captured source.storageKey');
	const mimeType = videoMimeType(dataProperty(source, 'mimeType', 'captured source'));
	const contentSha256 = sha256Digest(dataProperty(source, 'contentSha256', 'captured source'));
	return Object.freeze({
		projectId, source: deepFreeze(source),
		sourceId: capturedSourceId,
		sourceFrameCount: positiveSafeInteger(dataProperty(source, 'sourceFrameCount', 'captured source'),
			'captured source.sourceFrameCount'),
		storageKey,
		mimeType,
		contentSha256,
		structuralFingerprint: scalarFingerprint(structural),
	});
}
function recaptureTarget(authority: AuthorityState, sourceId: string): TargetSnapshot {
	try {
		return captureTarget(authority, sourceId);
	} catch (cause) {
		throw new Error('The video proxy relationship target changed or became invalid.', { cause });
	}
}
function captureCompletionTarget(
	authority: AuthorityState, task: unknown, signal: AbortSignal | undefined, sourceId: string,
): TargetSnapshot {
	const target = recaptureTarget(authority, sourceId);
	authority.assertTaskCurrent(task);
	const structure = captureTargetStructure(authority, sourceId);
	throwIfAborted(signal);
	if (structure.structuralFingerprint !== target.structuralFingerprint) throw new Error('Target changed during completion.');
	return target;
}
function captureOccurrences(
	clips: readonly unknown[],
	store: 'timeline' | 'project-bin',
	sourceId: string,
	ownersByClip: ReadonlyMap<string, readonly Record<string, string>[]>,
	result: Record<string, unknown>[],
): void {
	for (let index = 0; index < clips.length; index += 1) {
		const clip = dataRecord(clips[index], `${store} clip`);
		if (dataProperty(clip, 'sourceId', `${store} clip`) !== sourceId) continue;
		const clipId = nonEmptyString(dataProperty(clip, 'id', `${store} clip`), `${store} clip.id`);
		result.push({
			store,
			index,
			clip,
			owners: store === 'timeline' ? ownersByClip.get(clipId) ?? [] : [],
		});
	}
}
function assertOriginalMatchesTarget(lease: CapturedVideoProxyOriginalLease, target: TargetSnapshot): void {
	lease.assertCurrent();
	const identity = lease.fingerprint;
	if (identity.projectId !== target.projectId || identity.sourceId !== target.sourceId
		|| identity.storageKey !== target.storageKey || identity.mimeType !== target.mimeType
		|| identity.sha256 !== target.contentSha256) {
		throw new Error('The observed original fingerprint disagrees with the video proxy target.');
	}
}
function originalRequest(
	target: TargetSnapshot,
	signal?: AbortSignal,
): Readonly<VideoProxyOriginalObservationRequest> {
	return Object.freeze({
		projectId: target.projectId,
		sourceId: target.sourceId,
		storageKey: target.storageKey,
		mimeType: target.mimeType,
		contentSha256: target.contentSha256,
		...(signal ? { signal } : {}),
	});
}
function assertOperationCurrent(
	authority: AuthorityState,
	task: unknown,
	signal: AbortSignal | undefined,
	lease: CapturedVideoProxyOriginalLease,
): void {
	throwIfAborted(signal);
	authority.assertTaskCurrent(task);
	lease.assertCurrent();
	throwIfAborted(signal);
}
function assertCompletion(
	authority: AuthorityState,
	task: unknown,
	signal: AbortSignal | undefined,
	failure: unknown,
	cleanupFailure: unknown,
): void {
	throwIfAborted(signal);
	authority.assertTaskCurrent(task);
	if (failure !== NO_FAILURE && cleanupFailure !== NO_FAILURE) {
		throw new AggregateError([failure, cleanupFailure], 'Video proxy operation and cleanup both failed.');
	}
	if (failure !== NO_FAILURE) throw failure;
	if (cleanupFailure !== NO_FAILURE) throw cleanupFailure;
}
function captureRequest(value: unknown): Readonly<VideoProxyRelationshipRequest> {
	const raw = closedDataRecord(value, ['sourceId', 'signal'], 'video proxy relationship request', ['sourceId']);
	if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
		throw new TypeError('Video proxy relationship signal must be an AbortSignal.');
	}
	return Object.freeze({
		sourceId: nonEmptyString(raw.sourceId, 'video proxy relationship sourceId'),
		...(raw.signal ? { signal: raw.signal as AbortSignal } : {}),
	});
}
function authorityState(value: unknown): AuthorityState {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An authenticated video proxy relationship authority is required.');
	}
	const state = AUTHORITIES.get(value);
	if (!state) throw new TypeError('An authenticated video proxy relationship authority is required.');
	return state;
}
function relationshipState(value: unknown): RelationshipState {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An authenticated video proxy relationship proof is required.');
	}
	const state = RELATIONSHIPS.get(value);
	if (!state) throw new TypeError('An authenticated video proxy relationship proof is required.');
	return state;
}
function adoptionState(value: unknown): AdoptionState {
	if (!value || typeof value !== 'object') throw new TypeError('An authentic adoption lease is required.');
	const state = ADOPTIONS.get(value);
	if (!state) throw new TypeError('The adoption lease is foreign or already released.');
	return state;
}
function sha256Digest(value: unknown): string {
	const result = nonEmptyString(value, 'video proxy SHA-256');
	if (!SHA256.test(result)) throw new TypeError('The video proxy SHA-256 is invalid.');
	return result;
}
function videoMimeType(value: unknown): string {
	const result = nonEmptyString(value, 'video proxy MIME type');
	if (!/^video\/[a-z0-9!#$&^_.+\-]+$/u.test(result)) throw new TypeError('The video proxy MIME type is invalid.');
	return result;
}
function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Video proxy relationship work was cancelled.', 'AbortError');
}
function nonNullable<Value>(value: Value | null | undefined): Value {
	if (value === null || value === undefined) throw new Error('Video proxy relationship result is unavailable.');
	return value;
}
