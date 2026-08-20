/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperCaptureSessionManifest,
	type FramescaperCaptureSessionManifestV1,
} from '../framescaper-capture-session-manifest.ts';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import { normalizeRational, roundRational } from '../timeline-time.ts';
import {
	createFramescaperCaptureAppComposition,
	type FramescaperCaptureAppComposition,
	type FramescaperCaptureAppCompositionOptions,
	type FramescaperCaptureAppStore,
} from './framescaper-capture-app-composition.ts';
import {
	createFramescaperCaptureProjectPublicationPort,
	framescaperCaptureProjectFence,
	type FramescaperCaptureProjectPublicationOptions,
} from './framescaper-capture-project-publication-port.ts';
import {
	FramescaperCaptureOriginProtectedError,
	type FramescaperCaptureOriginBinding,
	type FramescaperCaptureOriginGuardSnapshot,
} from './framescaper-capture-origin-guard.ts';
import type { FramescaperCaptureAdminInterlock } from './framescaper-capture-admin-interlock.ts';
import type { FramescaperCaptureProjectWriteLease } from './framescaper-capture-project-write-authority.ts';
import type {
	FramescaperCaptureSessionActions,
	FramescaperCaptureSessionService,
} from './framescaper-capture-session-types.ts';

type PassThroughOptions = Pick<FramescaperCaptureAppCompositionOptions,
	'mediaDevices' | 'createStream' | 'MediaRecorder' | 'MediaStreamTrackProcessor'
	| 'recordingControllerFactory' | 'getAudioContext' | 'AudioWorkletNode'
	| 'videoProbe' | 'helperTimingProbe' | 'ffmpeg' | 'desktopBridge'
	| 'createId' | 'now' | 'waitCountdown' | 'receiptTime'
	| 'recordRetryableRecovery' | 'scheduleDerivatives' | 'onWarning' | 'onChange'
>;

export interface FramescaperCaptureAppProject extends Record<string, unknown> {
	readonly id: string;
	readonly schemaVersion: 18 | 19;
	readonly revision: number;
	readonly updatedAt?: unknown;
	readonly sampleRate: number;
	readonly primarySequenceId: string;
	readonly sequences: readonly (Readonly<Record<string, unknown>> & {
		readonly id: string;
		readonly rate: Readonly<{ readonly num: number; readonly den: number }>;
		readonly trackIds: readonly string[];
	})[];
}

export interface FramescaperCaptureAppHistory {
	readonly present: FramescaperCaptureAppProject;
	readonly [key: string]: unknown;
}

export interface FramescaperCaptureAppProjectRepository {
	load(
		projectId: string,
		options?: Readonly<{ readonly revision?: number }>,
	): PromiseLike<FramescaperCaptureAppProject | null> | FramescaperCaptureAppProject | null;
	saveIfCurrent(
		expected: FramescaperCaptureAppProject,
		project: FramescaperCaptureAppProject,
	): PromiseLike<FramescaperCaptureAppProject | null> | FramescaperCaptureAppProject | null;
}

export interface FramescaperCaptureAppBindingStore extends FramescaperCaptureAppStore {
	readonly projectRepository?: FramescaperCaptureAppProjectRepository | null;
	loadProject?(
		projectId: string,
		options?: Readonly<{ readonly revision?: number }>,
	): PromiseLike<FramescaperCaptureAppProject | null> | FramescaperCaptureAppProject | null;
	saveProject?(
		project: FramescaperCaptureAppProject,
	): PromiseLike<FramescaperCaptureAppProject> | FramescaperCaptureAppProject;
	listProjects(): PromiseLike<readonly Readonly<{ readonly id: string }>[]> |
		readonly Readonly<{ readonly id: string }>[];
}

export interface FramescaperCaptureAppBindingOptions extends PassThroughOptions {
	readonly adminInterlock: Pick<FramescaperCaptureAdminInterlock, 'beginCaptureAdmission'>;
	readonly productId: string;
	readonly routeSchemaVersion: number;
	readonly isDesktop: boolean;
	readonly embedded: boolean;
	readonly store: FramescaperCaptureAppBindingStore;
	readonly sessionController: FramescaperCaptureProjectPublicationOptions<
		FramescaperCaptureAppProject,
		FramescaperCaptureAppHistory
	>['session'] & Readonly<{
		getSnapshot(): Readonly<{ readonly tabs: readonly Readonly<{ readonly projectId: string }>[] }>;
		openProject(project: FramescaperCaptureAppProject, options: Readonly<Record<string, unknown>>): unknown;
	}>;
	readonly projectRuntime: FramescaperCaptureProjectPublicationOptions<
		FramescaperCaptureAppProject,
		FramescaperCaptureAppHistory
	>['projectRuntime'];
	getActiveProject(): FramescaperCaptureAppProject | null;
	getActiveHistory(): FramescaperCaptureAppHistory | null;
	getActivePlayheadFrame(): number;
	setActiveProject(project: FramescaperCaptureAppProject): void;
	setActiveHistory(history: FramescaperCaptureAppHistory): void;
	synchronizeProject(project: FramescaperCaptureAppProject): PromiseLike<void> | void;
	assertProjectWritable(projectId: string): void;
	acquireProjectWriteAuthority(
		projectId: string,
	): PromiseLike<FramescaperCaptureProjectWriteLease> | FramescaperCaptureProjectWriteLease;
	prepareCaptureStart(): PromiseLike<void> | void;
}

/** Bind the maintained Framescaper routes to the standalone capture composition. */
export function createFramescaperCaptureAppBinding(
	options: FramescaperCaptureAppBindingOptions,
): Readonly<FramescaperCaptureAppComposition> | null {
	if (!options || typeof options !== 'object') {
		throw new TypeError('Framescaper capture app binding options are required.');
	}
	if (options.productId !== 'framescaper') return null;
	if (options.routeSchemaVersion !== (options.isDesktop ? 18 : 19)) return null;
	assertBindingOptions(options);
	const projects = createFramescaperCaptureAppProjectRepository(options);
	const projectPublication = createFramescaperCaptureProjectPublicationPort({
		projects,
		session: options.sessionController,
		projectRuntime: options.projectRuntime,
		assertProjectWritable: options.assertProjectWritable,
		acquireProjectWriteAuthority: options.acquireProjectWriteAuthority,
		isActiveProject: (projectId) => options.getActiveProject()?.id === projectId,
		setActiveProject: options.setActiveProject,
		setActiveHistory: options.setActiveHistory,
		synchronizeProject: options.synchronizeProject,
	});
	const composition = createFramescaperCaptureAppComposition({
		productId: 'framescaper',
		routeSchemaVersion: options.routeSchemaVersion,
		embedded: options.embedded,
		store: options.store,
		projectPublication,
		captureOrigin: () => captureOrigin(options),
		capturePublicationContext: (manifest) => deriveFramescaperCaptureAppPublicationContext(
			options, projects, manifest,
		),
		recoveryProjectIds: async () => projectIds(await options.store.listProjects()),
		prepareRecoveryOrigin: (projectId) => ensureFramescaperCaptureRecoveryOrigin(options, projects, projectId),
		...passThroughOptions(options),
		getAudioContext: options.getAudioContext,
		...(options.isDesktop ? { desktopBridge: options.desktopBridge } : { desktopBridge: null }),
	});
	return wrapPreparedStart(composition, options);
}

/** Ensure a recovered background origin has an inactive session-history owner. */
export async function ensureFramescaperCaptureRecoveryOrigin(
	options: Pick<FramescaperCaptureAppBindingOptions,
		'routeSchemaVersion' | 'sessionController' | 'projectRuntime'
	>,
	projects: FramescaperCaptureAppProjectRepository,
	projectIdValue: string,
): Promise<void> {
	const projectId = stableId(projectIdValue, 'Framescaper capture recovery project ID');
	if (options.sessionController.getSnapshot().tabs.some((tab) => tab.projectId === projectId)) return;
	const stored = await projects.load(projectId);
	if (!stored) throw new Error('Framescaper capture recovery origin project is unavailable.');
	const project = routeProject(stored, options.routeSchemaVersion);
	if (project.id !== projectId) throw new Error('Framescaper capture recovery origin identity changed.');
	options.sessionController.openProject(project, {
		activate: false,
		history: options.projectRuntime.createHistory(project),
		readOnly: false, readOnlyReason: null, dirty: false,
		lockMethod: 'capture-recovery-pending',
		metadata: Object.freeze({
			declaredReadOnly: false, intrinsicReadOnly: false,
			featureRequirementsReadOnly: false, captureRecoveryOrigin: true,
		}),
	});
}

/** Select local web CAS or the authoritative desktop witness/CAS surface. */
export function createFramescaperCaptureAppProjectRepository(
	options: Pick<FramescaperCaptureAppBindingOptions,
		'isDesktop' | 'store'
	>,
): Readonly<FramescaperCaptureAppProjectRepository> {
	const store = options.store;
	if (!options.isDesktop) {
		const repository = store.projectRepository;
		if (!repository || typeof repository.load !== 'function'
			|| typeof repository.saveIfCurrent !== 'function') {
			throw new TypeError('Framescaper web capture requires exact project repository CAS.');
		}
		const adapter: FramescaperCaptureAppProjectRepository = {
			load: (projectId, loadOptions) => repository.load(projectId, loadOptions),
			saveIfCurrent: (expected, project) => repository.saveIfCurrent(expected, project),
		};
		return Object.freeze(adapter);
	}
	if (typeof store.loadProject !== 'function' || typeof store.saveProject !== 'function') {
		throw new TypeError('Framescaper desktop capture requires authoritative project storage.');
	}
	const adapter: FramescaperCaptureAppProjectRepository = {
		load: (projectId, loadOptions) => store.loadProject!(projectId, loadOptions),
		async saveIfCurrent(expected, project) {
			if (expected.id !== project.id) {
				throw new Error('Framescaper desktop capture CAS cannot change project identity.');
			}
			const current = await store.loadProject!(expected.id);
			if (!current || !sameProject(current, expected)) return null;
			const saved = await store.saveProject!(project);
			if (!sameProject(saved, project)) {
				throw new Error('Framescaper desktop capture acknowledgement changed the project target.');
			}
			return saved;
		},
	};
	return Object.freeze(adapter);
}

/** Resolve deterministic publication geometry from the retained origin tab/base. */
export async function deriveFramescaperCaptureAppPublicationContext(
	options: Pick<FramescaperCaptureAppBindingOptions,
		'routeSchemaVersion' | 'sessionController'
	>,
	projects: FramescaperCaptureAppProjectRepository,
	manifestValue: FramescaperCaptureSessionManifestV1,
): Promise<Readonly<{
	readonly recordStartFrame: number;
	readonly projectSampleRate: number;
	readonly sequence: Readonly<{ readonly id: string; readonly rate: Readonly<{ readonly num: number; readonly den: number }> }>;
	readonly trackInsertionIndex: number;
}>> {
	const manifest = normalizeFramescaperCaptureSessionManifest(manifestValue);
	const captured = options.sessionController.captureProjectHistory(manifest.projectFence.projectId);
	let project = routeProject(captured.history.present, options.routeSchemaVersion);
	if (!sameFence(framescaperCaptureProjectFence(project), manifest.projectFence)) {
		const historical = await projects.load(manifest.projectFence.projectId, {
			revision: manifest.projectFence.baseRevision,
		});
		if (!historical) throw new Error('Framescaper capture origin base revision is unavailable.');
		project = routeProject(historical, options.routeSchemaVersion);
	}
	if (!sameFence(framescaperCaptureProjectFence(project), manifest.projectFence)) {
		throw new Error('Framescaper capture publication context changed its exact project fence.');
	}
	if (project.primarySequenceId !== manifest.origin.sequenceId) {
		throw new Error('Framescaper capture origin is no longer the retained primary sequence.');
	}
	const sequence = projectSequence(project, manifest.origin.sequenceId);
	return Object.freeze({
		recordStartFrame: microsecondsToFrames(manifest.origin.playheadMicroseconds, project.sampleRate),
		projectSampleRate: project.sampleRate,
		sequence: Object.freeze({ id: sequence.id, rate: sequence.rate }),
		trackInsertionIndex: sequence.trackIds.length,
	});
}

function captureOrigin(options: FramescaperCaptureAppBindingOptions) {
	const activeProject = routeProject(options.getActiveProject(), options.routeSchemaVersion);
	options.assertProjectWritable(activeProject.id);
	const activeHistory = options.getActiveHistory();
	if (!activeHistory) throw new Error('Framescaper capture requires an active project history.');
	const historyProject = routeProject(activeHistory.present, options.routeSchemaVersion);
	if (!sameProject(activeProject, historyProject)) {
		throw new Error('Framescaper capture active project and history are not the same revision.');
	}
	const primary = projectSequence(historyProject, historyProject.primarySequenceId);
	const playheadFrame = nonNegativeInteger(options.getActivePlayheadFrame(), 'capture playhead frame');
	return Object.freeze({
		projectFence: framescaperCaptureProjectFence(historyProject),
		origin: Object.freeze({
			sequenceId: primary.id,
			playheadMicroseconds: framesToMicroseconds(playheadFrame, historyProject.sampleRate),
			destination: 'both' as const,
		}),
	});
}

function routeProject(value: unknown, routeSchemaVersion: number): FramescaperCaptureAppProject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Framescaper capture requires an exact route project.');
	}
	const project = value as Partial<FramescaperCaptureAppProject>;
	if ((routeSchemaVersion !== 18 && routeSchemaVersion !== 19)
		|| project.schemaVersion !== routeSchemaVersion) {
		throw new RangeError('Framescaper capture project does not match its exact route schema.');
	}
	stableId(project.id, 'Framescaper capture project ID');
	nonNegativeInteger(project.revision, 'Framescaper capture project revision');
	positiveInteger(project.sampleRate, 'Framescaper capture project sample rate');
	stableId(project.primarySequenceId, 'Framescaper capture primary sequence ID');
	if (!Array.isArray(project.sequences) || !project.sequences.length) {
		throw new TypeError('Framescaper capture project requires sequences.');
	}
	return project as FramescaperCaptureAppProject;
}

function projectSequence(project: FramescaperCaptureAppProject, sequenceId: string) {
	const sequence = project.sequences.find(({ id }) => id === sequenceId);
	if (!sequence || stableId(sequence.id, 'Framescaper capture sequence ID') !== sequenceId
		|| !Array.isArray(sequence.trackIds)
		|| sequence.trackIds.some((id) => stableId(id, 'Framescaper capture track ID') !== id)) {
		throw new Error('Framescaper capture primary sequence is invalid or missing.');
	}
	const rate = normalizeRational(sequence.rate);
	if (rate.num <= 0) throw new RangeError('Framescaper capture sequence rate must be positive.');
	return Object.freeze({ id: sequence.id, rate: Object.freeze(rate), trackIds: sequence.trackIds });
}

function wrapPreparedStart(
	composition: Readonly<FramescaperCaptureAppComposition>,
	options: FramescaperCaptureAppBindingOptions,
): Readonly<FramescaperCaptureAppComposition> {
	let admissionGeneration = 0;
	let admission: Readonly<{
		readonly generation: number;
		readonly origin: FramescaperCaptureOriginBinding;
	}> | null = null;
	let startPromise: Promise<void> | null = null;
	let disposePromise: Promise<void> | null = null;
	let disposed = false;
	const actions: Readonly<FramescaperCaptureSessionActions> = Object.freeze({
		...composition.actions,
		start,
	});
	const service: Readonly<FramescaperCaptureSessionService> = Object.freeze({
		get snapshot() { return composition.snapshot; }, actions,
		initialize: () => composition.initialize(),
		settled,
		dispose,
	});
	return Object.freeze({
		service,
		get snapshot() { return composition.snapshot; },
		actions,
		initialize: () => composition.initialize(),
		dispose,
		originSnapshot,
		assertOriginEditAllowed: (projectId: string) => assertAllowed('edit', projectId),
		assertOriginCloseAllowed: (projectId: string) => assertAllowed('close', projectId),
		assertOriginDeleteAllowed: (projectId: string) => assertAllowed('delete', projectId),
		assertOriginHandoffAllowed: (projectId: string) => assertAllowed('handoff', projectId),
	});

	function start(): Promise<void> {
		if (disposed) return Promise.reject(new Error('Framescaper capture is disposed.'));
		if (startPromise) return startPromise;
		let resolve!: () => void;
		let reject!: (error: unknown) => void;
		const operation = new Promise<void>((accept, decline) => { resolve = accept; reject = decline; });
		startPromise = operation;
		void startReserved().then(resolve, reject);
		void operation.then(clearStart, clearStart);
		return operation;
		function clearStart() { if (startPromise === operation) startPromise = null; }
	}

	async function startReserved(): Promise<void> {
		const captured = captureOrigin(options);
		const interlock = options.adminInterlock.beginCaptureAdmission(captured.projectFence.projectId);
		try {
			admissionGeneration += 1;
			admission = Object.freeze({
				generation: admissionGeneration,
				origin: Object.freeze({
					...captured.projectFence,
					sequenceId: captured.origin.sequenceId,
					playheadMicroseconds: captured.origin.playheadMicroseconds,
				}),
			});
			notify();
			await options.prepareCaptureStart();
			if (disposed) throw new Error('Framescaper capture was disposed during start admission.');
			interlock.assertCurrent();
			const current = captureOrigin(options);
			if (!sameCaptureOrigin(captured, current)) {
				throw new Error('Framescaper capture origin changed during start admission.');
			}
			await composition.actions.start();
		} finally {
			admission = null;
			interlock.release();
			notify();
		}
	}

	function originSnapshot(projectId: string | null = null): Readonly<FramescaperCaptureOriginGuardSnapshot> {
		const snapshot = composition.originSnapshot(projectId);
		if (snapshot.active || !admission) return snapshot;
		const activeProjectIsOrigin = snapshot.activeProjectId === admission.origin.projectId;
		return Object.freeze({
			...snapshot, active: true, generation: admission.generation, origin: admission.origin,
			activeProjectIsOrigin,
			editBlocked: activeProjectIsOrigin, closeBlocked: activeProjectIsOrigin,
			deleteBlocked: activeProjectIsOrigin, handoffBlocked: activeProjectIsOrigin,
		});
	}

	function assertAllowed(
		action: 'edit' | 'close' | 'delete' | 'handoff',
		projectId: string,
	): void {
		const assertions = {
			edit: composition.assertOriginEditAllowed,
			close: composition.assertOriginCloseAllowed,
			delete: composition.assertOriginDeleteAllowed,
			handoff: composition.assertOriginHandoffAllowed,
		};
		if (composition.originSnapshot(projectId).active) {
			assertions[action](projectId);
			return;
		}
		if (admission?.origin.projectId === projectId) {
			throw new FramescaperCaptureOriginProtectedError(action, projectId, admission.generation);
		}
		assertions[action](projectId);
	}

	async function settled(): Promise<void> {
		await Promise.all([
			Promise.resolve(startPromise).catch(() => undefined),
			composition.service.settled(),
		]);
	}

	function dispose(): Promise<void> {
		if (disposePromise) return disposePromise;
		disposed = true;
		disposePromise = Promise.resolve().then(async () => {
			const [compositionResult] = await Promise.allSettled([
				composition.dispose(), Promise.resolve(startPromise).catch(() => undefined),
			]);
			if (compositionResult.status === 'rejected') throw compositionResult.reason;
		});
		return disposePromise;
	}

	function notify(): void {
		try { options.onChange?.(); } catch { /* Admission observers cannot own capture. */ }
	}
}

function sameCaptureOrigin(
	left: ReturnType<typeof captureOrigin>,
	right: ReturnType<typeof captureOrigin>,
): boolean {
	return sameFence(left.projectFence, right.projectFence)
		&& left.origin.sequenceId === right.origin.sequenceId
		&& left.origin.playheadMicroseconds === right.origin.playheadMicroseconds
		&& left.origin.destination === right.origin.destination;
}

function passThroughOptions(options: FramescaperCaptureAppBindingOptions): Partial<
	FramescaperCaptureAppCompositionOptions
> {
	const result: Record<string, unknown> = {};
	for (const key of PASS_THROUGH_KEYS) if (options[key] !== undefined) result[key] = options[key];
	return result;
}

const PASS_THROUGH_KEYS = Object.freeze([
	'mediaDevices', 'createStream', 'MediaRecorder', 'MediaStreamTrackProcessor',
	'recordingControllerFactory', 'getAudioContext', 'AudioWorkletNode', 'videoProbe',
	'helperTimingProbe', 'ffmpeg', 'createId', 'now', 'waitCountdown', 'receiptTime',
	'recordRetryableRecovery', 'scheduleDerivatives', 'onWarning', 'onChange',
] as const satisfies readonly (keyof FramescaperCaptureAppBindingOptions)[]);

function projectIds(projects: readonly Readonly<{ readonly id: string }>[]): readonly string[] {
	if (!Array.isArray(projects)) throw new TypeError('Framescaper capture project inventory is invalid.');
	return Object.freeze(projects.map(({ id }) => stableId(id, 'Framescaper capture project ID')));
}

function framesToMicroseconds(frame: number, sampleRate: number): number {
	return roundRational(BigInt(frame) * 1_000_000n, BigInt(sampleRate), 'point');
}

function microsecondsToFrames(microseconds: number, sampleRate: number): number {
	return roundRational(BigInt(nonNegativeInteger(microseconds, 'capture playhead microseconds'))
		* BigInt(sampleRate), 1_000_000n, 'point');
}

function sameFence(
	left: Readonly<{ readonly projectId: string; readonly baseRevision: number; readonly baseSha256: string }>,
	right: Readonly<{ readonly projectId: string; readonly baseRevision: number; readonly baseSha256: string }>,
): boolean {
	return left.projectId === right.projectId && left.baseRevision === right.baseRevision
		&& left.baseSha256 === right.baseSha256;
}

function sameProject(left: unknown, right: unknown): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 256
		|| /[\u0000-\u001f\u007f]/u.test(value)) throw new TypeError(`${name} is invalid.`);
	return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError(`${name} is invalid.`);
	return Number(value);
}

function positiveInteger(value: unknown, name: string): number {
	const integer = nonNegativeInteger(value, name);
	if (integer < 1) throw new RangeError(`${name} is invalid.`);
	return integer;
}

function assertBindingOptions(options: FramescaperCaptureAppBindingOptions): void {
	if (typeof options.isDesktop !== 'boolean' || typeof options.embedded !== 'boolean'
		|| !options.store || typeof options.store !== 'object'
		|| typeof options.store.listProjects !== 'function'
		|| typeof options.sessionController?.getSnapshot !== 'function'
		|| typeof options.sessionController?.openProject !== 'function'
		|| typeof options.getAudioContext !== 'function'
		|| typeof options.getActiveProject !== 'function'
		|| typeof options.getActiveHistory !== 'function'
		|| typeof options.getActivePlayheadFrame !== 'function'
		|| typeof options.setActiveProject !== 'function'
		|| typeof options.setActiveHistory !== 'function'
		|| typeof options.synchronizeProject !== 'function'
		|| typeof options.adminInterlock?.beginCaptureAdmission !== 'function'
		|| typeof options.assertProjectWritable !== 'function'
		|| typeof options.acquireProjectWriteAuthority !== 'function'
		|| typeof options.prepareCaptureStart !== 'function') {
		throw new TypeError('Framescaper capture app binding dependencies are incomplete.');
	}
}
