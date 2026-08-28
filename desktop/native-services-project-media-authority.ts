/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-private baseline project, source-body, backend, and publication authority. */

import { createHash } from 'node:crypto';
import { createNativeMediaPublicationPlan } from '../src/common/editor/native-media-atomic-publication.ts';
import { NATIVE_MEDIA_CPU_BACKEND, type NativeMediaPlatform } from '../src/common/editor/native-media-backend-policy.ts';
import { createNativeMediaPlanEnvelopeV2 } from '../src/common/editor/native-media-plan-envelope-v2.ts';
import { nativeMediaV14RequiresEvaluatedCarrier } from '../src/common/editor/native-media-v14-render-family.ts';
import { fingerprintNativeMediaPlan } from '../src/common/editor/native-media-plan-canonical-form.ts';
import { nativeMediaPlanVideoTimingAssetInputs } from '../src/common/editor/native-media-plan-video-timing.ts';
import { resolveNativeMediaProxyGeometry } from '../src/common/editor/native-media-proxy-recipe.ts';
import type { NativeQueueRecordV3 } from '../src/common/editor/native-queue-record-v3.ts';
import type { NativeQueueReservationsV1 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueRevalidationV1 } from '../src/common/editor/native-queue-state-machine.ts';
import type { UnifiedExactRenderPlanV14 } from '../src/common/editor/unified-exact-render-plan.ts';
import {
	executeNativeMediaPlanV14,
	type NativeMediaV14ExecutionAttempt,
	type NativeMediaV14ExecutionResult,
} from './native-media-v14-executor.ts';
import type { PreparedNativeMediaQueueJobV3 } from './native-media-queue-dispatcher-v3.ts';
import {
	framescaperNativeMediaV14OutputCeiling,
	framescaperNativeMediaV14ProxyOutputCeiling,
} from './native-media-v14-helper-adapter.ts';
import type {
	FramescaperNativeMediaV14RuntimePort,
	FramescaperNativeMediaV14RuntimeRequest,
	FramescaperNativeMediaProxyV14RuntimeRequest,
} from './native-media-v14-runtime-contract.ts';
import type { FramescaperNativeProjectAuthorityPort } from './native-services-project-authority.ts';
import type { FramescaperNativeQueueEnqueueRequest } from './native-services-lifecycle-contracts.ts';
import type {
	FramescaperNativeRenderInputSettlementPort,
} from './native-services-render-input-staging.ts';
import {
	publishVerifiedNativeMediaOutput,
	type FramescaperNativePublicationFence,
	type FramescaperNativePublicationPort,
} from './native-services-publication.ts';
import {
	framescaperNativeOriginalBodyForInput,
	framescaperNativeProjectPlanBodyMetadataMatches,
	type FramescaperNativeProjectMediaBody,
} from './native-services-project-body-custody.ts';
import {
	assertFramescaperNativeProjectMediaPort,
	framescaperNativeProjectMediaBundle,
	framescaperNativeProjectMediaRecord,
} from './native-services-project-media-custody.ts';
import type {
	FramescaperNativeRootGrant,
	FramescaperNativeRootObservation,
} from './native-services-root-repository.ts';
import {
	framescaperNativeWatchProject,
	inspectFramescaperNativeWatchImport,
} from './native-services-project-watch-authority.ts';
import { FRAMESCAPER_PROJECT_WATCH_BIN_ID } from '../src/common/editor/native-watch-target.ts';
import { framescaperNativeV14BackendPlanForRecord } from './native-services-v14-backend-authority.ts';

const SHA256 = /^[a-f0-9]{64}$/u;
const V14_QUEUE_CPU_CORES = 2;
const V14_QUEUE_RSS_BYTES = 4 * 1_024 ** 3;
const V14_QUEUE_MINIMUM_FREE_BYTES = 10 * 1_024 ** 3;

interface LoadedBodies {
	readonly sources: readonly Readonly<{
		readonly grantId: string;
		readonly sourceId: string;
		readonly contentSha256: string;
		readonly mimeType: string;
		readonly byteLength: number;
		readonly materialize: (destination: string, signal?: AbortSignal) => Promise<unknown>;
	}>[];
	readonly timings: readonly Readonly<{
		readonly sourceId: string;
		readonly sha256: string;
		readonly bytes: Uint8Array;
	}>[];
}

export interface FramescaperNativeProjectMediaAuthorityOptions {
	readonly project: Omit<FramescaperNativeProjectAuthorityPort, 'projectRecord'> & Readonly<{
		projectRecord(projectId: string): unknown;
		materializeBody(body: unknown, destination: string, signal?: AbortSignal): Promise<unknown>;
	}>;
	readonly watch: Readonly<{
		projectState(projectId: string): Readonly<{
			readonly schemaFamily: 'framescaper'; readonly schemaVersion: 1;
			readonly open: boolean; readonly writable: boolean;
			readonly binId: typeof FRAMESCAPER_PROJECT_WATCH_BIN_ID;
		}>;
	}>;
	readonly runtime: FramescaperNativeMediaV14RuntimePort;
	readonly renderInputs: Pick<
		FramescaperNativeRenderInputSettlementPort,
		'revalidate' | 'inspect' | 'settle'
	>;
	readonly platform: NativeMediaPlatform;
	/** The user's current hardware-encode opt-in; absent means unrestricted. */
	readonly hardwareEncodeEnabled?: () => boolean;
	readonly probeRoot: (grant: FramescaperNativeRootGrant) => Promise<FramescaperNativeRootObservation>;
	readonly publicationPortFor: (grant: FramescaperNativeRootGrant) => FramescaperNativePublicationPort;
	readonly publicationFenceFor: (
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant,
	) => FramescaperNativePublicationFence;
	readonly recordProxyOutput?: (
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant,
		receipt: Readonly<{ readonly planFingerprint: string; readonly byteLength: number; readonly sha256: string }>,
	) => void;
}

/** Native jobs never pass paths or project bodies through the renderer/helper request schema. */
export class FramescaperNativeProjectMediaAuthority {
	readonly #options: FramescaperNativeProjectMediaAuthorityOptions;

	constructor(options: FramescaperNativeProjectMediaAuthorityOptions) {
		assertFramescaperNativeProjectMediaPort(options?.project);
		if (!options || typeof options !== 'object' || Array.isArray(options)
			|| !['win32', 'darwin', 'linux'].includes(options.platform)
			|| typeof options.project?.materializeBody !== 'function'
			|| typeof options.runtime?.available !== 'function'
			|| typeof options.runtime.executeV14 !== 'function'
			|| typeof options.runtime.executeProxyV14 !== 'function'
			|| typeof options.renderInputs?.revalidate !== 'function'
			|| typeof options.renderInputs.inspect !== 'function'
			|| typeof options.renderInputs.settle !== 'function'
			|| typeof options.probeRoot !== 'function' || typeof options.publicationPortFor !== 'function'
			|| typeof options.publicationFenceFor !== 'function'
			|| (options.recordProxyOutput !== undefined && typeof options.recordProxyOutput !== 'function')) {
			throw new TypeError('Baseline project authority requires exact V14 execution ports.');
		}
		this.#options = options;
	}

	projectState(projectId: string) {
		const state = this.#options.watch.projectState(projectId);
		if (state.schemaFamily !== 'framescaper' || state.schemaVersion !== 1
			|| state.binId !== FRAMESCAPER_PROJECT_WATCH_BIN_ID
			|| typeof state.open !== 'boolean' || typeof state.writable !== 'boolean') {
			throw new TypeError('Baseline native media requires exact Framescaper v1 project state.');
		}
		return Object.freeze({ ...state });
	}
	watchProject(projectId: string) {
		return framescaperNativeWatchProject(
			this.#options.project, this.#options.watch.projectState(projectId), projectId,
		);
	}
	watchImportAlreadyPresent(projectId: string, digest: string): Promise<boolean> {
		return this.watchImportState(
			projectId, FRAMESCAPER_PROJECT_WATCH_BIN_ID, digest,
		).then((witness) => witness !== null);
	}
	watchImportState(projectId: string, binId: string | null, digest: string) {
		return inspectFramescaperNativeWatchImport(
			this.#options.project, projectId, binId, digest,
		);
	}

	queueReservations(
		request: FramescaperNativeQueueEnqueueRequest,
		replayScratchByteLength: number,
	): NativeQueueReservationsV1 {
		const plan = requestV14Plan(request);
		const project = framescaperNativeProjectMediaRecord(this.#options.project.projectRecord(request.projectId));
		const bodiesMatch = project !== null && project.projectRevision === request.projectRevision
			&& (request.taskKind === 'proxy-generation'
				? proxyBodyMetadataMatches(plan, request.inputFingerprints, project.bodies)
				: framescaperNativeProjectPlanBodyMetadataMatches(plan, request.inputFingerprints, project.bodies));
		if (!bodiesMatch) throw new Error('The selected V14 queue reservation lost its exact project bodies.');
		const needsReplay = request.taskKind !== 'proxy-generation'
			&& nativeMediaV14RequiresEvaluatedCarrier(plan);
		if (!Number.isSafeInteger(replayScratchByteLength) || replayScratchByteLength < 0
			|| (replayScratchByteLength > 0) !== needsReplay) {
			throw new Error('The selected V14 replay reservation disagrees with its exact render family.');
		}
		let scratchBytes = safeAdd(0, replayScratchByteLength);
		for (const input of request.inputFingerprints) {
			const body = framescaperNativeOriginalBodyForInput(plan, input, project!.bodies);
			if (body !== null) scratchBytes = safeAdd(scratchBytes, body.byteLength);
		}
		for (const input of nativeMediaPlanVideoTimingAssetInputs(plan)) scratchBytes = safeAdd(scratchBytes,
			onlyBody(project!.bodies, (body) => body.kind === 'video-timing'
				&& body.storageKey === input.storageKey && body.sha256 === input.sha256, 'timing').byteLength);
		scratchBytes = safeAdd(scratchBytes, fingerprintNativeMediaPlan(plan).byteLength);
		scratchBytes = safeAdd(scratchBytes, request.taskKind === 'proxy-generation'
			? framescaperNativeMediaV14ProxyOutputCeiling(createNativeMediaPlanEnvelopeV2(plan))
			: framescaperNativeMediaV14OutputCeiling(createNativeMediaPlanEnvelopeV2(plan)));
		safeAdd(scratchBytes, V14_QUEUE_MINIMUM_FREE_BYTES);
		return Object.freeze({
			cpuCores: V14_QUEUE_CPU_CORES, processTreeRssBytes: V14_QUEUE_RSS_BYTES,
			scratchBytes, minimumFreeBytes: V14_QUEUE_MINIMUM_FREE_BYTES, hardwareBackend: null,
		});
	}

	async revalidate(
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant | null,
		rootAuthorized: boolean,
	): Promise<NativeQueueRevalidationV1> {
		let planMatches = false;
		let inputsMatch = false;
		let requiresCarrier = false;
		try {
			const plan = storedV14Plan(record);
			requiresCarrier = record.taskKind !== 'proxy-generation'
				&& nativeMediaV14RequiresEvaluatedCarrier(plan);
			framescaperNativeV14BackendPlanForRecord(record, this.#options.platform,
				this.#options.hardwareEncodeEnabled?.() ?? true);
			planMatches = true;
			const project = framescaperNativeProjectMediaRecord(this.#options.project.projectRecord(record.projectId));
			const awaitingCarrier = record.state === 'paused'
				&& record.lastFailureCode === 'awaiting-carrier-regeneration'
				&& requiresCarrier;
				inputsMatch = project !== null
					&& (record.taskKind === 'proxy-generation'
						? proxyBodyMetadataMatches(plan, record.inputFingerprints, project.bodies)
						: framescaperNativeProjectPlanBodyMetadataMatches(plan, record.inputFingerprints, project.bodies))
					&& (awaitingCarrier || await this.#options.renderInputs.revalidate(record));
		} catch { /* recovery turns malformed/obsolete authority into a visible block */ }
		const project = framescaperNativeProjectMediaRecord(this.#options.project.projectRecord(record.projectId));
		const rootValid = rootAuthorized && root !== null && await this.#rootValid(root);
		return Object.freeze({
			projectRevisionMatches: project?.projectRevision === record.projectRevision,
			planFingerprintMatches: planMatches,
			inputFingerprintsMatch: inputsMatch,
			rootGrantAuthorized: rootAuthorized, rootGrantValid: rootValid,
			helperBuildMatches: this.#options.runtime.available(),
			scratchIdentityMatches: record.state !== 'running' || !requiresCarrier,
		});
	}

	async prepare(
		record: NativeQueueRecordV3,
		root: FramescaperNativeRootGrant,
	): Promise<PreparedNativeMediaQueueJobV3> {
		const plan = storedV14Plan(record);
		const envelope = createNativeMediaPlanEnvelopeV2(plan);
		if (!await this.#rootValid(root)) throw new Error('The selected V14 destination root changed identity.');
		const project = framescaperNativeProjectMediaRecord(this.#options.project.projectRecord(record.projectId));
		if (project === null || project.projectRevision !== record.projectRevision) {
			throw new Error('The selected V14 project revision is no longer current.');
		}
		const bundle = framescaperNativeProjectMediaBundle(
			await this.#options.project.readProjectBundle(record.projectId),
		);
		if (bundle.project.projectRevision !== record.projectRevision
			|| bundle.project.sha256 !== project.projectSha256
			|| !(record.taskKind === 'proxy-generation'
				? proxyBodyMetadataMatches(plan, record.inputFingerprints, bundle.bodies)
				: framescaperNativeProjectPlanBodyMetadataMatches(plan, record.inputFingerprints, bundle.bodies))) {
			throw new Error('The selected V14 project or source authority changed before execution.');
		}
		const proxy = record.taskKind === 'proxy-generation';
		if (proxy && typeof this.#options.recordProxyOutput !== 'function') {
			throw new Error('Selected V14 proxy generation requires its pathless completed-output authority.');
		}
		const publication = createNativeMediaPublicationPlan({
			jobId: record.jobId, relativeDestination: record.relativeDestination,
			planFingerprint: record.planFingerprint,
		});
		const destination = Object.freeze({
			jobId: record.jobId,
			rootPath: root.rootPath, volumeIdentity: root.volumeIdentity,
			directoryIdentity: root.directoryIdentity,
			relativeDestination: publication.relativeDestination,
			temporaryRelativePath: publication.temporaryRelativePath,
		});
		const backendPlan = framescaperNativeV14BackendPlanForRecord(record, this.#options.platform,
			this.#options.hardwareEncodeEnabled?.() ?? true);
		const proxyRecipeValue = proxy ? proxyRecipe(envelope, record.inputFingerprints) : null;
		const requiresCarrier = !proxy && nativeMediaV14RequiresEvaluatedCarrier(envelope.plan);
		let derivedInputs: Awaited<ReturnType<FramescaperNativeRenderInputSettlementPort['inspect']>> | null = null;
		let loaded: LoadedBodies;
		try {
			if (requiresCarrier) derivedInputs = await this.#options.renderInputs.inspect(record);
			loaded = await this.#loadBodies(record, plan, bundle.bodies,
				derivedInputs?.scratchByteLength ?? derivedInputs?.byteLength ?? 0);
		}
		catch (error) {
			if (requiresCarrier) try { await this.#options.renderInputs.settle(record, 'failed'); }
			catch (cleanup) { throw new AggregateError([error, cleanup], 'Selected V14 input cleanup failed.', { cause: error }); }
			throw error;
		}
		return Object.freeze({
			execute: async ({ signal, onProgress }: Readonly<{
				readonly signal: AbortSignal;
				readonly onProgress: (value: number | null) => void;
			}>) => proxy ? this.#executeProxy(
				envelope, loaded, proxyRecipeValue!, destination, signal, onProgress,
			) : executeNativeMediaPlanV14({
				jobId: record.jobId, envelope, backendPlan,
				sources: loaded.sources.map(({
					mimeType: _mimeType, byteLength: _byteLength, materialize: _materialize, ...grant
				}) => grant),
				rootGrantId: root.grantId, relativeDestination: record.relativeDestination, signal,
					native: { execute: (attempt) => this.#executeNative(
						attempt, loaded, derivedInputs, destination, onProgress,
					) },
					web: { execute: (attempt) => this.#executeWeb(
						attempt, loaded, derivedInputs, destination, onProgress,
					) },
				}),
			publish: async (result: unknown) => {
				const execution = v14ExecutionResult(result, record.planFingerprint);
				await publishVerifiedNativeMediaOutput({
					plan: publication, currentPlanFingerprint: record.planFingerprint, finalized: true,
					declaredByteLength: execution.receipt.byteLength,
					declaredSha256: execution.receipt.sha256,
					...('tree' in execution.receipt ? { tree: execution.receipt.tree } : {}),
				}, this.#options.publicationPortFor(root), this.#options.publicationFenceFor(record, root));
				if (proxy) this.#options.recordProxyOutput!(record, root, execution.receipt);
			},
			cleanup: async (outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed') => {
				clearLoadedBodies(loaded);
				await this.#options.renderInputs.settle(record, outcome);
			},
		});
	}

	async #executeProxy(
		envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV2>,
		loaded: LoadedBodies,
		recipe: FramescaperNativeMediaProxyV14RuntimeRequest['recipe'],
		destination: FramescaperNativeMediaV14RuntimeRequest['destination'],
		signal: AbortSignal,
		onProgress: (value: number | null) => void,
	): Promise<NativeMediaV14ExecutionResult> {
		if (loaded.sources.length !== 1) {
			throw new Error('Selected V14 proxy generation requires one exact original source.');
		}
		const receipt = await this.#options.runtime.executeProxyV14(Object.freeze({
			adapterVersion: 1, envelope, sourceBody: loaded.sources[0]!,
			timingBodies: loaded.timings, recipe, destination, signal, onProgress,
		}));
		return Object.freeze({
			outcome: 'native', backend: NATIVE_MEDIA_CPU_BACKEND,
			receipt: proxyReceipt(receipt, envelope.fingerprint), failedBackends: Object.freeze([]),
		});
	}

	async #loadBodies(
		record: NativeQueueRecordV3,
		plan: Readonly<Record<string, unknown>>,
		bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
		derivedByteLength: number,
	): Promise<LoadedBodies> {
		const sources = [];
		let loadedBytes = safeAdd(0, derivedByteLength);
		for (const input of record.inputFingerprints) {
			const body = framescaperNativeOriginalBodyForInput(plan, input, bodies);
			if (body === null) continue;
			loadedBytes = safeAdd(loadedBytes, body.byteLength);
			sources.push(Object.freeze({
				grantId: opaqueGrant(record.jobId, input.sourceId, input.sha256), sourceId: input.sourceId,
				contentSha256: input.sha256, mimeType: body.mimeType, byteLength: body.byteLength,
				materialize: (destination: string, signal?: AbortSignal) => (
					this.#options.project.materializeBody(body, destination, signal)
				),
			}));
		}
		const timings = [];
		for (const input of nativeMediaPlanVideoTimingAssetInputs(plan)) {
			const body = onlyBody(bodies, (row) => row.kind === 'video-timing'
				&& row.storageKey === input.storageKey && row.sha256 === input.sha256, 'timing');
			const bytes = await this.#readBody(body); loadedBytes = safeAdd(loadedBytes, bytes.byteLength);
			timings.push(Object.freeze({ sourceId: input.sourceId, sha256: input.sha256, bytes }));
		}
		loadedBytes = safeAdd(loadedBytes, fingerprintNativeMediaPlan(plan).byteLength);
		if (loadedBytes > record.reservations.scratchBytes) {
			clearLoadedBodies({ sources, timings });
			throw new RangeError('The selected V14 scratch reservation cannot hold its authenticated inputs.');
		}
		return Object.freeze({ sources: Object.freeze(sources), timings: Object.freeze(timings) });
	}

	async #readBody(body: Readonly<FramescaperNativeProjectMediaBody>): Promise<Uint8Array> {
		const observed = await this.#options.project.readBody(body);
		if (!(observed instanceof Uint8Array) || observed.byteLength !== body.byteLength) {
			throw new Error('A selected V14 managed source body changed length.');
		}
		const bytes = new Uint8Array(observed);
		if (digest(bytes) !== body.sha256) throw new Error('A selected V14 managed source body changed digest.');
		return bytes;
	}

	#executeNative(attempt: NativeMediaV14ExecutionAttempt, loaded: LoadedBodies,
		derivedInputs: FramescaperNativeMediaV14RuntimeRequest['derivedInputs'],
		destination: FramescaperNativeMediaV14RuntimeRequest['destination'],
		onProgress: (value: number | null) => void): Promise<unknown> {
		return this.#options.runtime.executeV14(requestFor(
			attempt, loaded, derivedInputs, destination, onProgress,
		));
	}

	#executeWeb(attempt: NativeMediaV14ExecutionAttempt, loaded: LoadedBodies,
		derivedInputs: FramescaperNativeMediaV14RuntimeRequest['derivedInputs'],
		destination: FramescaperNativeMediaV14RuntimeRequest['destination'],
		onProgress: (value: number | null) => void): Promise<unknown> {
		void attempt; void loaded; void derivedInputs; void destination; void onProgress;
		return Promise.reject(Object.assign(new Error(
			'Native V14 execution requires the existing renderer-owned Web Core export route.',
		), { code: 'web-core-required' as const }));
	}

	async #rootValid(root: FramescaperNativeRootGrant): Promise<boolean> {
		const observed = await this.#options.probeRoot(root);
		return observed.exists && observed.directory && !observed.symbolicLink
			&& observed.canonicalPath === root.rootPath
			&& observed.volumeIdentity === root.volumeIdentity
			&& observed.directoryIdentity === root.directoryIdentity;
	}
}

function requestFor(attempt: NativeMediaV14ExecutionAttempt, loaded: LoadedBodies,
	derivedInputs: FramescaperNativeMediaV14RuntimeRequest['derivedInputs'],
	destination: FramescaperNativeMediaV14RuntimeRequest['destination'],
	onProgress: (value: number | null) => void,
): FramescaperNativeMediaV14RuntimeRequest {
	return Object.freeze({
		adapterVersion: 1, attempt, sourceBodies: loaded.sources,
		timingBodies: loaded.timings, derivedInputs, destination, onProgress,
	});
}

function storedV14Plan(record: NativeQueueRecordV3): UnifiedExactRenderPlanV14 {
	let value: unknown;
	try { value = JSON.parse(record.planPayload) as unknown; }
	catch { throw new Error('The selected V14 queue plan is not JSON.'); }
	const fingerprint = fingerprintNativeMediaPlan(value);
	if (record.planVersion !== 14 || (value as Record<string, unknown>).version !== 14
		|| fingerprint.sha256 !== record.planFingerprint || fingerprint.canonical !== record.planPayload) {
		throw new Error('The selected V14 queue plan changed exact identity.');
	}
	const envelope = createNativeMediaPlanEnvelopeV2(value);
	if (envelope.planVersion !== 14 || envelope.plan.version !== 14) {
		throw new Error('The selected native queue row does not carry a V14 plan.');
	}
	return envelope.plan;
}

function requestV14Plan(request: FramescaperNativeQueueEnqueueRequest): UnifiedExactRenderPlanV14 {
	let value: unknown;
	try { value = JSON.parse(request.planPayload) as unknown; }
	catch { throw new Error('The selected V14 queue reservation plan is not JSON.'); }
	const fingerprint = fingerprintNativeMediaPlan(value);
	const envelope = createNativeMediaPlanEnvelopeV2(value);
	if (request.planVersion !== 14 || envelope.planVersion !== 14 || envelope.plan.version !== 14
		|| fingerprint.sha256 !== request.planFingerprint || fingerprint.canonical !== request.planPayload) {
		throw new Error('The selected V14 queue reservation changed exact plan identity.');
	}
	return envelope.plan;
}

function onlyBody(bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
	predicate: (body: Readonly<FramescaperNativeProjectMediaBody>) => boolean, label: string): Readonly<FramescaperNativeProjectMediaBody> {
	const matches = bodies.filter(predicate);
	if (matches.length !== 1) throw new Error(`The selected V14 ${label} body is absent or duplicated.`);
	return matches[0]!;
}

function proxyBodyMetadataMatches(
	plan: Readonly<Record<string, unknown>>,
	inputs: NativeQueueRecordV3['inputFingerprints'],
	bodies: readonly Readonly<FramescaperNativeProjectMediaBody>[],
): boolean {
	try {
		if (inputs.length !== 1) return false;
		const input = inputs[0]!;
		const envelope = createNativeMediaPlanEnvelopeV2(plan);
		const planned = envelope.plan.sources.filter(({ sourceId, contentSha256 }) => (
			sourceId === input.sourceId && contentSha256 === input.sha256
		));
		if (planned.length !== 1) return false;
		onlyBody(bodies, (body) => body.kind === 'video-original'
			&& body.sourceId === input.sourceId && body.sha256 === input.sha256, 'proxy source');
		for (const timing of nativeMediaPlanVideoTimingAssetInputs(plan)) {
			onlyBody(bodies, (body) => body.kind === 'video-timing'
				&& body.storageKey === timing.storageKey && body.sha256 === timing.sha256, 'proxy timing');
		}
		return true;
	} catch { return false; }
}

function proxyRecipe(
	envelope: ReturnType<typeof createNativeMediaPlanEnvelopeV2>,
	inputs: NativeQueueRecordV3['inputFingerprints'],
): FramescaperNativeMediaProxyV14RuntimeRequest['recipe'] {
	if (inputs.length !== 1) throw new Error('A selected V14 proxy job must bind one source fingerprint.');
	const source = envelope.plan.sources.find(({ sourceId, contentSha256 }) => (
		sourceId === inputs[0]!.sourceId && contentSha256 === inputs[0]!.sha256
	));
	if (!source) throw new Error('The selected V14 proxy source is absent from its immutable plan.');
	const nodes = envelope.plan.nodes.filter((node) => node.kind === 'professional-media'
		&& node.sourceNodeId === source.nodeId);
	if (nodes.length !== 1) throw new Error('The selected V14 proxy source has no unique professional-media node.');
	const node = nodes[0];
	if (node.kind !== 'professional-media' || node.imageSequence !== null
		|| node.exportAuthority !== 'original') {
		throw new Error('Native ProRes proxy generation requires one ordinary original-authoritative source.');
	}
	const width = node.characteristics.codedWidth;
	const height = node.characteristics.codedHeight;
	if (width === null || height === null) {
		throw new Error('Native ProRes proxy generation requires reported source geometry.');
	}
	const geometry = resolveNativeMediaProxyGeometry(width, height);
	return Object.freeze({
		id: 'framescaper-native-prores-proxy-mov-v1',
		width: geometry.width, height: geometry.height,
	});
}

function proxyReceipt(value: unknown, fingerprint: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Selected V14 proxy execution returned no receipt.');
	}
	const row = value as Readonly<Record<string, unknown>>;
	if (Reflect.ownKeys(row).sort().join(',') !== 'byteLength,planFingerprint,publication,sha256'
		|| row.planFingerprint !== fingerprint || row.publication !== 'verified-temporary'
		|| !Number.isSafeInteger(row.byteLength) || Number(row.byteLength) < 1
		|| typeof row.sha256 !== 'string' || !SHA256.test(row.sha256)) {
		throw new Error('Selected V14 proxy execution did not authenticate its temporary MOV.');
	}
	return Object.freeze({
		planFingerprint: fingerprint, byteLength: Number(row.byteLength),
		sha256: row.sha256, publication: 'verified-temporary' as const,
	});
}

function v14ExecutionResult(value: unknown, fingerprint: string): NativeMediaV14ExecutionResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Selected V14 execution returned no result.');
	const result = value as Partial<NativeMediaV14ExecutionResult>;
	if (!['native', 'web-core'].includes(String(result.outcome))
		|| result.receipt?.publication !== 'verified-temporary'
		|| result.receipt.planFingerprint !== fingerprint) {
		throw new Error('Selected V14 execution did not verify its exact temporary output.');
	}
	return result as NativeMediaV14ExecutionResult;
}

function opaqueGrant(jobId: string, sourceId: string, sha256: string): string {
	return createHash('sha256').update(`${jobId}\0${sourceId}\0${sha256}`).digest('hex').slice(0, 40);
}
function digest(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
function safeAdd(left: number, right: number): number {
	const value = left + right;
	if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Selected V14 staged byte accounting overflowed.');
	return value;
}
function clearLoadedBodies(value: Pick<LoadedBodies, 'sources' | 'timings'>): void {
	for (const body of value.timings) body.bytes.fill(0);
}
