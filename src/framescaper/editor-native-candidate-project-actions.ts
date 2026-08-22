/* SPDX-License-Identifier: AGPL-3.0-only */

/** Dormant V25/V26 binding for the seven menu-owned native project actions. */

import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { canonicalizeNativeMediaPlan } from '../common/editor/native-media-plan-canonical-form.ts';
import {
	createNativeMediaPlanEnvelopeV1,
	NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES,
} from '../common/editor/native-media-plan-envelope.ts';
import {
	assertNativeMediaCapabilitySnapshotV1,
	isNativeMediaCapabilityUsable,
	nativeMediaCapabilityEntry,
	NATIVE_MEDIA_CAPABILITY_IDS,
	type NativeMediaCapabilityRefV1,
} from '../common/editor/native-media-capability-snapshot.ts';
import type { FramescaperNativeQueueEnqueueRendererRequest } from '../common/editor/ui/framescaper-native-services-lifecycle-bridge.ts';
import {
	bindFramescaperNativeProjectActionRuntime,
	createFramescaperNativeProjectActionSubsetRuntime,
	type FramescaperNativeProjectActionRuntime,
	type FramescaperNativeProjectActionSurface,
} from '../common/editor/ui/framescaper-native-project-actions.ts';
import type { ProjectDocument, ProjectRepositoryPort } from '../common/editor/storage/project-repository.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { normalizeVideoProxyAttachmentV18 } from '../common/editor/video-proxy-attachment-v18.ts';
import {
	createFramescaperImageSequenceSourceAdmissionCommandV25,
	type FramescaperProfessionalSourceStateV25,
} from './editor-project-v25-commands.ts';
import {
	createFramescaperProjectHistoryV25,
	executeFramescaperProjectCommandV25,
	type FramescaperProjectHistoryV25,
} from './editor-project-v25-history.ts';
import { FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v25.ts';
import { framescaperProjectStoreAuthorityV25 } from './editor-project-store-v25.ts';
import type { FramescaperProjectV25 } from './editor-project-v25.ts';
import {
	executeFramescaperProjectCommandV26,
	createFramescaperProjectHistoryV26,
	type FramescaperProjectHistoryV26,
} from './editor-project-v26-history.ts';
import { FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE } from './editor-project-runtime-profile-v26.ts';
import { framescaperProjectStoreAuthorityV26 } from './editor-project-store-v26.ts';
import type { FramescaperProjectV26 } from './editor-project-v26.ts';
import {
	FramescaperVideoProxyLifecycleV25,
	type FramescaperProxyProjectV25,
	type FramescaperProxyQueueJobV25,
	type FramescaperVideoSourceV25,
} from './editor-video-proxy-lifecycle-v25.ts';
import {
	composeFramescaperImageSequenceImportV25,
	type FramescaperImageSequenceImportPortsV25,
	type FramescaperImageSequenceSelectionV25,
} from './editor-native-image-sequence-import-v25.ts';

type Awaitable<Value> = Value | PromiseLike<Value>;
type CandidateProject = FramescaperProjectV25 | FramescaperProjectV26;
type CandidateHistory = FramescaperProjectHistoryV25 | FramescaperProjectHistoryV26;

const V25_SURFACES = Object.freeze([
	'image-sequence-import', 'render-queue-enqueue', 'proxy-generate',
	'proxy-attach', 'proxy-detach', 'proxy-relink',
] as const satisfies readonly FramescaperNativeProjectActionSurface[]);
const V26_SURFACES = Object.freeze([...V25_SURFACES, 'ofx-add'] as const);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export interface FramescaperNativeCandidateActionIntents {
	imageSequenceImport(project: CandidateProject):
		Awaitable<FramescaperImageSequenceSelectionV25 | null>;
	renderQueueEnqueue(project: CandidateProject):
		Awaitable<FramescaperNativeQueueEnqueueRendererRequest | null>;
	proxyGenerate(project: CandidateProject): Awaitable<Readonly<{
		readonly sourceId: string;
		readonly clearedPolicyRowIds: readonly string[];
	}> | null>;
	proxyAttach(project: CandidateProject): Awaitable<Readonly<{
		readonly sourceId: string;
		readonly attachment: unknown;
	}> | null>;
	proxyDetach(project: CandidateProject): Awaitable<Readonly<{
		readonly sourceId: string;
	}> | null>;
	proxyRelink(project: CandidateProject): Awaitable<Readonly<{
		readonly sourceId: string;
		readonly attachment: unknown;
	}> | null>;
	ofFxAdd?(project: FramescaperProjectV26): Awaitable<unknown | null>;
}

export interface FramescaperNativeCandidateActionOptions {
	readonly owner: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly projectId: string;
	readonly intents: FramescaperNativeCandidateActionIntents;
	readonly nativeServices: Readonly<{
		enqueue(request: FramescaperNativeQueueEnqueueRendererRequest): Promise<unknown>;
	}>;
	readonly imageSequence: FramescaperImageSequenceImportPortsV25;
	readonly proxy: Readonly<{
		enqueueProxy(job: FramescaperProxyQueueJobV25): Awaitable<string>;
		reattestAttachment(
			source: FramescaperVideoSourceV25,
			attachment: Readonly<Record<string, unknown>>,
		): Awaitable<boolean>;
		cleanupBody(storageKey: string): Awaitable<void>;
	}>;
	readonly now?: () => Date | string;
}

export interface FramescaperNativeCandidateActionBinding {
	readonly generation: 25 | 26;
	readonly runtime: FramescaperNativeProjectActionRuntime;
	project(): CandidateProject;
}

/**
 * Bind only an authenticated dormant candidate. V20 and adjacent generations
 * are refused before the owner receives a runtime.
 */
export async function bindFramescaperNativeCandidateProjectActions(
	options: FramescaperNativeCandidateActionOptions,
): Promise<FramescaperNativeCandidateActionBinding> {
	const generation = candidateGeneration(options.profile, options.store);
	const repository = exactRepository(options.store);
	const projectId = stableId(options.projectId, 'project ID');
	const project = await repository.load(projectId);
	if (project === null || Number(project.schemaVersion) !== generation) {
		throw new Error(`The dormant V${String(generation)} action project is unavailable.`);
	}
	const controller = new CandidateActionController(options, generation, repository, project);
	bindFramescaperNativeProjectActionRuntime(options.owner, controller.runtime);
	return controller.binding();
}

class CandidateActionController {
	readonly runtime: FramescaperNativeProjectActionRuntime;
	readonly #options: FramescaperNativeCandidateActionOptions;
	readonly #generation: 25 | 26;
	readonly #profile: unknown;
	readonly #repository: ProjectRepositoryPort;
	readonly #proxy: FramescaperVideoProxyLifecycleV25;
	#history: CandidateHistory;
	#tail: Promise<void> = Promise.resolve();

	constructor(
		options: FramescaperNativeCandidateActionOptions,
		generation: 25 | 26,
		repository: ProjectRepositoryPort,
		project: ProjectDocument,
	) {
		this.#options = options;
		this.#generation = generation;
		this.#profile = options.profile;
		this.#repository = repository;
		this.#history = generation === 25
			? createFramescaperProjectHistoryV25(options.profile, project)
			: createFramescaperProjectHistoryV26(options.profile, project);
		assertPorts(options, generation);
		this.#proxy = new FramescaperVideoProxyLifecycleV25({
			getProject: () => this.#present() as unknown as FramescaperProxyProjectV25,
			commitProject: (next) => this.#commitProxyProject(next),
			enqueueProxy: (job) => options.proxy.enqueueProxy(job),
			reattestAttachment: (source, attachment) => options.proxy.reattestAttachment(
				source, attachment as unknown as Readonly<Record<string, unknown>>,
			),
			cleanupBody: (storageKey) => options.proxy.cleanupBody(storageKey),
		});
		const actions = {
			'image-sequence-import': () => this.#serialized(() => this.#imageSequenceImport()),
			'render-queue-enqueue': () => this.#serialized(() => this.#renderQueueEnqueue()),
			'proxy-generate': () => this.#serialized(() => this.#proxyGenerate()),
			'proxy-attach': () => this.#serialized(() => this.#proxyAttach()),
			'proxy-detach': () => this.#serialized(() => this.#proxyDetach()),
			'proxy-relink': () => this.#serialized(() => this.#proxyRelink()),
			...(generation === 26 ? {
				'ofx-add': () => this.#serialized(() => this.#ofxAdd()),
			} : {}),
		};
		this.runtime = createFramescaperNativeProjectActionSubsetRuntime(
			generation === 25 ? V25_SURFACES : V26_SURFACES,
			actions,
		);
	}

	binding(): FramescaperNativeCandidateActionBinding {
		return Object.freeze({
			generation: this.#generation,
			runtime: this.runtime,
			project: () => structuredClone(this.#present()) as CandidateProject,
		});
	}

	async #imageSequenceImport(): Promise<void> {
		const project = this.#snapshot();
		await composeFramescaperImageSequenceImportV25({
			profile: this.#profile,
			project,
			select: () => this.#options.intents.imageSequenceImport(project),
			ports: this.#options.imageSequence,
			commit: async (sourceValue, projectBinClip) => {
				const source = createFramescaperImageSequenceSourceAdmissionCommandV25(sourceValue);
				if (ownDataField(projectBinClip, 'sourceId', 'image-sequence project-bin clip')
					!== source.source.id) {
					throw new Error('The image-sequence Project Bin clip must reference its admitted source.');
				}
				await this.#commitCommand({
					type: 'batch',
					commands: [source, { type: 'project-bin/add', clip: projectBinClip }],
				});
			},
		});
	}

	async #renderQueueEnqueue(): Promise<void> {
		await this.#requireNativeCapability(NATIVE_MEDIA_CAPABILITY_IDS.renderQueue, 'render queue');
		const project = this.#snapshot();
		const request = await this.#options.intents.renderQueueEnqueue(project);
		if (request === null) return;
		if (request.projectId !== project.id || request.projectRevision !== project.revision) {
			throw new Error('A candidate render queue request is stale or names another project.');
		}
		assertCandidateUnifiedRenderPlan(request, this.#generation);
		await this.#options.nativeServices.enqueue(request);
	}

	async #proxyGenerate(): Promise<void> {
		await this.#requireNativeCapability(NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec, 'proxy generation');
		const request = optionalRequest(
			await this.#options.intents.proxyGenerate(this.#snapshot()),
			['sourceId', 'clearedPolicyRowIds'], 'proxy generation',
		);
		if (request === null) return;
		const result = await this.#proxy.generate({
			sourceId: stableId(request.sourceId, 'proxy source ID'),
			clearedPolicyRowIds: policyRows(request.clearedPolicyRowIds),
		});
		if (result.status === 'blocked-policy') {
			throw new Error(`Proxy generation is blocked by policy: ${result.blockedPolicyRowIds.join(', ')}.`);
		}
	}

	async #proxyAttach(): Promise<void> {
		await this.#requireNativeCapability(NATIVE_MEDIA_CAPABILITY_IDS.proxyCodec, 'proxy attachment');
		const request = optionalRequest(
			await this.#options.intents.proxyAttach(this.#snapshot()),
			['sourceId', 'attachment'], 'proxy attachment',
		);
		if (request !== null) await this.#proxy.attach(
			await this.#attestedProxyAttachment(request.sourceId, request.attachment),
		);
	}

	async #proxyDetach(): Promise<void> {
		await this.#requireNativeMaster('proxy detach');
		const request = optionalRequest(
			await this.#options.intents.proxyDetach(this.#snapshot()),
			['sourceId'], 'proxy detach',
		);
		if (request !== null) await this.#proxy.detach({
			sourceId: stableId(request.sourceId, 'proxy source ID'),
		});
	}

	async #proxyRelink(): Promise<void> {
		await this.#requireNativeMaster('proxy relink');
		const request = optionalRequest(
			await this.#options.intents.proxyRelink(this.#snapshot()),
			['sourceId', 'attachment'], 'proxy relink',
		);
		if (request !== null) await this.#proxy.relink(
			await this.#attestedProxyAttachment(request.sourceId, request.attachment),
		);
	}

	async #attestedProxyAttachment(sourceIdValue: unknown, attachmentValue: unknown) {
		const sourceId = stableId(sourceIdValue, 'proxy source ID');
		const source = videoSource(this.#present(), sourceId);
		const attachment = normalizeVideoProxyAttachmentV18(attachmentValue);
		if (!await this.#options.proxy.reattestAttachment(source, attachment)) {
			throw new Error('The candidate proxy attachment could not be reattested.');
		}
		return Object.freeze({ sourceId, attachment });
	}

	async #ofxAdd(): Promise<void> {
		if (this.#generation !== 26 || typeof this.#options.intents.ofFxAdd !== 'function') {
			throw new Error('OpenFX authoring requires the dormant V26 candidate.');
		}
		await this.#requireNativeCapability(NATIVE_MEDIA_CAPABILITY_IDS.ofxHost, 'OpenFX authoring');
		const effect = await this.#options.intents.ofFxAdd(
			this.#snapshot() as FramescaperProjectV26,
		);
		if (effect === null) return;
		const instanceId = stableId(
			(effect as Readonly<Record<string, unknown>> | null)?.instanceId,
			'OpenFX instance ID',
		);
		await this.#commitCommand({
			type: 'openfx-effect/set', instanceId, expectedEffect: null, effect,
		});
	}

	async #commitProxyProject(next: FramescaperProxyProjectV25): Promise<void> {
		const current = this.#present();
		const sourceId = exactProxyMutation(current, next);
		const before = videoSource(current, sourceId);
		const after = videoSource(next as unknown as CandidateProject, sourceId);
		await this.#commitCommand({
			type: 'video-source/professional-state-set', sourceId,
			expectedState: professionalState(before), state: professionalState(after),
		});
	}

	async #commitCommand(command: unknown): Promise<void> {
		const expectedHistory = this.#history;
		const expected = this.#present();
		const now = this.#options.now?.();
		const nextHistory = this.#generation === 25
			? executeFramescaperProjectCommandV25(this.#profile, expectedHistory, command, { now })
			: executeFramescaperProjectCommandV26(this.#profile, expectedHistory, command, { now });
		const next = nextHistory.present;
		const saved = await this.#repository.saveIfCurrent!(
			expected as unknown as ProjectDocument,
			next as unknown as ProjectDocument,
		);
		if (saved === null) throw new Error('The candidate project changed before native action commit.');
		if (serializeScapeProjectDocument(saved) !== serializeScapeProjectDocument(next)) {
			throw new Error('The candidate repository changed the validated native action result.');
		}
		this.#history = nextHistory;
	}

	#serialized(operation: () => Promise<void>): Promise<void> {
		const result = this.#tail.then(operation, operation);
		this.#tail = result.then(() => undefined, () => undefined);
		return result;
	}

	async #nativeCapabilities() {
		const snapshot = structuredClone(await this.#options.imageSequence.capabilities());
		assertNativeMediaCapabilitySnapshotV1(snapshot);
		return snapshot;
	}

	async #requireNativeCapability(
		ref: NativeMediaCapabilityRefV1,
		label: string,
	): Promise<void> {
		const snapshot = await this.#nativeCapabilities();
		if (!isNativeMediaCapabilityUsable(nativeMediaCapabilityEntry(snapshot, ref.domain, ref.id))) {
			throw new Error(`Candidate ${label} is unavailable in the exact native runtime.`);
		}
	}

	async #requireNativeMaster(label: string): Promise<void> {
		if (!(await this.#nativeCapabilities()).masterEnabled) {
			throw new Error(`Candidate ${label} is unavailable while native media is off.`);
		}
	}

	#present(): CandidateProject { return this.#history.present as CandidateProject; }
	#snapshot(): CandidateProject { return structuredClone(this.#present()) as CandidateProject; }
}

function candidateGeneration(profile: unknown, store: unknown): 25 | 26 {
	if (profile === FRAMESCAPER_V25_PROJECT_RUNTIME_PROFILE) {
		framescaperProjectStoreAuthorityV25(profile, store);
		return 25;
	}
	if (profile === FRAMESCAPER_V26_PROJECT_CANDIDATE_PROFILE) {
		framescaperProjectStoreAuthorityV26(profile, store);
		return 26;
	}
	throw new TypeError('Only an authenticated dormant V25/V26 candidate can bind native actions.');
}

function assertCandidateUnifiedRenderPlan(
	request: FramescaperNativeQueueEnqueueRendererRequest,
	generation: 25 | 26,
): void {
	const expectedPlanVersion = generation === 25 ? 11 : 12;
	if (typeof request.planPayload !== 'string'
		|| request.planPayload.length > NATIVE_MEDIA_PLAN_CANONICAL_MAXIMUM_BYTES) {
		throw new TypeError('A candidate render plan payload must be bounded canonical JSON.');
	}
	let plan: unknown;
	try { plan = JSON.parse(request.planPayload) as unknown; }
	catch { throw new TypeError('A candidate render plan payload must be canonical JSON.'); }
	const envelope = createNativeMediaPlanEnvelopeV1(plan);
	if (request.planVersion !== expectedPlanVersion
		|| envelope.planVersion !== expectedPlanVersion
		|| request.derivedInputStageId !== null
		|| request.planFingerprint !== envelope.fingerprint
		|| request.planPayload !== canonicalizeNativeMediaPlan(plan)) {
		throw new Error(
			`The dormant V${String(generation)} candidate requires exact unified render plan V${String(expectedPlanVersion)}.`,
		);
	}
}

function exactRepository(store: unknown): ProjectRepositoryPort {
	const repository = (store as { readonly projectRepository?: ProjectRepositoryPort } | null)?.projectRepository;
	if (!repository || typeof repository.load !== 'function' || typeof repository.saveIfCurrent !== 'function') {
		throw new TypeError('Candidate native actions require an exact compare-and-swap repository.');
	}
	return repository;
}

function assertPorts(options: FramescaperNativeCandidateActionOptions, generation: 25 | 26): void {
	if (!options.owner || (typeof options.owner !== 'object' && typeof options.owner !== 'function')) {
		throw new TypeError('Candidate native actions require a controller owner.');
	}
	const intentMethods = [
		'imageSequenceImport', 'renderQueueEnqueue', 'proxyGenerate',
		'proxyAttach', 'proxyDetach', 'proxyRelink',
		...(generation === 26 ? ['ofFxAdd'] as const : []),
	] as const;
	exactMethodRecord(options.intents, intentMethods, 'candidate native action intents');
	if (typeof options.nativeServices?.enqueue !== 'function') {
		throw new TypeError('Candidate native actions require the native queue lifecycle.');
	}
	for (const method of [
		'capabilities', 'clearedPolicyRowIds', 'createSourcePackWriter',
		'publishInventory', 'cleanupInventory', 'admit',
	] as const) {
		if (typeof options.imageSequence?.[method] !== 'function') {
			throw new TypeError(`Candidate native actions require image-sequence port ${method}.`);
		}
	}
	for (const method of ['enqueueProxy', 'reattestAttachment', 'cleanupBody'] as const) {
		if (typeof options.proxy?.[method] !== 'function') {
			throw new TypeError(`Candidate native actions require proxy port ${method}.`);
		}
	}
}

function exactMethodRecord(
	value: unknown,
	methods: readonly string[],
	label: string,
): void {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== methods.length) {
		throw new TypeError(`Framescaper ${label} must be an exact method record.`);
	}
	for (const method of methods) {
		const descriptor = Object.getOwnPropertyDescriptor(value, method);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
			|| typeof descriptor.value !== 'function') {
			throw new TypeError(`Candidate native actions require intent ${method}.`);
		}
	}
}

function optionalRequest<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> | null {
	if (value === null) return null;
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
		|| Reflect.ownKeys(value).length !== fields.length
		|| fields.some((field) => !Object.hasOwn(value, field))) {
		throw new TypeError(`A candidate ${label} intent must be an exact record.`);
	}
	return value as Readonly<Record<Field, unknown>>;
}

function policyRows(value: unknown): readonly string[] {
	if (!Array.isArray(value) || value.length > 64 || Reflect.ownKeys(value).length !== value.length + 1) {
		throw new TypeError('Candidate proxy policy rows must be a bounded dense array.');
	}
	const rows = value.map((row) => stableId(row, 'policy row ID'));
	if (new Set(rows).size !== rows.length) throw new TypeError('Candidate proxy policy rows must be unique.');
	return Object.freeze(rows);
}

function exactProxyMutation(current: CandidateProject, next: FramescaperProxyProjectV25): string {
	const currentProxy = current as unknown as FramescaperProxyProjectV25;
	if (next.id !== currentProxy.id || next.schemaVersion !== currentProxy.schemaVersion
		|| next.revision !== currentProxy.revision + 1
		|| next.sources.length !== currentProxy.sources.length) {
		throw new Error('The proxy lifecycle changed project identity or topology.');
	}
	const currentRecord = structuredClone(current) as unknown as Record<string, unknown>;
	const nextRecord = structuredClone(next) as unknown as Record<string, unknown>;
	delete currentRecord.sources;
	delete nextRecord.sources;
	currentRecord.revision = nextRecord.revision;
	if (JSON.stringify(currentRecord) !== JSON.stringify(nextRecord)) {
		throw new Error('The proxy lifecycle changed unrelated project state.');
	}
	const changed: string[] = [];
	for (const before of currentProxy.sources) {
		const after = next.sources.find(({ id }) => id === before.id);
		if (!after) throw new Error('The proxy lifecycle changed source topology.');
		if (JSON.stringify(before) === JSON.stringify(after)) continue;
		const beforeRest = structuredClone(before) as unknown as Record<string, unknown>;
		const afterRest = structuredClone(after) as unknown as Record<string, unknown>;
		delete beforeRest.proxyAttachment;
		delete afterRest.proxyAttachment;
		if (before.kind !== 'video' || after.kind !== 'video'
			|| JSON.stringify(beforeRest) !== JSON.stringify(afterRest)) {
			throw new Error('The proxy lifecycle changed unrelated source state.');
		}
		changed.push(String(before.id));
	}
	if (changed.length !== 1) throw new Error('The proxy lifecycle must change one exact video source.');
	return changed[0]!;
}

function videoSource(project: CandidateProject, sourceId: string): FramescaperVideoSourceV25 {
	const source = (project as unknown as FramescaperProxyProjectV25).sources.find(
		({ id }) => id === sourceId,
	);
	if (!source || source.kind !== 'video') throw new Error('The proxy source is unavailable.');
	return source as unknown as FramescaperVideoSourceV25;
}

function professionalState(source: FramescaperVideoSourceV25): FramescaperProfessionalSourceStateV25 {
	return Object.freeze(structuredClone({
		characteristics: source.characteristics,
		imageSequence: (source as Readonly<{ imageSequence?: unknown }>).imageSequence ?? null,
		proxyAttachment: source.proxyAttachment,
	}) as FramescaperProfessionalSourceStateV25);
}

function stableId(value: unknown, label: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`Candidate ${label} is invalid.`);
	return value;
}

function ownDataField(value: unknown, name: string, label: string): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`Candidate ${label} must be an object.`);
	}
	const descriptor = Object.getOwnPropertyDescriptor(value, name);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Candidate ${label}.${name} must be an own data field.`);
	}
	return descriptor.value;
}
