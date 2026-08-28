/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitProjectPublication } from '../common/editor/storage/project-publication-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	assertFramescaperDesktopProjectLibraryRendererComposition,
	type FramescaperDesktopProjectLibraryRenderer,
} from './desktop-project-library-renderer.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';
import { framescaperProjectStoreAuthority } from './editor-project-store.ts';
import { cloneFramescaperProject, type FramescaperProject } from './editor-project.ts';

const COMPOSITION_FIELDS = ['localStore', 'desktopProjectLibrary'] as const;
const LOAD_FIELDS = ['revision', 'signal'] as const;
const SAVE_FIELDS = [
	'admitProjectPublication', 'protectedLinkedOriginalSourceReferences', 'protectedLinkedVideoSourceIds',
] as const;
const LABEL = 'Framescaper desktop';

export interface FramescaperDesktopProjectStoreLocal {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
	loadProject(projectId: string, options?: unknown): PromiseLike<unknown> | unknown;
	listProjects(): PromiseLike<readonly unknown[]> | readonly unknown[];
	readonly linkedOriginalStoreService?: Readonly<{
		deleteProject?<Value>(projectId: string, operation: () => PromiseLike<Value> | Value): Promise<Value>;
	}>;
}

export type FramescaperDesktopProjectStoreAdapter<Store> = Store & Readonly<{
	createProjectIfAbsent(project: unknown): Promise<FramescaperProject | null>;
}>;

export function createFramescaperDesktopProjectStoreAdapter<
	Store extends FramescaperDesktopProjectStoreLocal,
>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryRenderer | null;
	}>,
): Store | FramescaperDesktopProjectStoreAdapter<Store> {
	assertFramescaperProjectRuntimeProfile(profileValue);
	const composition = exactRecord(compositionValue, COMPOSITION_FIELDS, `${LABEL} store composition`);
	const localStore = composition.localStore as Store;
	assertLocalStore(localStore);
	framescaperProjectStoreAuthority(profileValue, localStore);
	const renderer = composition.desktopProjectLibrary as FramescaperDesktopProjectLibraryRenderer | null;
	if (renderer === null) return localStore;
	assertFramescaperDesktopProjectLibraryRendererComposition(profileValue, localStore, renderer);
	return new Proxy(localStore, proxyHandler(profileValue, localStore, renderer)) as
		FramescaperDesktopProjectStoreAdapter<Store>;
}

function proxyHandler<Store extends FramescaperDesktopProjectStoreLocal>(
	profile: EditorProjectRuntimeProfile,
	localStore: Store,
	renderer: FramescaperDesktopProjectLibraryRenderer,
): ProxyHandler<Store> {
	const overrides = Object.freeze({
		listProjects: () => renderer.listProjects(),
		loadProject: async (projectId: string, optionsValue: unknown = {}) => {
			const options = loadOptions(optionsValue);
			if (options.revision !== undefined) return localStore.loadProject(projectId, options);
			return renderer.readProject(projectId, options.signal ? { signal: options.signal } : {});
		},
		saveProject: async (projectValue: unknown, optionsValue: unknown = {}) => {
			const options = allowedRecord(optionsValue, SAVE_FIELDS, `${LABEL} save options`);
			const project = cloneFramescaperProject(profile, projectValue);
			await admitProjectPublication(localStore, project as unknown as ProjectDocument, options);
			return renderer.publishProject({ project });
		},
		createProjectIfAbsent: async (projectValue: unknown) => {
			const project = cloneFramescaperProject(profile, projectValue);
			if (project.revision !== 0) throw new Error(`${LABEL} create requires revision zero.`);
			if (await renderer.readProject(String(project.id)) !== null) return null;
			return renderer.publishProject({ project });
		},
		deleteProject: async (projectId: string) => {
			const lifecycle = localStore.linkedOriginalStoreService;
			if (typeof lifecycle?.deleteProject === 'function') {
				await lifecycle.deleteProject(projectId, () => renderer.deleteProject(projectId));
				return;
			}
			await renderer.deleteProject(projectId);
		},
		duplicateProject: async (sourceProjectId: string, optionsValue: unknown = {}) => {
			const options = allowedRecord(optionsValue, ['id', 'title'] as const, `${LABEL} duplicate options`);
			if (typeof options.id !== 'string' || !options.id
				|| typeof options.title !== 'string' || !options.title) {
				throw new TypeError(`${LABEL} duplication requires exact destination identity and title.`);
			}
			return renderer.duplicateProject(sourceProjectId, {
				id: options.id,
				title: options.title,
				timestamp: new Date().toISOString(),
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
	};
}

function assertLocalStore(value: unknown): asserts value is FramescaperDesktopProjectStoreLocal {
	if (!value || typeof value !== 'object') throw new TypeError('An exact Framescaper local store is required.');
	for (const method of ['ready', 'estimateStorage', 'loadProject', 'listProjects'] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Framescaper local store requires ${method}.`);
		}
	}
}

function loadOptions(value: unknown): Readonly<{ revision?: number; signal?: AbortSignal }> {
	const raw = allowedRecord(value, LOAD_FIELDS, `${LABEL} load options`);
	if (raw.revision !== undefined && (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0)) {
		throw new RangeError('The Framescaper desktop project revision is invalid.');
	}
	if (raw.signal !== undefined && !(raw.signal instanceof AbortSignal)) {
		throw new TypeError('A Framescaper desktop load AbortSignal is required.');
	}
	return Object.freeze({
		...(raw.revision === undefined ? {} : { revision: Number(raw.revision) }),
		...(raw.signal === undefined ? {} : { signal: raw.signal as AbortSignal }),
	});
}

function allowedRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Partial<Record<Field, unknown>>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${label} must be a record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} contains unsupported fields.`);
	}
	return value as Readonly<Partial<Record<Field, unknown>>>;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Readonly<Record<Field, unknown>> {
	const record = allowedRecord(value, fields, label);
	if (Reflect.ownKeys(record).length !== fields.length) {
		throw new TypeError(`${label} is incomplete.`);
	}
	return record as Readonly<Record<Field, unknown>>;
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
