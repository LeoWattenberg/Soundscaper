/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';

import type {
	ProjectAdminServiceRuntime,
} from '../src/common/editor/controller/project-admin-service.ts';
import type { ProjectLinkedOriginalSourceReference } from '../src/common/editor/storage/project-publication-options.ts';

export interface Project {
	readonly id: string;
	readonly title: string;
	readonly revision: number;
}

export function deferred() {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((complete) => { resolve = complete; });
	return { promise, resolve };
}

export class TestSourceChunkProviders extends Map<string, unknown> {
	readonly #calls: string[];
	readonly #drainOperation: () => Promise<void>;

	constructor(calls: string[], drainOperation: () => Promise<void>) {
		super([['provider-source', {}]]);
		this.#calls = calls;
		this.#drainOperation = drainOperation;
	}

	override clear(): void {
		this.#calls.push('clear-providers');
		super.clear();
	}

	async drain(): Promise<void> {
		this.#calls.push('drain-providers:start');
		await this.#drainOperation();
		this.#calls.push('drain-providers:done');
	}
}

export function createFixture() {
	let project: Project | null = { id: 'project-a', title: 'Project A', revision: 3 };
	let closeResult: { closed: boolean; activeProjectId?: string } = { closed: true };
	let closeObserver: () => void = () => undefined;
	let pruneResult: { deletedSourceIds?: string[]; nextEligibleAt?: number | null } = {};
	let pruneOptions: { readonly protectedSourceIds: Set<string> } | null = null;
	const calls: string[] = [];
	let stopRecording = async () => { calls.push('stop-recording'); };
	let saveSuspended = false;
	let saveAdmissions = 0;
	let projectGeneration = 1;
	let activeGenerationProjectId: string | null = 'project-a';
	let activationReservation: object | null = null;
	const historyToken = Object.freeze({});
	const savedProjects: Project[] = [];
	const savedProjectOptions: Array<Readonly<{
		protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
	}>> = [];
	const scheduled: Array<{ callback: () => void; delay: number }> = [];
	const tabs = new Map<string, {
		projectId: string;
		dirty: boolean;
		readOnly: boolean;
		history: { present: Project };
		metadata?: Readonly<{
			declaredReadOnly?: boolean;
			featureRequirementsReadOnly?: boolean;
			intrinsicReadOnly?: boolean;
		}>;
	}>();
	tabs.set('project-a', {
		projectId: 'project-a', dirty: false, readOnly: false,
		history: { present: project },
	});
	const sourceBuffers = new Map<string, unknown>([['buffer', {}], ['deleted', {}]]);
	const sourceChunkProviders = new Map<string, unknown>([['deleted', {}]]);
	const sourcePeaks = new Map<string, unknown>([['peak', {}], ['deleted', {}]]);
	const state = {
		readOnly: false,
		projectLock: { projectId: 'project-a', readOnly: false },
		recordingRouting: { input: 'mic' },
		missingSourceIds: new Set(['deleted']),
		disposed: false,
		sourceGcTimer: 7,
		history: {},
		projects: [] as readonly Project[],
		selectedTrackId: 'track',
		selectedClipId: 'clip',
		selectedAnnotationId: 'annotation',
	};
	const projectSaveService = {
		cancelScheduled: () => { calls.push('cancel-save'); },
		drain: async () => { calls.push('drain-save'); },
		flushProject: () => {
			if (saveSuspended) return undefined;
			saveAdmissions += 1;
			calls.push('flush-save-admitted');
			return Promise.resolve();
		},
		pendingSnapshots: [{ id: 'pending' }],
		resume: () => {
			calls.push('resume-save');
			saveSuspended = false;
		},
		scheduleAutosave: () => {
			if (saveSuspended) return false;
			saveAdmissions += 1;
			calls.push('autosave-admitted');
			return true;
		},
		suspend: () => {
			calls.push('suspend-save');
			saveSuspended = true;
			calls.push('cancel-save');
		},
	};
	const sessionController = {
		getSnapshot: () => ({ tabs: [...tabs.values()] }),
		captureProjectHistory(projectId: string) {
			const tab = tabs.get(projectId);
			if (!tab) throw new ReferenceError('Project tab is missing.');
			calls.push(`capture-history:${projectId}`);
			return Object.freeze({ history: structuredClone(tab.history), token: historyToken });
		},
		beginProjectActivation(projectId: string, options: { expectedHistoryToken?: unknown }) {
			if (activationReservation || options.expectedHistoryToken !== historyToken) {
				throw new DOMException('The project is reserved for activation.', 'AbortError');
			}
			calls.push(`reserve-history:${projectId}`);
			const reservation = Object.freeze({});
			activationReservation = reservation;
			return Object.freeze({
				token: Object.freeze({}),
				release() {
					if (activationReservation !== reservation) return false;
					calls.push(`release-history:${projectId}`);
					activationReservation = null;
					return true;
				},
			});
		},
		closeProject(projectId: string) {
			if (activationReservation) throw new DOMException('The project is reserved for activation.', 'AbortError');
			calls.push(`close:${projectId}`);
			closeObserver();
			return closeResult;
		},
		switchProject(projectId: string) {
			if (activationReservation) throw new DOMException('The project is reserved for activation.', 'AbortError');
			calls.push(`competing-switch:${projectId}`);
		},
		clearClipboard: () => { calls.push('clear-clipboard'); },
		markProjectSaved: (projectId: string) => { calls.push(`marked:${projectId}`); },
	};
	const store = {
		async duplicateProject(_projectId: string, options: { title: string }) {
			calls.push(`duplicate:${options.title}`);
			return { id: 'copy', title: options.title, revision: 1 };
		},
		async listProjects() {
			calls.push('list');
			return [{ id: 'listed', title: 'Listed', revision: 1 }];
		},
		async saveProject(value: Project, options: Readonly<{
			protectedLinkedOriginalSourceReferences?: readonly ProjectLinkedOriginalSourceReference[];
		}> = {}) {
			savedProjects.push(value);
			savedProjectOptions.push(options);
		},
		async deleteProject(projectId: string) { calls.push(`delete:${projectId}`); },
		async prepareProjectHandoff(project: Project) { calls.push(`handoff:${project.id}`); },
		async pruneUnreferencedSources(options: unknown) {
			calls.push('prune');
			assert.ok(options);
			pruneOptions = options as { readonly protectedSourceIds: Set<string> };
			return pruneResult;
		},
		async clear() { calls.push('clear-store'); },
	};
	const runtime = {
		cancelPlaybackCachePreparation: () => { calls.push('cancel-cache'); },
		clearScheduledTimer: (timer: number) => { calls.push(`clear-timer:${timer}`); },
		clearWaveformPcmWindows: () => { calls.push('clear-windows'); },
		clipTimePitchCache: {
			retainClipIds: () => { calls.push('retain-clips'); },
			clear: () => { calls.push('clear-time-pitch'); },
		},
		commit: (command: { title: string }) => {
			if (!state.history) throw new Error('An active project history is required.');
			calls.push(`rename:${command.title}`);
		},
		copy: {
			projectNotFound: 'Project not found.',
			projectReadOnly: 'Project is read-only.',
			projectTitleRequired: 'A title is required.',
			projectCopySuffix: 'copy',
		},
		currentTimeMs: () => 1_000,
		disposeRenderEngines: async () => { calls.push('dispose-render-engines'); },
		editorHistoryProjects: (history: { present: Project }) => [history.present],
		engine: { stop: () => { calls.push('stop-engine'); } },
		evictUnreferencedSourceCaches: () => { calls.push('evict'); },
		flushProject: async () => { calls.push('flush'); },
		getProject: () => project,
		handleError: (error: unknown) => { calls.push(`error:${String(error)}`); },
		liveSessionClipIds: () => new Set(['clip']),
		liveSessionLinkedOriginalSourceReferences: () => Object.freeze([
			Object.freeze({ kind: 'audio' as const, sourceId: 'live' }),
			Object.freeze({ kind: 'video' as const, sourceId: 'live' }),
		]),
		liveSessionSourceIds: () => new Set<string>(['live']),
		newProject: async () => { calls.push('new-project'); },
		openProject: async (value: Project) => { calls.push(`open:${value.id}`); },
		persistSetting: async (key: string, value: unknown) => { calls.push(`persist:${key}:${String(value)}`); },
		projectSaveService,
		projectGeneration: {
			activate(projectId: string) {
				projectGeneration += 1;
				activeGenerationProjectId = projectId;
				calls.push(`activate-generation:${projectId}`);
			},
			invalidate() {
				projectGeneration += 1;
				activeGenerationProjectId = null;
				calls.push('invalidate-generation');
			},
		},
		projectSessionService: {
			clearRecentProjects: async () => {
				calls.push('clear-recents');
				return [];
			},
		},
		publishDocumentSnapshot: () => { calls.push('publish'); },
		recordingRoutingSettingKey: (id: string) => `routing:${id}`,
		releaseProjectLock: async () => { calls.push('release'); },
		revokeVideoVisuals: () => { calls.push('revoke-video'); },
		saveNow: async () => { calls.push('save'); },
		scheduleTimer: (callback: () => void, delay: number) => {
			scheduled.push({ callback, delay });
			return 9;
		},
		sessionController,
		sessionTab: (projectId: string) => tabs.get(projectId) || null,
		setProject: (value: Project | null) => { project = value; },
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		stopProjectBinPreview: async (options) => { assert.equal(options.dispose, true); calls.push('stop-bin-preview'); },
		stopRecording: () => stopRecording(),
		store,
		switchProject: async (value: Project) => { calls.push(`switch:${value.id}`); },
	} as ProjectAdminServiceRuntime & {
		readonly projectGeneration: Readonly<{ activate(projectId: string): void; invalidate(): void }>;
	};
	return {
		calls,
		project: () => project,
		setProject: (value: Project | null) => { project = value; },
		setStopRecording: (value: () => Promise<void>) => { stopRecording = value; },
		closeResult: (value: typeof closeResult) => { closeResult = value; },
		setCloseObserver: (value: () => void) => { closeObserver = value; },
		reservationActive: () => activationReservation !== null,
		saveAdmissions: () => saveAdmissions,
		saveSuspended: () => saveSuspended,
		captureProjectGeneration: () => Object.freeze({
			generation: projectGeneration,
			projectId: activeGenerationProjectId,
		}),
		isProjectGenerationCurrent: (token: Readonly<{ generation: number; projectId: string | null }>) => (
			token.generation === projectGeneration && token.projectId === activeGenerationProjectId
		),
		pruneOptions: () => pruneOptions,
		pruneResult: (value: typeof pruneResult) => { pruneResult = value; },
		runtime,
		savedProjectOptions,
		savedProjects,
		scheduled,
		sourceBuffers,
		sourceChunkProviders,
		sourcePeaks,
		state,
		tabs,
	};
}
