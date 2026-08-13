/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from '../common/editor/storage/media-content-digest.ts';
import {
	normalizeVideoProxyAttachmentV18,
	type VideoProxyAttachmentV18,
} from '../common/editor/video-proxy-attachment-v18.ts';
import {
	videoProxyScalarFingerprint,
} from '../common/editor/video-proxy-relationship-fingerprint.ts';
import {
	closedDataRecord,
	dataArrayProperty,
	dataProperty,
	dataRecord,
	deepFreeze,
	nonEmptyString,
	positiveSafeInteger,
} from '../common/editor/video-proxy-relationship-values.ts';
import { proveVideoProxyTimingConformance } from '../common/editor/video-proxy-timing-conformance.ts';
import { snapshotVideoProxyProject } from '../common/editor/video-proxy-project-snapshot.ts';
import {
	bindVideoSourceTimingView,
	boundVideoSourceTimingViewInfo,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../common/editor/video-source-timing-view.ts';
import {
	normalizeVideoTimingAssetReference,
	validateVideoTimingAssetBytes,
	VIDEO_TIMING_ASSET_ENCODING,
	VIDEO_TIMING_ASSET_MIME_TYPE,
} from '../common/editor/video-timing-asset.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	validateFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18-validation.ts';
import {
	normalizeFramescaperVideoProxyBodyIdentityV18,
	normalizeFramescaperVideoProxyOriginalIdentityV18,
	type FramescaperVideoProxyBodyIdentityV18,
	type FramescaperVideoProxyBodyLeaseV18,
	type FramescaperVideoProxyBodyRequestV18,
	type FramescaperVideoProxyChoiceV18,
	type FramescaperVideoProxyExpectedBodyV18,
	type FramescaperVideoProxyOriginalIdentityV18,
	type FramescaperVideoProxyOriginalLeaseV18,
	type FramescaperVideoProxyOriginalRequestV18,
	type FramescaperVideoProxyReattestationAuthorityDependenciesV18,
	type FramescaperVideoProxyReattestationAuthorityV18,
	type FramescaperVideoProxyReattestationRequestV18,
	type FramescaperVideoProxyReattestationResultV18,
	type FramescaperVideoProxyTrustV18,
} from './editor-video-proxy-reattestation-contract-v18.ts';

export type {
	FramescaperVideoProxyBodyIdentityV18,
	FramescaperVideoProxyBodyLeaseV18,
	FramescaperVideoProxyBodyRequestV18,
	FramescaperVideoProxyChoiceV18,
	FramescaperVideoProxyExpectedBodyV18,
	FramescaperVideoProxyOriginalIdentityV18,
	FramescaperVideoProxyOriginalLeaseV18,
	FramescaperVideoProxyOriginalRequestV18,
	FramescaperVideoProxyReattestationAuthorityDependenciesV18,
	FramescaperVideoProxyReattestationAuthorityV18,
	FramescaperVideoProxyReattestationRequestV18,
	FramescaperVideoProxyReattestationResultV18,
	FramescaperVideoProxyTrustV18,
} from './editor-video-proxy-reattestation-contract-v18.ts';

type Awaitable<Value> = PromiseLike<Value> | Value;

interface AuthorityStateV18 {
	readonly profile: EditorProjectRuntimeProfile;
	readonly getProject: () => unknown;
	readonly captureTask: () => unknown;
	readonly assertTaskCurrent: (token: unknown) => void;
	readonly acquireBody: FramescaperVideoProxyReattestationAuthorityDependenciesV18['acquireBody'];
	readonly observeOriginal: FramescaperVideoProxyReattestationAuthorityDependenciesV18['observeOriginal'];
}

interface TargetV18 {
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly contentSha256: string;
	readonly sourceFrameCount: number;
	readonly source: Readonly<Record<string, unknown>>;
	readonly attachment: Readonly<VideoProxyAttachmentV18>;
	readonly fingerprint: string;
}

interface CapturedBodyLeaseV18 {
	readonly identity: FramescaperVideoProxyBodyIdentityV18;
	readonly body: Blob;
	assertCurrent(): void;
	release(): Promise<void>;
}

interface CapturedOriginalLeaseV18 {
	readonly identity: Readonly<FramescaperVideoProxyOriginalIdentityV18>;
	readonly timing: BoundVideoSourceTimingView;
	assertCurrent(): void;
	release(): Promise<void>;
}

export interface FramescaperVideoProxyReattestationMaterialV18 {
	readonly choice: Readonly<FramescaperVideoProxyChoiceV18>;
	readonly proxyTiming: BoundVideoSourceTimingView;
}

const AUTHORITIES = new WeakMap<object, AuthorityStateV18>();
const TRUST = new WeakMap<object, FramescaperVideoProxyReattestationMaterialV18>();
const SHA256 = /^[a-f0-9]{64}$/u;
const VIDEO_MIME = /^video\/[a-z0-9][a-z0-9!#$&^_.+\-]*$/u;

export function createFramescaperVideoProxyReattestationAuthorityV18(
	dependenciesValue: FramescaperVideoProxyReattestationAuthorityDependenciesV18,
): FramescaperVideoProxyReattestationAuthorityV18 {
	const dependencies = closedDataRecord(dependenciesValue, [
		'profile', 'getProject', 'captureTask', 'assertTaskCurrent', 'acquireBody', 'observeOriginal',
	], 'Framescaper V18 proxy re-attestation dependencies');
	assertFramescaperProjectV18Profile(dependencies.profile);
	for (const field of [
		'getProject', 'captureTask', 'assertTaskCurrent', 'acquireBody', 'observeOriginal',
	] as const) {
		if (typeof dependencies[field] !== 'function') {
			throw new TypeError(`Framescaper V18 proxy re-attestation ${field} must be a function.`);
		}
	}
	const receiver = Object.freeze({ ...dependencies });
	const invoke = <Arguments extends readonly unknown[], Result>(field: string) => {
		const method = dependencies[field] as (...values: Arguments) => Result;
		return (...values: Arguments): Result => Reflect.apply(method, receiver, values) as Result;
	};
	const authority: FramescaperVideoProxyReattestationAuthorityV18 = Object.freeze({
		kind: 'framescaper-video-proxy-reattestation-authority',
		version: 1,
	});
	AUTHORITIES.set(authority, Object.freeze({
		profile: dependencies.profile,
		getProject: invoke<[], unknown>('getProject'),
		captureTask: invoke<[], unknown>('captureTask'),
		assertTaskCurrent: invoke<[unknown], void>('assertTaskCurrent'),
		acquireBody: invoke<
			[Readonly<FramescaperVideoProxyBodyRequestV18>],
			Awaitable<FramescaperVideoProxyBodyLeaseV18>
		>('acquireBody'),
		observeOriginal: invoke<
			[Readonly<FramescaperVideoProxyOriginalRequestV18>],
			Awaitable<FramescaperVideoProxyOriginalLeaseV18>
		>('observeOriginal'),
	}));
	return authority;
}

export function reattestFramescaperVideoProxyAttachmentV18(
	authorityValue: FramescaperVideoProxyReattestationAuthorityV18 | unknown,
	requestValue: FramescaperVideoProxyReattestationRequestV18 | unknown,
): Promise<Readonly<FramescaperVideoProxyReattestationResultV18>> {
	const authority = authorityState(authorityValue);
	const request = captureRequest(requestValue);
	throwIfAborted(request.signal);
	const task = authority.captureTask();
	authority.assertTaskCurrent(task);
	const target = captureTarget(authority, request.sourceId);
	authority.assertTaskCurrent(task);
	return reattestAsync(authority, target, task, request);
}

/** @internal Authenticate a live token/descriptor pair without inspecting impostor fields. */
export function framescaperVideoProxyReattestationMaterialV18(
	trustValue: unknown,
	choiceValue: unknown,
): Readonly<FramescaperVideoProxyReattestationMaterialV18> | null {
	if (!trustValue || typeof trustValue !== 'object') return null;
	const material = TRUST.get(trustValue);
	if (!material) return null;
	return material.choice === choiceValue ? material : null;
}

async function reattestAsync(
	authority: AuthorityStateV18,
	target: TargetV18,
	task: unknown,
	request: Readonly<FramescaperVideoProxyReattestationRequestV18>,
): Promise<Readonly<FramescaperVideoProxyReattestationResultV18>> {
	let original: CapturedOriginalLeaseV18 | null = null;
	const bodies: CapturedBodyLeaseV18[] = [];
	let choice: Readonly<FramescaperVideoProxyChoiceV18> | null = null;
	let proxyTiming: BoundVideoSourceTimingView | null = null;
	let failure: unknown = null;
	try {
		original = await captureOriginalLease(await authority.observeOriginal(originalRequest(target, request.signal)));
		assertCurrent(authority, task, request.signal, original, bodies);
		assertOriginalMatchesTarget(original, target);
		const proxy = await acquireBody(authority, target, expectedProxy(target), request.signal);
		bodies.push(proxy);
		assertCurrent(authority, task, request.signal, original, bodies);
		await assertBodyBytes(proxy, request.signal);
		assertCurrent(authority, task, request.signal, original, bodies);
		const timing = await acquireBody(authority, target, expectedTiming(target), request.signal);
		bodies.push(timing);
		assertCurrent(authority, task, request.signal, original, bodies);
		const timingIndex = await validateTimingBody(timing, target.attachment, request.signal);
		assertCurrent(authority, task, request.signal, original, bodies);
		proxyTiming = bindProxyTiming(target, timingIndex);
		proveVideoProxyTimingConformance(original.timing, proxyTiming);
		assertCurrent(authority, task, request.signal, original, bodies);
		assertSameTarget(authority, target);
		assertCurrent(authority, task, request.signal, original, bodies);
		choice = deepFreeze({
			kind: 'framescaper-video-proxy-choice' as const,
			version: 1 as const,
			rule: 'existing-attachment-reattested-v1' as const,
			projectId: target.projectId,
			sourceId: target.sourceId,
			proxy: proxy.identity,
			timing: timing.identity,
			original: original.identity,
			audioPolicy: target.attachment.audioPolicy,
		});
	} catch (error) { failure = error; }
	const cleanupFailures = await releaseAll(bodies, original);
	if (failure !== null || cleanupFailures.length > 0) {
		if (failure !== null && cleanupFailures.length > 0) {
			throw new AggregateError([failure, ...cleanupFailures], 'Proxy re-attestation and cleanup failed.', {
				cause: failure,
			});
		}
		if (failure !== null) throw failure;
		throw cleanupFailures[0];
	}
	throwIfAborted(request.signal);
	authority.assertTaskCurrent(task);
	assertSameTarget(authority, target);
	const finalizedChoice = nonNullable(choice);
	const trust: FramescaperVideoProxyTrustV18 = Object.freeze({
		kind: 'framescaper-video-proxy-trust',
		version: 1,
	});
	TRUST.set(trust, Object.freeze({ choice: finalizedChoice, proxyTiming: nonNullable(proxyTiming) }));
	return Object.freeze({ trust, choice: finalizedChoice });
}

async function acquireBody(
	authority: AuthorityStateV18,
	target: TargetV18,
	expected: FramescaperVideoProxyExpectedBodyV18,
	signal?: AbortSignal,
): Promise<CapturedBodyLeaseV18> {
	const request = Object.freeze({
		projectId: target.projectId, sourceId: target.sourceId, role: expected.role, expected,
		...(signal ? { signal } : {}),
	});
	const lease = await captureBodyLease(await authority.acquireBody(request));
	if (!sameExpectedBody(lease.identity, expected)) {
		await lease.release();
		throw new Error(`The ${expected.role} body repository identity disagrees with the attachment.`);
	}
	return lease;
}

async function assertBodyBytes(lease: CapturedBodyLeaseV18, signal?: AbortSignal): Promise<void> {
	lease.assertCurrent();
	if (lease.body.size !== lease.identity.byteLength || lease.body.type !== lease.identity.mimeType) {
		throw new Error('The proxy body Blob disagrees with its exact repository metadata.');
	}
	if (await digestMediaContent(lease.body, { signal }) !== lease.identity.sha256) {
		throw new Error('The proxy body failed its immutable digest binding.');
	}
	lease.assertCurrent();
}

async function validateTimingBody(
	lease: CapturedBodyLeaseV18,
	attachment: Readonly<VideoProxyAttachmentV18>,
	signal?: AbortSignal,
) {
	await assertBodyBytes(lease, signal);
	const buffer = await lease.body.arrayBuffer();
	throwIfAborted(signal);
	lease.assertCurrent();
	return validateVideoTimingAssetBytes(attachment.timingAsset, new Uint8Array(buffer));
}

function bindProxyTiming(target: TargetV18, index: ReturnType<typeof validateVideoTimingAssetBytes>) {
	let proxySourceId = `framescaper-v18-proxy:${target.attachment.sha256}`;
	if (proxySourceId === target.sourceId) proxySourceId = `${proxySourceId}:${target.projectId}`;
	if (proxySourceId === target.sourceId) proxySourceId = `${proxySourceId}:derived`;
	const source = Object.freeze({
		id: proxySourceId,
		kind: 'video',
		contentSha256: target.attachment.sha256,
		frameRate: dataProperty(target.source as Record<string, unknown>, 'frameRate', 'proxy source'),
		sourceFrameCount: target.attachment.frameCount,
		timingAsset: target.attachment.timingAsset,
		timingDecision: Object.freeze({
			mode: 'exact',
			rate: dataProperty(target.source as Record<string, unknown>, 'frameRate', 'proxy source'),
		}),
	});
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'vfr', reference: target.attachment.timingAsset, index,
	});
	return bindVideoSourceTimingView(new Map([[proxySourceId, view]]), source);
}

function captureTarget(authority: AuthorityStateV18, sourceId: string): TargetV18 {
	const snapshot = snapshotVideoProxyProject(authority.getProject());
	validateFramescaperProjectV18(authority.profile, snapshot);
	const project = dataRecord(snapshot, 'Framescaper V18 proxy project') as FramescaperProjectV18;
	const projectId = nonEmptyString(dataProperty(project, 'id', 'Framescaper V18 proxy project'), 'project.id');
	const sources = dataArrayProperty(project, 'sources', 'Framescaper V18 proxy project.sources');
	const matching = sources.filter((value) => dataProperty(
		dataRecord(value, 'Framescaper V18 proxy source'), 'id', 'Framescaper V18 proxy source',
	) === sourceId);
	if (matching.length !== 1) throw new ReferenceError('The attached Framescaper video source is missing or duplicated.');
	const source = dataRecord(matching[0], 'attached Framescaper video source');
	if (dataProperty(source, 'kind', 'attached Framescaper video source') !== 'video') {
		throw new TypeError('Framescaper proxy re-attestation requires a video source.');
	}
	const attachmentValue = dataProperty(source, 'proxyAttachment', 'attached Framescaper video source');
	if (attachmentValue === null) throw new ReferenceError('The Framescaper video source has no proxy attachment.');
	const attachment = normalizeVideoProxyAttachmentV18(attachmentValue);
	return Object.freeze({
		projectId,
		sourceId,
		storageKey: nonEmptyString(dataProperty(source, 'storageKey', 'attached source'), 'source.storageKey'),
		mimeType: videoMime(dataProperty(source, 'mimeType', 'attached source')),
		contentSha256: digest(dataProperty(source, 'contentSha256', 'attached source'), 'attached source'),
		sourceFrameCount: positiveSafeInteger(
			dataProperty(source, 'sourceFrameCount', 'attached source'), 'source.sourceFrameCount',
		),
		source: deepFreeze(source),
		attachment,
		fingerprint: videoProxyScalarFingerprint(serializeScapeProjectDocument(snapshot)),
	});
}

function assertSameTarget(authority: AuthorityStateV18, expected: TargetV18): void {
	let current: TargetV18;
	try { current = captureTarget(authority, expected.sourceId); }
	catch (cause) { throw new Error('The Framescaper proxy target changed or became invalid.', { cause }); }
	if (current.fingerprint !== expected.fingerprint) {
		throw new Error('The Framescaper proxy project or source changed during re-attestation.');
	}
}

function assertOriginalMatchesTarget(original: CapturedOriginalLeaseV18, target: TargetV18): void {
	const identity = original.identity;
	const timing = boundVideoSourceTimingViewInfo(original.timing);
	if (identity.projectId !== target.projectId || identity.sourceId !== target.sourceId
		|| identity.storageKey !== target.storageKey || identity.mimeType !== target.mimeType
		|| identity.sha256 !== target.contentSha256 || timing.sourceId !== target.sourceId
		|| timing.frameCount !== target.sourceFrameCount) {
		throw new Error('The trusted original identity or timing disagrees with the attached source.');
	}
}

function assertCurrent(
	authority: AuthorityStateV18,
	task: unknown,
	signal: AbortSignal | undefined,
	original: CapturedOriginalLeaseV18,
	bodies: readonly CapturedBodyLeaseV18[],
): void {
	throwIfAborted(signal);
	authority.assertTaskCurrent(task);
	original.assertCurrent();
	for (const body of bodies) body.assertCurrent();
	throwIfAborted(signal);
}

async function captureBodyLease(value: unknown): Promise<CapturedBodyLeaseV18> {
	return captureLease(value, 'body', (raw) => ({
		identity: normalizeFramescaperVideoProxyBodyIdentityV18(raw.identity),
		body: canonicalMediaContentBlob(raw.body),
	}));
}

async function captureOriginalLease(value: unknown): Promise<CapturedOriginalLeaseV18> {
	return captureLease(value, 'original', (raw) => {
		const timing = raw.timing as BoundVideoSourceTimingView;
		boundVideoSourceTimingViewInfo(timing);
		return { identity: normalizeFramescaperVideoProxyOriginalIdentityV18(raw.identity), timing };
	});
}

async function captureLease<Value extends Record<string, unknown>>(
	value: unknown,
	name: 'body' | 'original',
	capture: (raw: Record<string, unknown>) => Value,
): Promise<Value & Readonly<{ assertCurrent(): void; release(): Promise<void> }>> {
	if (!value || typeof value !== 'object') throw new TypeError(`A proxy ${name} lease is required.`);
	const receiver = value;
	const releaseDescriptor = Object.getOwnPropertyDescriptor(value, 'release');
	const releaseValue = releaseDescriptor && Object.hasOwn(releaseDescriptor, 'value')
		? releaseDescriptor.value : null;
	let released = false;
	const release = async (): Promise<void> => {
		if (released) return;
		released = true;
		if (typeof releaseValue !== 'function') throw new TypeError(`A proxy ${name} lease requires release().`);
		await Reflect.apply(releaseValue, receiver, []) as Awaitable<void>;
	};
	try {
		const fields = name === 'body'
			? ['identity', 'body', 'assertCurrent', 'release']
			: ['identity', 'timing', 'assertCurrent', 'release'];
		const raw = closedDataRecord(value, fields, `Framescaper V18 proxy ${name} lease`);
		if (typeof raw.assertCurrent !== 'function' || raw.release !== releaseValue) {
			throw new TypeError(`A proxy ${name} lease requires stable currentness and release functions.`);
		}
		const captured = capture(raw);
		const assertCurrent = raw.assertCurrent as () => void;
		return Object.freeze({
			...captured,
			assertCurrent: () => { Reflect.apply(assertCurrent, receiver, []); },
			release,
		});
	} catch (error) {
		try { await release(); }
		catch (cleanup) {
			throw new AggregateError([error, cleanup], `Proxy ${name} lease validation and cleanup failed.`, {
				cause: error,
			});
		}
		throw error;
	}
}

async function releaseAll(
	bodies: readonly CapturedBodyLeaseV18[],
	original: CapturedOriginalLeaseV18 | null,
): Promise<unknown[]> {
	const errors: unknown[] = [];
	for (const lease of [...bodies].reverse()) {
		try { await lease.release(); } catch (error) { errors.push(error); }
	}
	if (original) {
		try { await original.release(); } catch (error) { errors.push(error); }
	}
	return errors;
}

function expectedProxy(target: TargetV18): FramescaperVideoProxyExpectedBodyV18 {
	return Object.freeze({
		role: 'proxy', kind: 'video-proxy', encoding: 'video-proxy-v1',
		storageKey: target.attachment.storageKey, mimeType: target.attachment.mimeType,
		byteLength: target.attachment.byteLength, sha256: target.attachment.sha256,
	});
}

function expectedTiming(target: TargetV18): FramescaperVideoProxyExpectedBodyV18 {
	const reference = normalizeVideoTimingAssetReference(target.attachment.timingAsset);
	return Object.freeze({
		role: 'timing', kind: 'video-timing', encoding: VIDEO_TIMING_ASSET_ENCODING,
		storageKey: reference.storageKey, mimeType: VIDEO_TIMING_ASSET_MIME_TYPE,
		byteLength: reference.byteLength, sha256: reference.sha256,
		frameCount: reference.frameCount, timescale: reference.timescale,
		finalFrameDurationTicks: reference.finalFrameDurationTicks,
	});
}

function sameExpectedBody(
	identity: FramescaperVideoProxyBodyIdentityV18,
	expected: FramescaperVideoProxyExpectedBodyV18,
): boolean {
	const { generationToken: _generation, ...settled } = identity;
	return JSON.stringify(settled) === JSON.stringify(expected);
}

function originalRequest(target: TargetV18, signal?: AbortSignal) {
	return Object.freeze({
		projectId: target.projectId, sourceId: target.sourceId, storageKey: target.storageKey,
		mimeType: target.mimeType, contentSha256: target.contentSha256,
		...(signal ? { signal } : {}),
	});
}

function captureRequest(value: unknown): Readonly<FramescaperVideoProxyReattestationRequestV18> {
	const raw = closedDataRecord(value, ['sourceId', 'signal'], 'Framescaper V18 proxy re-attestation request', ['sourceId']);
	if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
		throw new TypeError('The Framescaper V18 proxy re-attestation signal must be an AbortSignal.');
	}
	return Object.freeze({
		sourceId: nonEmptyString(raw.sourceId, 'proxy re-attestation sourceId'),
		...(raw.signal ? { signal: raw.signal as AbortSignal } : {}),
	});
}

function authorityState(value: unknown): AuthorityStateV18 {
	if (!value || typeof value !== 'object') throw new TypeError('An authentic proxy re-attestation authority is required.');
	const state = AUTHORITIES.get(value);
	if (!state) throw new TypeError('An authentic proxy re-attestation authority is required.');
	return state;
}

function digest(value: unknown, name: string): string {
	const result = nonEmptyString(value, `${name} SHA-256`);
	if (!SHA256.test(result)) throw new TypeError(`${name} requires a lowercase SHA-256 digest.`);
	return result;
}

function videoMime(value: unknown): string {
	const result = nonEmptyString(value, 'video source MIME type');
	if (result.length > 128 || !VIDEO_MIME.test(result)) throw new TypeError('The video source MIME type is invalid.');
	return result;
}

function throwIfAborted(signal?: AbortSignal): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	throw new DOMException('Proxy re-attestation was cancelled.', 'AbortError');
}

function nonNullable<Value>(value: Value | null): Value {
	if (value === null) throw new Error('The proxy re-attestation result is unavailable.');
	return value;
}
