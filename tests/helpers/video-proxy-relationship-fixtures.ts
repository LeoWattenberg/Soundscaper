/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createVideoProxyCandidateObserver,
	type VideoProxyCandidateObserverDependencies,
} from '../../src/common/editor/video-proxy-candidate-observation.ts';
import {
	createVideoProxyRelationshipAuthority,
	type VideoProxyRelationshipAuthorityDependencies,
} from '../../src/common/editor/video-proxy-relationship.ts';
import { createAudioEditorProjectV16 } from '../../src/common/editor/project-v16.ts';
import {
	createVideoSourceV10,
	createVideoTrackV10,
} from '../../src/common/editor/project-v10.ts';
import {
	bindVideoSourceTimingView,
	type BoundVideoSourceTimingView,
	type VideoSourceTimingView,
} from '../../src/common/editor/video-source-timing-view.ts';
import type { VideoTimingProbeResult } from '../../src/common/editor/video-timing-probe.ts';

export const ORIGINAL_SHA256 = 'a1'.repeat(32);
export const OTHER_SHA256 = 'b2'.repeat(32);
export const ORIGINAL_SOURCE_ID = 'original-source';
export const PROJECT_ID = 'proxy-project';
export const NOW = '2026-08-12T08:00:00.000Z';
export const RATE = Object.freeze({ num: 24, den: 1 });

export interface Deferred<Value> {
	readonly promise: Promise<Value>;
	resolve(value: Value): void;
	reject(reason: unknown): void;
}

export interface VideoProxyFixtureCounters {
	captureTask: number;
	taskChecks: number;
	timingResolutions: number;
	originalOpens: number;
	originalChecks: number;
	originalReleases: number;
	generatorCalls: number;
	probeCalls: number;
}

export interface VideoProxyOriginalFingerprintFixture {
	readonly authority: 'owned' | 'linked';
	readonly projectId: string;
	readonly sourceId: string;
	readonly storageKey: string;
	readonly mimeType: string;
	readonly byteLength: number;
	readonly sha256: string;
	readonly generationToken: string;
}

export interface VideoProxyFixtureOptions {
	readonly project?: Record<string, unknown>;
	readonly original?: Blob;
	readonly candidate?: Blob;
	readonly candidateMaximumBytes?: number;
	readonly generatorGate?: Deferred<void>;
	readonly generatorError?: unknown;
	readonly releaseGate?: Deferred<void>;
	readonly releaseError?: unknown;
	readonly probeCount?: number;
	readonly probeResult?: VideoTimingProbeResult;
	readonly failingProbes?: ReadonlySet<number>;
	readonly fingerprint?: Partial<VideoProxyOriginalFingerprintFixture>;
}

export function deferred<Value>(): Deferred<Value> {
	let resolve!: (value: Value) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<Value>((pass, fail) => {
		resolve = pass;
		reject = fail;
	});
	return { promise, resolve, reject };
}

export function createVideoProxyFixture(options: VideoProxyFixtureOptions = {}) {
	let project = options.project ?? videoProxyProject();
	let taskToken: object = Object.freeze({ generation: 1 });
	let originalCurrent = true;
	let timingOverride: BoundVideoSourceTimingView | null = null;
	let fingerprint = originalFingerprint(options.original, options.fingerprint);
	let candidate = options.candidate ?? new Blob(['canonical-proxy'], { type: 'video/webm' });
	const original = options.original ?? new Blob(['canonical-original'], { type: 'video/mp4' });
	const counters: VideoProxyFixtureCounters = {
		captureTask: 0,
		taskChecks: 0,
		timingResolutions: 0,
		originalOpens: 0,
		originalChecks: 0,
		originalReleases: 0,
		generatorCalls: 0,
		probeCalls: 0,
	};
	const seen = {
		generatorOriginal: null as Blob | null,
		generatorIdentity: null as Readonly<Record<string, unknown>> | null,
		generatorRecipe: null as Readonly<Record<string, unknown>> | null,
		probeCandidate: null as Blob | null,
		observationRequest: null as Readonly<Record<string, unknown>> | null,
	};
	const probeResult = options.probeResult ?? exactProbeResult();
	const probeCount = options.probeCount ?? 1;
	const failingProbes = options.failingProbes ?? new Set<number>();
	const probes = Array.from({ length: probeCount }, (_value, index) => Object.freeze({
		id: `exact-probe-${String(index + 1)}`,
		async probe(input: Blob): Promise<VideoTimingProbeResult> {
			counters.probeCalls += 1;
			seen.probeCandidate = input;
			if (failingProbes.has(index)) throw new Error(`probe ${String(index + 1)} unavailable`);
			return probeResult;
		},
	}));
	const candidateDependencies: VideoProxyCandidateObserverDependencies = {
		generator: Object.freeze({
			id: 'fixture-generator',
			version: 3,
			async generate(
				input: Blob,
				identity: Readonly<Record<string, unknown>>,
				recipe: Readonly<Record<string, unknown>>,
				generation: Readonly<{ readonly signal?: AbortSignal; assertCurrent(): void }>,
			): Promise<unknown> {
				counters.generatorCalls += 1;
				seen.generatorOriginal = input;
				seen.generatorIdentity = identity;
				seen.generatorRecipe = recipe;
				generation.assertCurrent();
				if (options.generatorGate) await options.generatorGate.promise;
				generation.assertCurrent();
				if (options.generatorError !== undefined) throw options.generatorError;
				return candidate;
			},
		}),
		recipe: Object.freeze({ id: 'fixture-proxy-recipe', version: 7 }),
		probes: Object.freeze(probes),
		...(options.candidateMaximumBytes === undefined
			? {}
			: { maximumBytes: options.candidateMaximumBytes }),
	};
	const candidateObserver = createVideoProxyCandidateObserver(candidateDependencies);
	const relationshipDependencies: VideoProxyRelationshipAuthorityDependencies = {
		getProject: () => project,
		captureTask: () => {
			counters.captureTask += 1;
			return taskToken;
		},
		assertTaskCurrent: (captured: unknown) => {
			counters.taskChecks += 1;
			if (captured !== taskToken) throw new DOMException('Proxy task changed.', 'AbortError');
		},
		resolveOriginalTiming: (source: Readonly<Record<string, unknown>>) => {
			counters.timingResolutions += 1;
			if (timingOverride) return timingOverride;
			return bindOriginalTiming(source);
		},
		observeOriginal: async (request: Readonly<Record<string, unknown>>) => {
			counters.originalOpens += 1;
			seen.observationRequest = request;
			let released = false;
			const openedFingerprint = Object.freeze({ ...fingerprint });
			return Object.freeze({
				blob: original,
				fingerprint: openedFingerprint,
				assertCurrent() {
					counters.originalChecks += 1;
					if (!originalCurrent || !sameFingerprint(openedFingerprint, fingerprint)) {
						throw new DOMException('Original generation changed.', 'AbortError');
					}
				},
				async release() {
					if (released) return;
					released = true;
					counters.originalReleases += 1;
					if (options.releaseGate) await options.releaseGate.promise;
					if (options.releaseError !== undefined) throw options.releaseError;
				},
			});
		},
		candidateObserver,
	};
	const authority = createVideoProxyRelationshipAuthority(relationshipDependencies);
	return {
		authority,
		candidateDependencies,
		candidateObserver,
		candidate: () => candidate,
		counters,
		original,
		project: () => project,
		relationshipDependencies,
		seen,
		advanceTask() {
			taskToken = Object.freeze({ generation: Date.now() });
		},
		setCandidate(value: Blob) {
			candidate = value;
		},
		setFingerprint(changes: Partial<VideoProxyOriginalFingerprintFixture>) {
			fingerprint = Object.freeze({ ...fingerprint, ...changes });
		},
		setOriginalCurrent(value: boolean) {
			originalCurrent = value;
		},
		setProject(value: Record<string, unknown>) {
			project = value;
		},
		setTimingOverride(value: BoundVideoSourceTimingView | null) {
			timingOverride = value;
		},
	};
}

export function createFinalMutationAuthority(
	fixture: ReturnType<typeof createVideoProxyFixture>,
	callback: 'task' | 'lease' | 'resolver',
): ReturnType<typeof createVideoProxyRelationshipAuthority> {
	const base = fixture.relationshipDependencies;
	let mutated = false;
	const mutate = (): void => {
		if (mutated) return;
		mutated = true;
		const clips = fixture.project().clips as Record<string, unknown>[];
		clips[0]!.title = `mutated-by-${callback}`;
	};
	return createVideoProxyRelationshipAuthority({
		candidateObserver: fixture.candidateObserver,
		getProject: base.getProject,
		captureTask: base.captureTask,
		assertTaskCurrent(token: unknown) {
			base.assertTaskCurrent(token);
			if (callback === 'task' && fixture.counters.originalReleases >= 1) mutate();
		},
		resolveOriginalTiming(source: Readonly<Record<string, unknown>>) {
			const timing = base.resolveOriginalTiming(source);
			if (callback === 'resolver' && fixture.counters.timingResolutions >= 2) mutate();
			return timing;
		},
		async observeOriginal(request) {
			const lease = await base.observeOriginal(request);
			if (callback !== 'lease') return lease;
			return Object.freeze({
				blob: lease.blob,
				fingerprint: lease.fingerprint,
				assertCurrent() {
					lease.assertCurrent();
					if (fixture.counters.timingResolutions >= 2) mutate();
				},
				async release() {
					await lease.release();
					mutate();
				},
			});
		},
	});
}

export function createNonEnumerableReleaseAuthority(
	fixture: ReturnType<typeof createVideoProxyFixture>,
	onRelease: () => void,
): ReturnType<typeof createVideoProxyRelationshipAuthority> {
	const base = fixture.relationshipDependencies;
	return createVideoProxyRelationshipAuthority({
		...base,
		async observeOriginal(request) {
			const lease = await base.observeOriginal(request);
			const malformed = {
				blob: lease.blob,
				fingerprint: lease.fingerprint,
				assertCurrent: () => { lease.assertCurrent(); },
				async release() { onRelease(); await lease.release(); },
			};
			Object.defineProperty(malformed, 'release', { enumerable: false });
			return Object.freeze(malformed);
		},
	});
}

export function createSplitReadProjectAuthority(
	fixture: ReturnType<typeof createVideoProxyFixture>,
): ReturnType<typeof createVideoProxyRelationshipAuthority> {
	const live = fixture.project();
	const changedSources = structuredClone(live.sources) as Record<string, unknown>[];
	changedSources[0]!.storageKey = 'split-read-storage';
	let sourceReads = 0;
	const project = new Proxy(live, { getOwnPropertyDescriptor(target, key) {
		const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
		if (key !== 'sources' || !descriptor || ++sourceReads % 2 === 1) return descriptor;
		return { ...descriptor, value: changedSources };
	} });
	return createVideoProxyRelationshipAuthority({
		...fixture.relationshipDependencies, getProject: () => project,
	});
}

export function createReceiverGuardedRelationshipAuthority(
	fixture: ReturnType<typeof createVideoProxyFixture>,
) {
	const base = fixture.relationshipDependencies;
	const receivers: unknown[] = [];
	const leaseReceivers: unknown[] = [];
	let installed = false;
	let rawReads = 0;
	let leaseRawReads = 0;
	const capture = (receiver: unknown): void => { receivers.push(receiver); };
	const target: VideoProxyRelationshipAuthorityDependencies = {
		candidateObserver: fixture.candidateObserver,
		getProject(this: unknown) { capture(this); return base.getProject(); },
		captureTask(this: unknown) { capture(this); return base.captureTask(); },
		assertTaskCurrent(this: unknown, token: unknown) {
			capture(this);
			base.assertTaskCurrent(token);
		},
		resolveOriginalTiming(this: unknown, source: Readonly<Record<string, unknown>>) {
			capture(this);
			return base.resolveOriginalTiming(source);
		},
		async observeOriginal(this: unknown, request) {
			capture(this);
			const lease = await base.observeOriginal(request);
			const leaseTarget = {
				blob: lease.blob,
				fingerprint: lease.fingerprint,
				assertCurrent(this: { readonly blob: Blob }) {
					leaseReceivers.push(this); void this.blob; lease.assertCurrent();
				},
				async release(this: { readonly fingerprint: unknown }) {
					leaseReceivers.push(this); void this.fingerprint; await lease.release();
				},
			};
			return new Proxy(leaseTarget, {
				get(value, key, receiver) {
					if (key !== 'then') leaseRawReads += 1;
					return Reflect.get(value, key, receiver);
				},
			});
		},
	};
	const raw = new Proxy(target, {
		get(value, key, receiver) {
			if (installed) rawReads += 1;
			return Reflect.get(value, key, receiver);
		},
	});
	const authority = createVideoProxyRelationshipAuthority(raw);
	installed = true;
	return {
		authority,
		inspection() {
			const unique = [...new Set(receivers)];
			const receiver = unique[0];
			const isObject = receiver !== null && typeof receiver === 'object';
			const uniqueLease = [...new Set(leaseReceivers)];
			const leaseReceiver = uniqueLease[0];
			return {
				rawReads,
				receiverCount: unique.length,
				frozen: isObject && Object.isFrozen(receiver),
				raw: receiver === raw || receiver === target,
				authorityState: isObject && Object.hasOwn(receiver, 'id'),
				leaseRawReads,
				leaseReceiverCount: uniqueLease.length,
				leaseFrozen: typeof leaseReceiver === 'object' && leaseReceiver !== null
					&& Object.isFrozen(leaseReceiver),
			};
		},
	};
}

function sameFingerprint(
	leftValue: object,
	rightValue: object,
): boolean {
	const left = leftValue as Readonly<Record<string, unknown>>;
	const right = rightValue as Readonly<Record<string, unknown>>;
	return Object.keys(left).every((key) => left[key] === right[key])
		&& Object.keys(left).length === Object.keys(right).length;
}

export function videoProxyProject(options: Readonly<{
	timelineRetime?: unknown;
	binRetime?: unknown;
	includeUnrelatedRetime?: boolean;
}> = {}): Record<string, unknown> {
	const originalSource = videoSource(ORIGINAL_SOURCE_ID, ORIGINAL_SHA256);
	const otherSource = videoSource('other-source', OTHER_SHA256);
	const timeline = videoClip('timeline-original', ORIGINAL_SOURCE_ID, options.timelineRetime ?? null);
	const bin = videoClip('bin-original', ORIGINAL_SOURCE_ID, options.binRetime ?? null, true);
	const unrelated = videoClip('bin-unrelated', 'other-source', retimeCurve(), true);
	return createAudioEditorProjectV16({
		id: PROJECT_ID,
		title: 'Proxy relationship fixture',
		now: NOW,
		sampleRate: 48_000,
		sources: [originalSource, otherSource],
		clips: [timeline],
		tracks: [createVideoTrackV10({
			id: 'video-track', name: 'Video', clipIds: ['timeline-original'], locked: false,
		})],
		sequences: [{ id: 'main', rate: RATE, trackIds: ['video-track'] }],
		primarySequenceId: 'main',
		projectBin: {
			clips: options.includeUnrelatedRetime === false ? [bin] : [bin, unrelated],
		},
	}) as unknown as Record<string, unknown>;
}

export function exactProbeResult(overrides: Partial<VideoTimingProbeResult> = {}): VideoTimingProbeResult {
	return {
		timescale: 24,
		presentationTicks: [0n, 1n, 2n, 3n],
		finalFrameDurationTicks: 1n,
		nominalRate: RATE,
		characteristics: {
			backend: 'fixture',
			audioStreams: [{ index: 5, codec: 'opus', channelCount: 2, sampleRate: 48_000 }],
			extractedAudioStreamIndex: 5,
		},
		...overrides,
	};
}

export function retimeCurve(): Readonly<Record<string, unknown>> {
	return Object.freeze({
		feature: 'video-retime',
		version: 2,
		points: Object.freeze([
			Object.freeze({ outerFrame: 0, sourceFrame: Object.freeze({ num: 0, den: 1 }) }),
			Object.freeze({ outerFrame: 4, sourceFrame: Object.freeze({ num: 4, den: 1 }) }),
		]),
		segments: Object.freeze([Object.freeze({ mode: 'constant-forward' })]),
	});
}

export function bindFixtureTiming(sourceId = ORIGINAL_SOURCE_ID): BoundVideoSourceTimingView {
	return bindOriginalTiming(videoSource(sourceId, ORIGINAL_SHA256));
}

function bindOriginalTiming(source: Readonly<Record<string, unknown>>): BoundVideoSourceTimingView {
	const sourceId = String(source.id);
	const view: VideoSourceTimingView = Object.freeze({
		kind: 'cfr', rate: RATE, frameCount: Number(source.sourceFrameCount),
	});
	return bindVideoSourceTimingView(new Map([[sourceId, view]]), source);
}

function videoSource(id: string, sha256: string): Record<string, unknown> {
	return createVideoSourceV10({
		id,
		name: id,
		mimeType: 'video/mp4',
		storageKey: `${id}-storage`,
		contentSha256: sha256,
		sampleFrameCount: 8_000,
		sampleRate: 48_000,
		sourceFrameCount: 4,
		frameRate: RATE,
		width: 16,
		height: 16,
	});
}

function videoClip(
	id: string,
	sourceId: string,
	retimeMap: unknown,
	inBin = false,
): Record<string, unknown> {
	return {
		kind: 'video',
		id,
		...(inBin ? { binItemId: `${id}-item` } : {}),
		sourceId,
		title: id,
		sequenceId: 'main',
		sequenceStartFrame: 0,
		sequenceFrameCount: 4,
		sourceInFrame: 0,
		sourceFrameCount: 4,
		retimeMap,
	};
}

function originalFingerprint(
	originalValue: Blob | undefined,
	overrides: Partial<VideoProxyOriginalFingerprintFixture> = {},
): VideoProxyOriginalFingerprintFixture {
	const original = originalValue ?? new Blob(['canonical-original'], { type: 'video/mp4' });
	return Object.freeze({
		authority: 'owned',
		projectId: PROJECT_ID,
		sourceId: ORIGINAL_SOURCE_ID,
		storageKey: `${ORIGINAL_SOURCE_ID}-storage`,
		mimeType: 'video/mp4',
		byteLength: original.size,
		sha256: ORIGINAL_SHA256,
		generationToken: 'owned-media-content-token-1',
		...overrides,
	});
}
