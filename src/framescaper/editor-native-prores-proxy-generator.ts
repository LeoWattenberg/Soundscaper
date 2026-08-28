/* SPDX-License-Identifier: AGPL-3.0-only */

/** selected-baseline native ProRes Proxy candidate routed through queue V3. */

import {
	NATIVE_MEDIA_CAPABILITY_IDS,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
} from '../common/editor/native-media-capability-snapshot.ts';
import { canonicalizeNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../common/editor/native-media-plan-envelope-v2.ts';
import type { NativeQueueInputFingerprintV1 } from '../common/editor/native-queue-record.ts';
import { digestMediaContent } from '../common/editor/storage/media-content-digest.ts';
import {
	createVideoProxyCandidateObserver,
	type VideoProxyCandidateGeneratorPort,
	type VideoProxyCandidateObserver,
	type VideoProxyCandidateRecipe,
} from '../common/editor/video-proxy-candidate-observation.ts';
import { createFfmpegVideoTimingProbe, type VideoTimingProbePort } from '../common/editor/video-timing-probe.ts';
import {
	createFramescaperNativeServicesStore,
	resolveFramescaperNativeServicesBridge,
	type FramescaperNativeQueueProjection,
	type FramescaperNativeServicesBridge,
} from '../common/editor/ui/framescaper-native-services-bridge.ts';
import type { FramescaperCapturedVideoProxyRuntimeComposition } from './editor-captured-video-proxy-scheduler-composition.ts';
import {
	FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
	PROJECT_SCHEMA_VERSION,
} from '../common/editor/project-schema-identity.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from './editor-native-render-plan-authority.ts';
import { FRAMESCAPER_NATIVE_MEDIA_RENDER_QUEUE_RESERVATIONS } from './editor-native-render-queue-reservations.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from './editor-project-unified-render-plan-native-media.ts';
import { cloneFramescaperProjectNativeMedia, type FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

const GENERATOR = Object.freeze({ id: 'framescaper-native-media-host', version: 1 });
const RECIPE = Object.freeze({ id: 'framescaper-native-prores-proxy-mov-v1', version: 1 });
const SHA256 = /^[a-f0-9]{64}$/u;
const JOB_ID = /^[a-f0-9]{40}$/u;
const MAXIMUM_PROXY_BYTES = 512 * 1024 ** 2;
const READ_BYTES = 1024 * 1024;

export interface FramescaperNativeProResProxyCandidateOptions {
	readonly profile: unknown;
	readonly getProject: () => unknown;
	readonly composition: FramescaperCapturedVideoProxyRuntimeComposition;
	readonly scope?: unknown;
	readonly waitForPoll?: (signal?: AbortSignal) => Promise<void>;
}

export interface FramescaperNativeProResProxyGeneratorOptions {
	readonly profile: unknown;
	readonly getProject: () => unknown;
	readonly bridge: FramescaperNativeServicesBridge;
	readonly waitForPoll?: (signal?: AbortSignal) => Promise<void>;
}

/** Return null outside the authenticated desktop bridge; never substitute another native recipe. */
export function createFramescaperNativeProResProxyCandidateObserver(
	options: FramescaperNativeProResProxyCandidateOptions,
): VideoProxyCandidateObserver | null {
	if (!options || typeof options !== 'object' || typeof options.getProject !== 'function') {
		throw new TypeError('Selected nativeMedia native proxy composition requires its project authority.');
	}
	const bridge = resolveFramescaperNativeServicesBridge(options.scope ?? globalThis);
	if (!proxyBridgeAvailable(bridge)) return null;
	const probes = timingProbes(options.composition);
	if (probes.length === 0) return null;
	const generator = createFramescaperNativeProResProxyGenerator({
		profile: options.profile, getProject: options.getProject, bridge,
		...(options.waitForPoll ? { waitForPoll: options.waitForPoll } : {}),
	});
	return createVideoProxyCandidateObserver({
		generator, recipe: RECIPE, probes, maximumBytes: MAXIMUM_PROXY_BYTES,
	});
}

/** @internal Exact execution factory used by the deferred selected-assistance wrapper. */
export function createFramescaperNativeProResProxyGenerator(
	options: FramescaperNativeProResProxyGeneratorOptions,
): VideoProxyCandidateGeneratorPort {
	if (!options || typeof options !== 'object' || typeof options.getProject !== 'function'
		|| !proxyBridgeAvailable(options.bridge)
		|| (options.waitForPoll !== undefined && typeof options.waitForPoll !== 'function')) {
		throw new TypeError('Selected nativeMedia native proxy generation requires its exact execution ports.');
	}
	return Object.freeze({
		...GENERATOR,
		generate: (
			_original: Parameters<VideoProxyCandidateGeneratorPort['generate']>[0],
			identity: Parameters<VideoProxyCandidateGeneratorPort['generate']>[1],
			recipe: Parameters<VideoProxyCandidateGeneratorPort['generate']>[2],
			generation: Parameters<VideoProxyCandidateGeneratorPort['generate']>[3],
		) => generate({
			profile: options.profile, getProject: options.getProject, bridge: options.bridge,
			identity, recipe, signal: generation.signal, assertCurrent: generation.assertCurrent,
			waitForPoll: options.waitForPoll ?? waitForPoll,
		}),
	});
}

async function generate(context: Readonly<{
	readonly profile: unknown;
	readonly getProject: () => unknown;
	readonly bridge: FramescaperNativeServicesBridge;
	readonly identity: Readonly<{
		readonly projectId: string; readonly sourceId: string; readonly sha256: string;
	}>;
	readonly recipe: VideoProxyCandidateRecipe;
	readonly signal?: AbortSignal;
	readonly assertCurrent: () => void;
	readonly waitForPoll: (signal?: AbortSignal) => Promise<void>;
}>): Promise<Blob> {
	assertRecipe(context.recipe);
	assertCurrent(context);
	const snapshot = proxySnapshot(context.profile, context.getProject(), context.identity);
	const store = createFramescaperNativeServicesStore(context.bridge);
	assertProxyRuntime(await store.refresh());
	const selectRoot = context.bridge.selectRoot!;
	const revalidateRoot = context.bridge.revalidateRoot!;
	const selected = await selectRoot.call(context.bridge);
	if (selected === null) throw abortError('Native ProRes Proxy destination selection was cancelled.');
	const root = exactRoot(selected);
	if (root.revoked || await revalidateRoot.call(context.bridge, { grantId: root.grantId }) !== true) {
		throw new Error('The native ProRes Proxy destination root is not authorized.');
	}
	assertCurrent(context);
	assertProxyRuntime(await store.refresh());
	const projection = queueProjection(await context.bridge.enqueue!(Object.freeze({
		taskKind: 'proxy-generation' as const, planVersion: 14 as const, derivedInputStageId: null,
		schemaFamily: FRAMESCAPER_PROJECT_SCHEMA_FAMILY,
		schemaVersion: PROJECT_SCHEMA_VERSION,
		planFingerprint: snapshot.planFingerprint, planPayload: snapshot.planPayload,
		projectId: snapshot.projectId, projectRevision: snapshot.projectRevision,
		inputFingerprints: snapshot.inputFingerprints, rootGrantId: root.grantId,
		relativeDestination: proxyDestination(snapshot),
		reservations: FRAMESCAPER_NATIVE_MEDIA_RENDER_QUEUE_RESERVATIONS,
		recoveryClass: 'atomic-restart' as const,
	})));
	let primary: unknown;
	try {
		await waitForCompletion(context, projection.jobId);
		return await readCompletedProxy(context.bridge, projection.jobId, context.signal);
	} catch (error) {
		primary = error;
		await cancelAfterFailure(context.bridge, projection.jobId);
	}
	throw primary;
}

async function waitForCompletion(
	context: Pick<Parameters<typeof generate>[0], 'bridge' | 'signal' | 'assertCurrent' | 'waitForPoll'>,
	jobId: string,
): Promise<void> {
	for (;;) {
		assertCurrent(context);
		const snapshot = await context.bridge.snapshot();
		const rows = snapshot.queue.filter((row) => row.jobId === jobId);
		if (rows.length !== 1) throw new Error('The native ProRes Proxy queue row disappeared.');
		const row = queueProjection(rows[0]);
		if (row.state === 'completed') return;
		if (row.state === 'failed' || row.state === 'cancelled' || row.state === 'blocked'
			|| row.state === 'needs-authorization') {
			throw new Error(`Native ProRes Proxy generation stopped in state ${row.state}.`);
		}
		await context.waitForPoll(context.signal);
	}
}

async function readCompletedProxy(
	bridge: FramescaperNativeServicesBridge,
	jobId: string,
	signal?: AbortSignal,
): Promise<Blob> {
	const claim = exactClaim(await bridge.claimProxyOutput!({ jobId }));
	let primary: unknown;
	try {
		const parts: ArrayBuffer[] = [];
		for (let offset = 0; offset < claim.byteLength;) {
			throwIfAborted(signal);
			const length = Math.min(READ_BYTES, claim.byteLength - offset);
			const bytes = await bridge.readProxyOutput!({ claimId: claim.claimId, offset, length });
			if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
				throw new Error('A pathless native proxy-output range was short.');
			}
			const copy = new Uint8Array(length);
			copy.set(bytes);
			parts.push(copy.buffer);
			offset += length;
		}
		const candidate = new Blob(parts, { type: claim.mimeType });
		if (candidate.size !== claim.byteLength || await digestMediaContent(candidate, { signal }) !== claim.sha256) {
			throw new Error('The pathless native proxy candidate changed exact byte identity.');
		}
		return candidate;
	} catch (error) { primary = error; }
	finally {
		try {
			if (await bridge.releaseProxyOutput!({ claimId: claim.claimId }) !== true) {
				throw new Error('The pathless native proxy output claim was not released.');
			}
		} catch (releaseError) {
			if (primary !== undefined) {
				throw new AggregateError([primary, releaseError], 'Native proxy read and claim release failed.', { cause: primary });
			}
			throw releaseError;
		}
	}
	throw primary;
}

function proxySnapshot(
	profile: unknown,
	projectValue: unknown,
	identity: Readonly<{ readonly projectId: string; readonly sourceId: string; readonly sha256: string }>,
) {
	const project = cloneFramescaperProjectNativeMedia(profile, projectValue);
	if (String(project.id) !== identity.projectId || !SHA256.test(identity.sha256)) {
		throw new Error('The native proxy candidate project identity changed.');
	}
	const source = videoSource(project, identity.sourceId);
	if (source.contentSha256 !== identity.sha256) {
		throw new Error('The native proxy candidate original generation changed.');
	}
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(
		profile, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project),
	);
	const envelope = createNativeMediaPlanEnvelopeV2(plan);
	return Object.freeze({
		projectId: identity.projectId, projectRevision: Number(project.revision),
		planFingerprint: envelope.fingerprint, planPayload: canonicalizeNativeMediaPlan(plan),
		inputFingerprints: Object.freeze([Object.freeze({
			sourceId: identity.sourceId, sha256: identity.sha256,
		})]) as readonly NativeQueueInputFingerprintV1[],
	});
}

function videoSource(project: FramescaperProjectNativeMedia, sourceId: string): Readonly<Record<string, unknown>> {
	const rows = (project.sources as readonly Readonly<Record<string, unknown>>[]).filter(({ id }) => id === sourceId);
	if (rows.length !== 1 || rows[0]?.kind !== 'video') {
		throw new Error('The native proxy candidate source is absent or duplicated.');
	}
	return rows[0];
}

function timingProbes(
	composition: FramescaperCapturedVideoProxyRuntimeComposition,
): readonly VideoTimingProbePort[] {
	const web = createFfmpegVideoTimingProbe(composition.runtime ?? {});
	return Object.freeze([composition.helperTimingProbe ?? null, web]
		.filter((probe): probe is VideoTimingProbePort => probe !== null));
}

function proxyBridgeAvailable(
	bridge: FramescaperNativeServicesBridge | null,
): bridge is FramescaperNativeServicesBridge {
	return Boolean(bridge && ['enqueue', 'selectRoot', 'revalidateRoot', 'claimProxyOutput',
		'readProxyOutput', 'releaseProxyOutput'].every((method) => (
		typeof bridge[method as keyof FramescaperNativeServicesBridge] === 'function'
	)));
}

function assertProxyRuntime(snapshot: Awaited<ReturnType<ReturnType<
	typeof createFramescaperNativeServicesStore
>['refresh']>>): void {
	const ref = NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec;
	const capability = snapshot.capabilitySnapshot
		? nativeMediaCapabilityEntry(snapshot.capabilitySnapshot, ref.domain, ref.id) : null;
	if (!snapshot.services.runtimeAvailable || !snapshot.services.nativeMediaEnabled
		|| !snapshot.preferences.nativeMediaEnabled || !snapshot.capabilitySnapshot?.masterEnabled
		|| !isNativeMediaCapabilityUsable(capability)) {
		throw new Error('Native ProRes Proxy generation is unavailable or not enabled.');
	}
}

function assertCurrent(context: Readonly<{ readonly signal?: AbortSignal; readonly assertCurrent: () => void }>): void {
	throwIfAborted(context.signal);
	context.assertCurrent();
}
function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? abortError('Native ProRes Proxy generation was cancelled.');
}
function abortError(message: string): DOMException { return new DOMException(message, 'AbortError'); }
async function waitForPoll(signal?: AbortSignal): Promise<void> {
	throwIfAborted(signal);
	await new Promise<void>((resolve) => setTimeout(resolve, 250));
	throwIfAborted(signal);
}
async function cancelAfterFailure(bridge: FramescaperNativeServicesBridge, jobId: string): Promise<void> {
	try {
		const row = queueProjection((await bridge.snapshot()).queue.find((entry) => entry.jobId === jobId));
		if (!['completed', 'failed', 'cancelled'].includes(row.state)) {
			await bridge.control({ jobId, action: 'cancel' });
		}
	} catch { /* preserve the generator's primary failure */ }
}

function queueProjection(value: unknown): FramescaperNativeQueueProjection {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A native ProRes Proxy queue projection is required.');
	}
	const row = value as FramescaperNativeQueueProjection;
	if (!JOB_ID.test(row.jobId) || row.taskKind !== 'proxy-generation') {
		throw new TypeError('The native ProRes Proxy queue projection changed identity.');
	}
	return row;
}
function exactRoot(value: unknown): Readonly<{ grantId: string; revoked: boolean }> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A native proxy root is required.');
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.grantId !== 'string' || !/^[a-f0-9]{16,64}$/u.test(row.grantId)
		|| typeof row.revoked !== 'boolean') throw new TypeError('The native proxy root projection is invalid.');
	return Object.freeze({ grantId: row.grantId, revoked: row.revoked });
}
function exactClaim(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('A native proxy claim is required.');
	const row = value as Readonly<Record<string, unknown>>;
	if (typeof row.claimId !== 'string' || !JOB_ID.test(row.claimId)
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| Number(row.byteLength) > MAXIMUM_PROXY_BYTES || !SHA256.test(String(row.sha256))
		|| row.mimeType !== 'video/quicktime') throw new TypeError('The native proxy claim is invalid.');
	return Object.freeze({ claimId: row.claimId, byteLength: Number(row.byteLength),
		sha256: String(row.sha256), mimeType: 'video/quicktime' as const });
}
function assertRecipe(value: VideoProxyCandidateRecipe): void {
	if (Reflect.ownKeys(value).sort().join(',') !== 'id,version'
		|| value.id !== RECIPE.id || value.version !== RECIPE.version) {
		throw new Error('The selected native proxy recipe changed identity.');
	}
}
function proxyDestination(snapshot: Readonly<{ planFingerprint: string; inputFingerprints: readonly NativeQueueInputFingerprintV1[] }>): string {
	const source = snapshot.inputFingerprints[0]!;
	const bytes = new Uint8Array(16);
	globalThis.crypto?.getRandomValues(bytes);
	if (bytes.every((value) => value === 0)) throw new Error('Secure native proxy destination randomness is unavailable.');
	const nonce = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
	return `.framescaper-native-proxies/${snapshot.planFingerprint.slice(0, 16)}-${source.sha256.slice(0, 16)}-${nonce}.mov`;
}
