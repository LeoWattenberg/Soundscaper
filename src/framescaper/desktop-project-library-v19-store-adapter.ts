/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitProjectPublication } from '../common/editor/storage/project-publication-options.ts';
import type { ProjectDocument } from '../common/editor/storage/project-repository.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	assertFramescaperDesktopProjectLibraryV19RendererComposition,
	type FramescaperDesktopProjectLibraryV19Renderer,
} from './desktop-project-library-v19-renderer.ts';
import { assertFramescaperProjectV28Profile } from './editor-project-runtime-profile-v28.ts';
import { framescaperProjectStoreAuthorityV28 } from './editor-project-store-v28.ts';
import { cloneFramescaperProjectV28, type FramescaperProjectV28 } from './editor-project-v28.ts';

const COMPOSITION_FIELDS = ['localStore', 'desktopProjectLibrary'] as const;
const LOAD_FIELDS = ['revision', 'signal'] as const;
const SAVE_FIELDS = [
	'admitProjectPublication', 'protectedLinkedOriginalSourceReferences', 'protectedLinkedVideoSourceIds',
] as const;
const LABEL = 'Framescaper desktop V19';

export interface FramescaperDesktopProjectStoreV19Local {
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

export type FramescaperDesktopProjectStoreV19Adapter<Store> = Store & Readonly<{
	createProjectIfAbsent(project: unknown): Promise<FramescaperProjectV28 | null>;
}>;

/** Overlay selected V19 main authority without exposing its generation through the public API. */
export function createFramescaperDesktopProjectStoreV19Adapter<
	Store extends FramescaperDesktopProjectStoreV19Local,
>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV19Renderer | null;
	}>,
): Store | FramescaperDesktopProjectStoreV19Adapter<Store> {
	assertFramescaperProjectV28Profile(profileValue);
	const composition = exactRecord(compositionValue, COMPOSITION_FIELDS, `${LABEL} store composition`);
	const localStore = composition.localStore as Store;
	assertLocalStore(localStore);
	framescaperProjectStoreAuthorityV28(profileValue, localStore);
	const renderer = composition.desktopProjectLibrary as FramescaperDesktopProjectLibraryV19Renderer | null;
	if (renderer === null) return localStore;
	assertFramescaperDesktopProjectLibraryV19RendererComposition(profileValue, localStore, renderer);
	return new Proxy(localStore, proxyHandler(profileValue, localStore, renderer)) as
		FramescaperDesktopProjectStoreV19Adapter<Store>;
}

function proxyHandler<Store extends FramescaperDesktopProjectStoreV19Local>(
	profile: EditorProjectRuntimeProfile,
	localStore: Store,
	renderer: FramescaperDesktopProjectLibraryV19Renderer,
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
			const project = cloneFramescaperProjectV28(profile, projectValue);
			await admitProjectPublication(localStore, project as unknown as ProjectDocument, options);
			return renderer.publishProject({ project });
		},
		createProjectIfAbsent: async (projectValue: unknown) => {
			const project = cloneFramescaperProjectV28(profile, projectValue);
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
			if (typeof options.id !== 'string' || !options.id || typeof options.title !== 'string' || !options.title) {
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

function assertLocalStore(value: unknown): asserts value is FramescaperDesktopProjectStoreV19Local {
	if (!value || typeof value !== 'object') throw new TypeError('An exact Framescaper V28 local store is required.');
	for (const method of ['ready', 'estimateStorage', 'loadProject', 'listProjects'] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Framescaper V28 local store requires ${method}.`);
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
): Record<Field, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| Object.getPrototypeOf(value) !== Object.prototype) {
		throw new TypeError(`${label} must be a plain object.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key as Field))) {
		throw new TypeError(`${label} has unsupported fields.`);
	}
	return value as Record<Field, unknown>;
}

function exactRecord<const Field extends string>(
	value: unknown,
	fields: readonly Field[],
	label: string,
): Record<Field, unknown> {
	const result = allowedRecord(value, fields, label);
	if (Reflect.ownKeys(value as object).length !== fields.length
		|| fields.some((field) => !Object.hasOwn(value as object, field))) {
		throw new TypeError(`${label} has missing fields.`);
	}
	return result;
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
