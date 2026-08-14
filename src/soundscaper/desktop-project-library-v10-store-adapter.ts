/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitProjectPublication } from '../common/editor/storage/project-publication-options.ts';
import {
	ProjectDuplicationIndeterminateError,
} from '../common/editor/storage/project-duplication.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import {
	createProjectStoreId,
	reportDesktopSharedProjectLocalCleanupError,
} from '../common/editor/storage/project-store-defaults.ts';
import type { LinkedOriginalStoreService } from '../common/editor/storage/linked-original-store-service.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertSoundscaperProjectV21Profile } from './editor-project-v21-profile.ts';
import { soundscaperProjectStoreAuthorityV21 } from './editor-project-store-v21.ts';
import { cloneSoundscaperProjectV21, type SoundscaperProjectV21 } from './editor-project-v21.ts';
import type {
	SoundscaperDesktopProjectLibraryV10Renderer,
} from './desktop-project-library-v10-renderer.ts';
import {
	assertSoundscaperDesktopProjectLibraryV10RendererComposition,
	SoundscaperDesktopProjectLibraryV10CommittedError,
	SoundscaperDesktopProjectLibraryV10IndeterminateError,
} from './desktop-project-library-v10-renderer.ts';

export interface SoundscaperDesktopProjectStoreV10Composition {
	readonly localStore: SoundscaperDesktopProjectStoreV10Local;
	readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryV10Renderer | null;
}

export interface SoundscaperDesktopProjectStoreV10Local {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
	loadProject(projectId: string, options?: Readonly<{ revision?: number; signal?: AbortSignal }> | unknown):
		PromiseLike<unknown> | unknown;
	listProjects(): PromiseLike<readonly unknown[]> | readonly unknown[];
	readonly linkedOriginalStoreService: Pick<LinkedOriginalStoreService, 'deleteProject' | 'duplicateProject'>;
}

export type SoundscaperDesktopProjectStoreV10Adapter<Store> = Store & Readonly<{
	createProjectIfAbsent(project: unknown): Promise<SoundscaperProjectV21 | null>;
}>;

const COMPOSITION_FIELDS = ['localStore', 'desktopProjectLibrary'] as const;
const LOAD_FIELDS = ['revision', 'signal'] as const;
const SAVE_FIELDS = [
	'admitProjectPublication', 'protectedLinkedOriginalSourceReferences', 'protectedLinkedVideoSourceIds',
] as const;
const DUPLICATE_FIELDS = ['id', 'title'] as const;

/** Keep web on the exact local identity; desktop receives a closed project-lifecycle overlay only. */
export function createSoundscaperDesktopProjectStoreV10Adapter<Store extends SoundscaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{ readonly localStore: Store; readonly desktopProjectLibrary: null }>,
): Store;
export function createSoundscaperDesktopProjectStoreV10Adapter<Store extends SoundscaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryV10Renderer;
	}>,
): SoundscaperDesktopProjectStoreV10Adapter<Store>;
export function createSoundscaperDesktopProjectStoreV10Adapter<Store extends SoundscaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryV10Renderer | null;
	}>,
): Store | SoundscaperDesktopProjectStoreV10Adapter<Store> {
	assertSoundscaperProjectV21Profile(profileValue);
	const composition = exactRecord(
		compositionValue, COMPOSITION_FIELDS, 'Soundscaper desktop V10 store composition',
	);
	const localStore = composition.localStore as Store;
	assertLocalStore(localStore);
	soundscaperProjectStoreAuthorityV21(profileValue, localStore);
	const renderer = composition.desktopProjectLibrary;
	if (renderer === null) return localStore;
	assertSoundscaperDesktopProjectLibraryV10RendererComposition(profileValue, localStore, renderer);
	const lifecycle = ownData(localStore, 'linkedOriginalStoreService', 'Soundscaper V21 local store');
	if (!lifecycle || typeof lifecycle !== 'object'
		|| typeof inheritedData(lifecycle, 'deleteProject') !== 'function'
		|| typeof inheritedData(lifecycle, 'duplicateProject') !== 'function') {
		throw new TypeError('The exact Soundscaper V21 linked-original lifecycle is required.');
	}
	return new Proxy(localStore, proxyHandler(
		profileValue, localStore, renderer,
		lifecycle as SoundscaperDesktopProjectStoreV10Local['linkedOriginalStoreService'],
	)) as
		SoundscaperDesktopProjectStoreV10Adapter<Store>;
}

function proxyHandler<Store extends SoundscaperDesktopProjectStoreV10Local>(
	profile: EditorProjectRuntimeProfile,
	localStore: Store,
	renderer: SoundscaperDesktopProjectLibraryV10Renderer,
	lifecycle: SoundscaperDesktopProjectStoreV10Local['linkedOriginalStoreService'],
): ProxyHandler<Store> {
	const pendingDeleteCleanup = new Set<string>();
	const overrides = Object.freeze({
		listProjects: () => renderer.listProjects(),
		loadProject: async (projectId: string, optionsValue: unknown = {}) => {
			const options = loadOptions(optionsValue);
			if (options.revision !== undefined) return localStore.loadProject(projectId, options);
			const project = await renderer.readProject(projectId, options.signal ? { signal: options.signal } : {});
			if (project !== null) return project;
			if (!pendingDeleteCleanup.has(projectId)) return null;
			await lifecycle.deleteProject(projectId, async () => {
				if (!await renderer.cleanupDeletedProject(projectId)) {
					throw new Error('The definite desktop V10 delete cleanup tombstone is unavailable.');
				}
			});
			if (!await renderer.settleDeletedProject(projectId)) {
				throw new Error('The definite desktop V10 delete cleanup could not be settled.');
			}
			pendingDeleteCleanup.delete(projectId);
			return null;
		},
		saveProject: async (projectValue: unknown, optionsValue: unknown = {}) => {
			const options = saveOptions(optionsValue);
			const project = cloneSoundscaperProjectV21(projectValue);
			await admitProjectPublication(localStore, project, options);
			return renderer.publishProject({ project });
		},
		createProjectIfAbsent: async (projectValue: unknown) => {
			const project = cloneSoundscaperProjectV21(projectValue);
			if (Number(project.revision) !== 0) {
				throw new Error('Soundscaper desktop V10 create requires fresh revision zero.');
			}
			const existing = await renderer.readProject(String(project.id));
			if (existing !== null) return null;
			return renderer.publishProject({ project });
		},
		deleteProject: async (projectId: string) => {
			try {
				await lifecycle.deleteProject(projectId, () => renderer.deleteProject(projectId));
				try {
					if (await renderer.settleDeletedProject(projectId)) return;
					throw new SoundscaperDesktopProjectLibraryV10CommittedError(
						'delete', projectId, new Error('The durable delete intent could not be settled.'),
					);
				} catch (error) {
					if (error instanceof SoundscaperDesktopProjectLibraryV10CommittedError) throw error;
					throw new SoundscaperDesktopProjectLibraryV10CommittedError('delete', projectId, error);
				}
			} catch (error) {
				if (error instanceof SoundscaperDesktopProjectLibraryV10CommittedError
					&& error.operation === 'delete') {
					pendingDeleteCleanup.add(projectId);
					reportDesktopSharedProjectLocalCleanupError();
					return;
				}
				throw error;
			}
		},
		duplicateProject: async (sourceProjectId: string, optionsValue: unknown = {}) => {
			const options = duplicateOptions(optionsValue);
			const copyProjectId = options.id ?? createProjectStoreId('project');
			const timestamp = new Date().toISOString();
			await assertLocalDuplicateDestinationAbsent(localStore, copyProjectId);
			return lifecycle.duplicateProject({
				loadProject: (projectId) => renderer.readProject(projectId),
				listProjects: () => renderer.listProjects(),
				createProjectIfAbsent: async (copy: ProjectDocument) => {
					try {
						await assertLocalDuplicateDestinationAbsent(localStore, copyProjectId);
						return await renderer.duplicateProject(sourceProjectId, {
							id: String(copy.id),
							title: String(copy.title),
							timestamp: String(copy.createdAt),
						});
					} catch (error) {
						if ((error instanceof SoundscaperDesktopProjectLibraryV10CommittedError
							|| error instanceof SoundscaperDesktopProjectLibraryV10IndeterminateError)
							&& error.operation === 'duplicate') {
							throw new ProjectDuplicationIndeterminateError(copyProjectId, error);
						}
						throw error;
					}
				},
			}, {
				sourceProjectId,
				copyProjectId,
				...(options.title === undefined ? {} : { title: options.title }),
				timestamp,
			});
		},
		preservesProjectsOnClear: () => true,
	});
	return {
		get(target, property, receiver) {
			if (property === 'prepareProjectHandoff') return undefined;
			if (Object.hasOwn(overrides, property)) return overrides[property as keyof typeof overrides];
			const value = Reflect.get(target, property, receiver);
			return typeof value === 'function' ? value.bind(target) : value;
		},
		set: (target, property, value, receiver) => Reflect.set(target, property, value, receiver),
	};
}

async function assertLocalDuplicateDestinationAbsent(
	store: SoundscaperDesktopProjectStoreV10Local,
	projectId: string,
): Promise<void> {
	if (await store.loadProject(projectId) !== null) {
		throw new Error('Soundscaper desktop V10 duplicate destination has an occupied local shadow.');
	}
}

function assertLocalStore(value: unknown): asserts value is SoundscaperDesktopProjectStoreV10Local {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An exact Soundscaper V21 local store is required.');
	}
	for (const method of ['ready', 'estimateStorage', 'loadProject', 'listProjects'] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Soundscaper V21 local store requires ${method}.`);
		}
	}
}

function loadOptions(value: unknown): Readonly<{ revision?: number; signal?: AbortSignal }> {
	const raw = allowedRecord(value, LOAD_FIELDS, 'Soundscaper desktop V10 load options');
	if (raw.revision !== undefined && (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)) {
		throw new RangeError('The Soundscaper desktop project revision is invalid.');
	}
	if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
		throw new TypeError('A Soundscaper desktop load AbortSignal is required.');
	}
	return Object.freeze({
		...(raw.revision === undefined ? {} : { revision: Number(raw.revision) }),
		...(raw.signal === undefined ? {} : { signal: raw.signal as AbortSignal }),
	});
}

function saveOptions(value: unknown): Record<string, unknown> {
	return allowedRecord(value, SAVE_FIELDS, 'Soundscaper desktop V10 save options');
}

function duplicateOptions(value: unknown): Readonly<{ readonly id?: string; readonly title?: unknown }> {
	const raw = allowedRecord(value, DUPLICATE_FIELDS, 'Soundscaper desktop V10 duplicate options');
	if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id)) {
		throw new TypeError('The Soundscaper desktop V10 duplicate project id is invalid.');
	}
	return Object.freeze({
		...(raw.id === undefined ? {} : { id: raw.id }),
		...(raw.title === undefined ? {} : { title: raw.title }),
	});
}

function allowedRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`${name} must be a plain object.`);
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
	const result: Partial<Record<Field, unknown>> = {};
	for (const field of fields) {
		if (Object.hasOwn(value, field)) result[field] = ownData(value, field, name);
	}
	return result as Record<Field, unknown>;
}

function exactRecord<const Field extends string>(value: unknown, fields: readonly Field[], name: string) {
	const result = allowedRecord(value, fields, name);
	if (Reflect.ownKeys(value as object).length !== fields.length || fields.some((field) => !Object.hasOwn(value as object, field))) {
		throw new TypeError(`${name} has missing fields.`);
	}
	return result;
}

function ownData(value: object, field: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, field);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${field} must be an own data property.`);
	}
	return descriptor.value;
}

function inheritedData(value: object, field: string): unknown {
	let candidate: object | null = value;
	while (candidate) {
		const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
		if (descriptor) return Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
		candidate = Object.getPrototypeOf(candidate) as object | null;
	}
	return undefined;
}
