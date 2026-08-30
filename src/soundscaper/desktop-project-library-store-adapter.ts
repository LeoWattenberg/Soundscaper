/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitProjectPublication } from '../common/editor/storage/project-publication-options.ts';
import {
	ProjectDuplicationIndeterminateError,
} from '../common/editor/storage/project-duplication.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import {
	createProjectStoreId,
	reportDesktopProjectLocalCleanupError,
} from '../common/editor/storage/project-store-defaults.ts';
import type { LinkedOriginalStoreService } from '../common/editor/storage/linked-original-store-service.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	assertSoundscaperProjectProfile,
	soundscaperProjectClone,
} from './editor-project-profile.ts';
import type {
	SoundscaperProject,
} from './editor-project-validation.ts';
import { soundscaperProjectStoreAuthority } from './editor-project-store.ts';
import type {
	SoundscaperDesktopProjectLibraryRenderer,
} from './desktop-project-library-renderer.ts';
import type {
	SoundscaperNativePluginStateBody,
} from './editor-native-plugin-state.ts';
import {
	assertSoundscaperDesktopProjectLibraryRendererComposition,
	SoundscaperDesktopProjectLibraryCommittedError,
	SoundscaperDesktopProjectLibraryIndeterminateError,
} from './desktop-project-library-renderer.ts';

export interface SoundscaperDesktopProjectStoreComposition {
	readonly localStore: SoundscaperDesktopProjectStoreLocal;
	readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryRenderer | null;
}

export interface SoundscaperDesktopProjectStoreLocal {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
	loadProject(projectId: string, options?: Readonly<{ revision?: number; signal?: AbortSignal }> | unknown):
		PromiseLike<unknown> | unknown;
	listProjects(): PromiseLike<readonly unknown[]> | readonly unknown[];
	readonly linkedOriginalStoreService: Pick<LinkedOriginalStoreService, 'deleteProject' | 'duplicateProject'>;
}

export type SoundscaperDesktopProjectStoreAdapter<Store> = Store & Readonly<{
	createProjectIfAbsent(project: unknown): Promise<SoundscaperProject | null>;
	saveProjectIfCurrent(expected: unknown, project: unknown, options?: unknown): Promise<SoundscaperProject | null>;
	restoreProjectSnapshotIfCurrent(projectId: string, expected: unknown, snapshot: unknown): Promise<false>;
	getNativePluginStateBodyMetadata(bodyId: string): Promise<Readonly<{
		byteLength: number; sha256: string;
	}> | null>;
	loadNativePluginStateBody(bodyId: string): Promise<Uint8Array | null>;
	persistNativePluginStateBody(
		bytes: Uint8Array,
		expected: Readonly<SoundscaperNativePluginStateBody>,
	): Promise<Readonly<SoundscaperNativePluginStateBody>>;
}>;

const COMPOSITION_FIELDS = ['localStore', 'desktopProjectLibrary'] as const;
const LOAD_FIELDS = ['revision', 'signal'] as const;
const SAVE_FIELDS = [
	'admitProjectPublication', 'protectedLinkedOriginalSourceReferences', 'protectedLinkedVideoSourceIds',
] as const;
const DUPLICATE_FIELDS = ['id', 'title'] as const;
const SCAPE_CREATION_FENCE_LOST = Symbol('scape-creation-fence-lost');

/** Keep web on the exact local identity; desktop receives a closed project-lifecycle overlay only. */
export function createSoundscaperDesktopProjectStoreAdapter<Store extends SoundscaperDesktopProjectStoreLocal>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{ readonly localStore: Store; readonly desktopProjectLibrary: null }>,
): Store;
export function createSoundscaperDesktopProjectStoreAdapter<Store extends SoundscaperDesktopProjectStoreLocal>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryRenderer;
	}>,
): SoundscaperDesktopProjectStoreAdapter<Store>;
export function createSoundscaperDesktopProjectStoreAdapter<Store extends SoundscaperDesktopProjectStoreLocal>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: SoundscaperDesktopProjectLibraryRenderer | null;
	}>,
): Store | SoundscaperDesktopProjectStoreAdapter<Store> {
	assertSoundscaperProjectProfile(profileValue);
	const composition = exactRecord(
		compositionValue, COMPOSITION_FIELDS, 'Soundscaper desktop  store composition',
	);
	const localStore = composition.localStore as Store;
	assertLocalStore(localStore);
	soundscaperProjectStoreAuthority(profileValue, localStore);
	const renderer = composition.desktopProjectLibrary;
	if (renderer === null) return localStore;
	assertSoundscaperDesktopProjectLibraryRendererComposition(profileValue, localStore, renderer);
	const lifecycle = ownData(localStore, 'linkedOriginalStoreService', 'Soundscaper production local store');
	if (!lifecycle || typeof lifecycle !== 'object'
		|| typeof inheritedData(lifecycle, 'deleteProject') !== 'function'
		|| typeof inheritedData(lifecycle, 'duplicateProject') !== 'function') {
		throw new TypeError('The exact Soundscaper production linked-original lifecycle is required.');
	}
	return new Proxy(localStore, proxyHandler(
		profileValue, localStore, renderer,
		lifecycle as SoundscaperDesktopProjectStoreLocal['linkedOriginalStoreService'],
	)) as
		SoundscaperDesktopProjectStoreAdapter<Store>;
}

function proxyHandler<Store extends SoundscaperDesktopProjectStoreLocal>(
	profile: EditorProjectRuntimeProfile,
	localStore: Store,
	renderer: SoundscaperDesktopProjectLibraryRenderer,
	lifecycle: SoundscaperDesktopProjectStoreLocal['linkedOriginalStoreService'],
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
					throw new Error('The definite desktop  delete cleanup tombstone is unavailable.');
				}
			});
			if (!await renderer.settleDeletedProject(projectId)) {
				throw new Error('The definite desktop  delete cleanup could not be settled.');
			}
			pendingDeleteCleanup.delete(projectId);
			return null;
		},
		saveProject: async (projectValue: unknown, optionsValue: unknown = {}) => {
			const options = saveOptions(optionsValue);
			const project = soundscaperProjectClone(profile, projectValue);
			await admitProjectPublication(localStore, project, options);
			return renderer.publishProject({ project });
		},
		saveProjectIfCurrent: async (
			expectedValue: unknown,
			projectValue: unknown,
			optionsValue: unknown = {},
		) => {
			const options = saveOptions(optionsValue);
			const expected = soundscaperProjectClone(profile, expectedValue);
			const project = soundscaperProjectClone(profile, projectValue);
			await admitProjectPublication(localStore, project, options);
			return renderer.publishProjectIfCurrent(expected, project);
		},
		// Desktop main cannot be rewound through its shadow-only repository,
		// so rollback is conservatively refused.
		restoreProjectSnapshotIfCurrent: async (
			_projectId: string, _expected: unknown, _snapshot: unknown,
		) => false as const,
		createProjectIfAbsent: async (projectValue: unknown) => {
			const project = soundscaperProjectClone(profile, projectValue);
			if (Number(project.revision) !== 0) {
				throw new Error('Soundscaper desktop  create requires fresh revision zero.');
			}
			const existing = await renderer.readProject(String(project.id));
			if (existing !== null) return null;
			return renderer.publishProject({ project });
		},
		createScapeProjectIfAbsent: (projectValue: unknown) => (
			renderer.createScapeProjectIfAbsent(soundscaperProjectClone(profile, projectValue))
		),
		getNativePluginStateBodyMetadata: async (bodyId: string) => {
			const body = await renderer.readNativePluginState(bodyId);
			return body === null ? null : Object.freeze({
				byteLength: body.byteLength,
				sha256: body.sha256,
			});
		},
		loadNativePluginStateBody: async (bodyId: string) => {
			const body = await renderer.readNativePluginState(bodyId);
			return body === null ? null : body.bytes;
		},
		persistNativePluginStateBody: async (
			bytes: Uint8Array,
			expected: Readonly<SoundscaperNativePluginStateBody>,
		) => {
			const persisted = await renderer.persistNativePluginState(bytes);
			if (persisted.bodyId !== expected.bodyId || persisted.byteLength !== expected.byteLength
				|| persisted.sha256 !== expected.sha256) {
				throw new Error('Desktop  native plug-in-state persistence changed its expected identity.');
			}
			return Object.freeze({ ...expected });
		},
		deleteProjectIfCurrent: async (projectValue: unknown) => {
			const project = soundscaperProjectClone(profile, projectValue);
			try {
				return await lifecycle.deleteProject(String(project.id), async () => {
					if (!await renderer.deleteProjectIfCurrent(project)) throw SCAPE_CREATION_FENCE_LOST;
					return true;
				});
			} catch (error) {
				if (error === SCAPE_CREATION_FENCE_LOST) return false;
				throw error;
			}
		},
		deleteProject: async (projectId: string) => {
			try {
				await lifecycle.deleteProject(projectId, () => renderer.deleteProject(projectId));
				try {
					if (await renderer.settleDeletedProject(projectId)) return;
					throw new SoundscaperDesktopProjectLibraryCommittedError(
						'delete', projectId, new Error('The durable delete intent could not be settled.'),
					);
				} catch (error) {
					if (error instanceof SoundscaperDesktopProjectLibraryCommittedError) throw error;
					throw new SoundscaperDesktopProjectLibraryCommittedError('delete', projectId, error);
				}
			} catch (error) {
				if (error instanceof SoundscaperDesktopProjectLibraryCommittedError
					&& error.operation === 'delete') {
					pendingDeleteCleanup.add(projectId);
					reportDesktopProjectLocalCleanupError();
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
						if ((error instanceof SoundscaperDesktopProjectLibraryCommittedError
							|| error instanceof SoundscaperDesktopProjectLibraryIndeterminateError)
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
	store: SoundscaperDesktopProjectStoreLocal,
	projectId: string,
): Promise<void> {
	if (await store.loadProject(projectId) !== null) {
		throw new Error('Soundscaper desktop  duplicate destination has an occupied local shadow.');
	}
}

function assertLocalStore(value: unknown): asserts value is SoundscaperDesktopProjectStoreLocal {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An exact Soundscaper production local store is required.');
	}
	for (const method of ['ready', 'estimateStorage', 'loadProject', 'listProjects'] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Soundscaper production local store requires ${method}.`);
		}
	}
}

function loadOptions(value: unknown): Readonly<{ revision?: number; signal?: AbortSignal }> {
	const raw = allowedRecord(value, LOAD_FIELDS, 'Soundscaper desktop  load options');
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
	return allowedRecord(value, SAVE_FIELDS, 'Soundscaper desktop  save options');
}

function duplicateOptions(value: unknown): Readonly<{ readonly id?: string; readonly title?: unknown }> {
	const raw = allowedRecord(value, DUPLICATE_FIELDS, 'Soundscaper desktop  duplicate options');
	if (raw.id !== undefined && (typeof raw.id !== 'string' || !raw.id)) {
		throw new TypeError('The Soundscaper desktop  duplicate project id is invalid.');
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
