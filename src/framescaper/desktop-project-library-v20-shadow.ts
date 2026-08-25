/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import type {
	ProjectDocument,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';
import { cloneFramescaperProjectV31, type FramescaperProjectV31 } from './editor-project-v31.ts';

interface V31ShadowRepository {
	load(projectId: string, options?: Readonly<{ revision?: number; signal?: AbortSignal }> | unknown):
		PromiseLike<unknown> | unknown;
	listRevisions(projectId: string): PromiseLike<readonly ProjectRevision[]> | readonly ProjectRevision[];
	restore(projectId: string, snapshot: Readonly<{
		readonly current: ProjectDocument | null;
		readonly revisions: readonly Readonly<{
			readonly revision: number;
			readonly project: ProjectDocument;
		}>[];
	}>): PromiseLike<void> | void;
	delete(projectId: string): PromiseLike<void> | void;
}

export interface FramescaperDesktopProjectLibraryV20Shadow {
	reconcileCommittedProject(project: unknown, signal?: AbortSignal): Promise<FramescaperProjectV31>;
	deleteCommittedProject(projectId: string): Promise<void>;
}

/** Main-authenticated documents copy into IndexedDB only after their main operation commits. */
export function createFramescaperDesktopProjectLibraryV20Shadow(
	profile: EditorProjectRuntimeProfile,
	store: object,
): FramescaperDesktopProjectLibraryV20Shadow {
	const repository = shadowRepository(store);
	const revisionLimit = shadowRevisionLimit(store);
	return Object.freeze({
		reconcileCommittedProject: async (projectValue: unknown, signal?: AbortSignal) => {
			const project = cloneFramescaperProjectV31(profile, projectValue);
			const targetRevision = revisionNumber(project.revision);
			throwIfAborted(signal);
			const projectId = String(project.id);
			const [currentValue, entriesValue] = await Promise.all([
				repository.load(projectId, signal ? { signal } : {}),
				repository.listRevisions(projectId),
			]);
			throwIfAborted(signal);
			const current = currentValue == null ? null : cloneFramescaperProjectV31(profile, currentValue);
			const revisions = authenticatedRevisions(profile, projectId, entriesValue);
			const exactRevision = revisions.find(({ revision }) => revision === targetRevision)?.project ?? null;
			if (current && sameProject(current, project) && exactRevision && sameProject(exactRevision, project)) {
				return cloneFramescaperProjectV31(profile, project);
			}
			const historical = new Map<number, FramescaperProjectV31>();
			for (const entry of revisions) {
				if (entry.revision < targetRevision) historical.set(entry.revision, entry.project);
			}
			if (current) {
				const currentRevision = revisionNumber(current.revision);
				if (currentRevision < targetRevision) historical.set(currentRevision, current);
			}
			historical.set(targetRevision, project);
			await repository.restore(projectId, {
				current: project as unknown as ProjectDocument,
				revisions: [...historical.entries()]
					.sort(([left], [right]) => right - left)
					.slice(0, revisionLimit)
					.map(([revision, value]) => ({
						revision,
						project: value as unknown as ProjectDocument,
					})),
			});
			throwIfAborted(signal);
			const [storedCurrent, storedRevision] = await Promise.all([
				repository.load(projectId, signal ? { signal } : {}),
				repository.load(projectId, {
					revision: targetRevision,
					...(signal ? { signal } : {}),
				}),
			]);
			const currentProject = storedCurrent == null
				? null : cloneFramescaperProjectV31(profile, storedCurrent);
			const revisionProject = storedRevision == null
				? null : cloneFramescaperProjectV31(profile, storedRevision);
			if (!currentProject || !revisionProject
				|| !sameProject(currentProject, project) || !sameProject(revisionProject, project)) {
				throw new Error('The exact F31 IndexedDB shadow changed during V20 reconciliation.');
			}
			return cloneFramescaperProjectV31(profile, currentProject);
		},
		deleteCommittedProject: async (projectId: string) => {
			await repository.delete(projectId);
			if (await repository.load(projectId) !== null) {
				throw new Error('The F31 IndexedDB shadow remained after committed V20 deletion.');
			}
		},
	});
}

function shadowRepository(store: object): V31ShadowRepository {
	const descriptor = Object.getOwnPropertyDescriptor(store, 'projectRepository');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| !descriptor.value || typeof descriptor.value !== 'object') {
		throw new TypeError('The exact F31 IndexedDB shadow repository is required.');
	}
	const repository = descriptor.value as object;
	const methods = Object.freeze(Object.fromEntries([
		'load', 'listRevisions', 'restore', 'delete',
	].map((field) => {
		const method = inheritedMethod(repository, field);
		if (typeof method !== 'function') {
			throw new TypeError(`The exact F31 IndexedDB shadow repository requires ${field}.`);
		}
		return [field, (...args: unknown[]) => method.apply(repository, args)];
	})));
	return methods as unknown as V31ShadowRepository;
}

function shadowRevisionLimit(store: object): number {
	const descriptor = Object.getOwnPropertyDescriptor(store, 'revisionLimit');
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')
		|| !Number.isSafeInteger(descriptor.value) || Number(descriptor.value) < 2) {
		throw new TypeError('The exact F31 IndexedDB shadow revision limit is required.');
	}
	return Number(descriptor.value);
}

function authenticatedRevisions(
	profile: EditorProjectRuntimeProfile,
	projectId: string,
	value: readonly ProjectRevision[],
): readonly Readonly<{ revision: number; project: FramescaperProjectV31 }>[] {
	if (!Array.isArray(value)) throw new TypeError('The F31 IndexedDB revision inventory is invalid.');
	return value.map((entry) => {
		if (!entry || !Number.isSafeInteger(entry.revision) || entry.revision < 0) {
			throw new TypeError('The F31 IndexedDB revision descriptor is invalid.');
		}
		const project = cloneFramescaperProjectV31(profile, entry.project);
		if (String(project.id) !== projectId || project.revision !== entry.revision) {
			throw new Error('The F31 IndexedDB revision disagrees with its project document.');
		}
		return Object.freeze({ revision: entry.revision, project });
	});
}

function inheritedMethod(value: object, field: string): ((...args: unknown[]) => unknown) | undefined {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value')
			? descriptor.value as ((...args: unknown[]) => unknown) | undefined : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}

function sameProject(left: FramescaperProjectV31, right: FramescaperProjectV31): boolean {
	return serializeScapeProjectDocument(left) === serializeScapeProjectDocument(right);
}

function revisionNumber(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) {
		throw new TypeError('The F31 IndexedDB shadow project revision is invalid.');
	}
	return Number(value);
}

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
}
