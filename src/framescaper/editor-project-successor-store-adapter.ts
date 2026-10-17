/* SPDX-License-Identifier: AGPL-3.0-only */
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import type { ProjectDocument, ProjectRepositoryPort, ProjectLoadOptions, ProjectPostCommitMaintenance } from '../common/editor/storage/project-repository.ts';
import { admitProjectPublication, projectPublicationWarningOptions } from '../common/editor/storage/project-publication-options.ts';
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts';
import { ProjectCommittedMaintenanceError } from '../common/editor/storage/project-committed-maintenance-error.ts';
import { FramescaperCompositionLinkOwnerConflictError, type FramescaperCompositionLinkOwnerRepository, type FramescaperCompositionLinkOwnerReceipt } from './editor-composition-link-owner-repository.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import type { createFramescaperSuccessorRuntime } from './editor-project-successor-runtime.ts';
import { retainFramescaperSuccessorMediaHistory } from './editor-project-successor-media-roots.ts';
import { createFramescaperSuccessorLinkedTimingStore } from './editor-project-successor-linked-timing.ts';
import { normalizeFramescaperSuccessorHistory } from './editor-project-successor-history.ts';

type Runtime = ReturnType<typeof createFramescaperSuccessorRuntime>;
export type FramescaperSuccessorStoreAdapter = AudioEditorProjectStore & Readonly<{
	acceptOwnerReceipt(receipt: FramescaperCompositionLinkOwnerReceipt): FramescaperSuccessorProject;
	captureOwnerDigest(project: unknown): string;
	ownerWriteFence(id: string): string | undefined;
}>;
/** Canonical project APIs never reach the ordinary media database. Its internal rows exist only to retain bytes. */
export function createFramescaperSuccessorStoreAdapter({ media, owners, runtime, prepareOpen }: Readonly<{
	media: AudioEditorProjectStore; owners: FramescaperCompositionLinkOwnerRepository; runtime: Runtime;
	prepareOpen?: (id: string, signal?: AbortSignal) => Promise<void>;
}>): FramescaperSuccessorStoreAdapter {
	const known = new Map<string, { ownerDigest: string; projectDigest: string }>(); const fences = new Map<string, string>();
	const linkedTiming = createFramescaperSuccessorLinkedTimingStore();
	const digest = (value: unknown) => digestScapeBytes(new TextEncoder().encode(JSON.stringify(normalizeFramescaperSuccessorProject(value))));
	function acceptOwnerReceipt(receipt: FramescaperCompositionLinkOwnerReceipt) {
		known.set(receipt.project.id, { ownerDigest: receipt.ownerDigest, projectDigest: digest(receipt.project) });
		const project = runtime.retainStoredHistory(receipt.history); linkedTiming.retain(receipt.history); return project;
	}
	function captureOwnerDigest(value: unknown): string {
		const project = normalizeFramescaperSuccessorProject(value); const expected = known.get(project.id);
		if (!expected || expected.projectDigest !== digest(project)) throw new FramescaperCompositionLinkOwnerConflictError('Successor stored owner changed; reload before publishing.'); return expected.ownerDigest;
	}
	async function load(projectId: string, options: ProjectLoadOptions = {}): Promise<FramescaperSuccessorProject | null> {
		options.signal?.throwIfAborted(); const receipt = await owners.loadOwner(projectId); options.signal?.throwIfAborted();
		if (!receipt) { known.delete(projectId); linkedTiming.forget(projectId); return null; }
		await prepareOpen?.(projectId, options.signal); options.signal?.throwIfAborted();
		if (options.revision !== undefined && options.revision !== receipt.project.revision) {
			const found = [...receipt.history.undoStack, ...receipt.history.redoStack].find(entry => entry.project.revision === options.revision);
			return found?.project ?? null;
		}
		return acceptOwnerReceipt(receipt);
	}
	async function publish(value: unknown, expectedDigest: string | null, writeFence: string | undefined, options: unknown = {}, initial = false) {
		const project = normalizeFramescaperSuccessorProject(value);
		const history = initial ? normalizeFramescaperSuccessorHistory(runtime.createHistory(value)) : runtime.historyForSnapshot(value);
		await admitProjectPublication(media, project, options); await retainFramescaperSuccessorMediaHistory(media, history);
		const warnings = projectPublicationWarningOptions(options); warnings.signal?.throwIfAborted(); warnings.assertCurrent?.();
		return acceptOwnerReceipt(await owners.saveOwner(project, expectedDigest, history, writeFence ? { writeFence } : {}));
	}
	async function conditional(expected: unknown, value: unknown, writeFence: string | undefined, options: unknown = {}) {
		try { return await publish(value, captureOwnerDigest(expected), writeFence, options); }
		catch (error) { if (error instanceof FramescaperCompositionLinkOwnerConflictError) return null; throw error; }
	}
	async function create(value: unknown, options: unknown = {}) {
		const project = normalizeFramescaperSuccessorProject(value); if (project.revision !== 0) throw new RangeError('New successor owners require revision zero; import archives through their custody transaction.');
		if (await owners.loadOwner(project.id)) return null;
		try { return await publish(value, null, fences.get(project.id), options, true); }
		catch (error) { if (error instanceof FramescaperCompositionLinkOwnerConflictError) return null; throw error; }
	}
	async function save(value: unknown, options: unknown = {}) {
		const project = normalizeFramescaperSuccessorProject(value); const expected = known.get(project.id);
		if (!expected) throw new FramescaperCompositionLinkOwnerConflictError('Open the successor owner before saving.');
		return publish(value, expected.ownerDigest, fences.get(project.id), options);
	}
	async function remove(value: unknown) {
		try { const project = normalizeFramescaperSuccessorProject(value); const removed = await owners.deleteOwner(project.id, captureOwnerDigest(project), { writeFence: fences.get(project.id) }); if (removed) { known.delete(project.id); linkedTiming.forget(project.id); } return removed; }
		catch (error) { if (error instanceof FramescaperCompositionLinkOwnerConflictError) return false; throw error; }
	}
	const list = async () => (await owners.listOwners()).map(entry => entry.project);
	const claim = async (id: string) => { const token = await owners.claimOwnerWriteFence(id); fences.set(id, token); return token; };
	const revisions = async (id: string) => {
		const receipt = await owners.loadOwner(id); if (!receipt) return [];
		return [receipt.project, ...receipt.history.undoStack.map(entry => entry.project), ...receipt.history.redoStack.map(entry => entry.project)].map(project => ({ revision: Number(project.revision), project }));
	};
	const unavailable = async (): Promise<never> => { throw new Error('Use the successor custody workflow for this project operation.'); };
	const post = async <T extends ProjectDocument | null>(operation: Promise<T>, maintenance?: ProjectPostCommitMaintenance): Promise<T> => {
		const result = await operation; if (result !== null) { try { await maintenance?.(); } catch (error) { throw new ProjectCommittedMaintenanceError(result, error); } } return result;
	};
	const projectRepository: ProjectRepositoryPort = Object.freeze({ load, list, listRevisions: revisions,
		createIfAbsent: create, createForScapeImportIfAbsent: unavailable,
		save: (project: ProjectDocument, maintenance?: ProjectPostCommitMaintenance) => post(save(project), maintenance),
		saveIfCurrent: (expected: ProjectDocument, project: ProjectDocument, maintenance?: ProjectPostCommitMaintenance) => post(conditional(expected, project, fences.get(project.id)), maintenance),
		saveIfCurrentAndFenced: (expected: ProjectDocument, project: ProjectDocument, token: string, maintenance?: ProjectPostCommitMaintenance) => post(conditional(expected, project, token), maintenance),
		claimWriteFence: claim, deleteIfCurrent: remove, deleteExact: remove,
		delete: async (id: string) => { const project = await load(id); if (project && !await remove(project)) throw new FramescaperCompositionLinkOwnerConflictError('Successor deletion lost write ownership.'); },
	});
	const overrides = Object.freeze({ projectRepository, acceptOwnerReceipt, captureOwnerDigest, ownerWriteFence: (id: string) => fences.get(id),
		loadMediaAsset: async (key: string, options?: Readonly<{ signal?: AbortSignal }>) => linkedTiming.read(key, options?.signal) ?? await media.loadMediaAsset(key, options),
		loadProject: load, listProjects: list, listProjectRevisions: revisions, createProjectIfAbsent: create,
		createScapeProjectIfAbsent: unavailable, duplicateProject: unavailable, restoreProjectSnapshot: unavailable,
		restoreProjectSnapshotIfCurrent: async () => false, restoreProjectSnapshotIfCurrentWithWriteFence: async () => false,
		claimProjectWriteFence: claim, saveProject: save,
		saveProjectIfCurrent: (expected: unknown, project: ProjectDocument, options?: unknown) => conditional(expected, project, fences.get(project.id), options),
		saveProjectIfCurrentWithWriteFence: (expected: unknown, project: unknown, token: string, options?: unknown) => conditional(expected, project, token, options),
		deleteProjectIfCurrent: remove, deleteProject: projectRepository.delete,
		maintainOpenedProject: async () => undefined,
		clear: unavailable, preservesProjectsOnClear: () => true, prepareProjectHandoff: undefined,
	});
	return new Proxy(media, { get(target, property) {
		if (Object.hasOwn(overrides, property)) return overrides[property as keyof typeof overrides];
		const value: unknown = Reflect.get(target, property, target); return typeof value === 'function' ? value.bind(target) : value;
	} }) as FramescaperSuccessorStoreAdapter;
}
