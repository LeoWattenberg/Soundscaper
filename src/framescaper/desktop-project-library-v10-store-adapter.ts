/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitProjectPublication } from '../common/editor/storage/project-publication-options.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import { framescaperProjectStoreAuthorityV18 } from './editor-project-store-v18.ts';
import { cloneFramescaperProjectV18, type FramescaperProjectV18 } from './editor-project-v18.ts';
import type {
	FramescaperDesktopProjectLibraryV10Renderer,
} from './desktop-project-library-v10-renderer.ts';
import {
	assertFramescaperDesktopProjectLibraryV10RendererComposition,
} from './desktop-project-library-v10-renderer.ts';

export interface FramescaperDesktopProjectStoreV10Composition {
	readonly localStore: FramescaperDesktopProjectStoreV10Local;
	readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV10Renderer | null;
}

export interface FramescaperDesktopProjectStoreV10Local {
	readonly backend: unknown;
	readonly maximumProjectDocumentBytes?: number;
	ready(): PromiseLike<unknown>;
	estimateStorage(): PromiseLike<unknown>;
	loadProject(projectId: string, options?: Readonly<{ revision?: number; signal?: AbortSignal }> | unknown):
		PromiseLike<unknown> | unknown;
	listProjects(): PromiseLike<readonly unknown[]> | readonly unknown[];
}

export type FramescaperDesktopProjectStoreV10Adapter<Store> = Store & Readonly<{
	createProjectIfAbsent(project: unknown): Promise<FramescaperProjectV18 | null>;
}>;

const COMPOSITION_FIELDS = ['localStore', 'desktopProjectLibrary'] as const;
const LOAD_FIELDS = ['revision', 'signal'] as const;
const SAVE_FIELDS = [
	'admitProjectPublication', 'protectedLinkedOriginalSourceReferences', 'protectedLinkedVideoSourceIds',
] as const;

/** Keep web on the exact local identity; desktop receives a closed project-lifecycle overlay only. */
export function createFramescaperDesktopProjectStoreV10Adapter<Store extends FramescaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{ readonly localStore: Store; readonly desktopProjectLibrary: null }>,
): Store;
export function createFramescaperDesktopProjectStoreV10Adapter<Store extends FramescaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV10Renderer;
	}>,
): FramescaperDesktopProjectStoreV10Adapter<Store>;
export function createFramescaperDesktopProjectStoreV10Adapter<Store extends FramescaperDesktopProjectStoreV10Local>(
	profileValue: EditorProjectRuntimeProfile | unknown,
	compositionValue: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV10Renderer | null;
	}>,
): Store | FramescaperDesktopProjectStoreV10Adapter<Store> {
	assertFramescaperProjectV18Profile(profileValue);
	const composition = exactRecord(
		compositionValue, COMPOSITION_FIELDS, 'Framescaper desktop V10 store composition',
	);
	const localStore = composition.localStore as Store;
	assertLocalStore(localStore);
	framescaperProjectStoreAuthorityV18(profileValue, localStore);
	const renderer = composition.desktopProjectLibrary;
	if (renderer === null) return localStore;
	assertFramescaperDesktopProjectLibraryV10RendererComposition(profileValue, localStore, renderer);
	return new Proxy(localStore, proxyHandler(profileValue, localStore, renderer)) as
		FramescaperDesktopProjectStoreV10Adapter<Store>;
}

function proxyHandler<Store extends FramescaperDesktopProjectStoreV10Local>(
	profile: EditorProjectRuntimeProfile,
	localStore: Store,
	renderer: FramescaperDesktopProjectLibraryV10Renderer,
): ProxyHandler<Store> {
	const overrides = Object.freeze({
		loadProject: (projectId: string, optionsValue: unknown = {}) => {
			const options = loadOptions(optionsValue);
			if (options.revision !== undefined) return localStore.loadProject(projectId, options);
			return renderer.readProject(projectId, options.signal ? { signal: options.signal } : {});
		},
		saveProject: async (projectValue: unknown, optionsValue: unknown = {}) => {
			const options = saveOptions(optionsValue);
			const project = cloneFramescaperProjectV18(profile, projectValue);
			await admitProjectPublication(localStore, project, options);
			return renderer.publishProject({ project });
		},
		createProjectIfAbsent: async (projectValue: unknown) => {
			const project = cloneFramescaperProjectV18(profile, projectValue);
			if (Number(project.revision) !== 0) {
				throw new Error('Framescaper desktop V10 create requires fresh revision zero.');
			}
			const existing = await renderer.readProject(String(project.id));
			if (existing !== null) return null;
			return renderer.publishProject({ project });
		},
		deleteProject: async () => {
			throw new Error('Framescaper desktop V10 project delete is unavailable until main owns a CAS delete channel.');
		},
		duplicateProject: async () => {
			throw new Error('Framescaper desktop V10 project duplication is unavailable until main owns catalog discovery.');
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

function assertLocalStore(value: unknown): asserts value is FramescaperDesktopProjectStoreV10Local {
	if (!value || typeof value !== 'object') {
		throw new TypeError('An exact Framescaper V18 local store is required.');
	}
	for (const method of ['ready', 'estimateStorage', 'loadProject', 'listProjects'] as const) {
		if (typeof inheritedData(value, method) !== 'function') {
			throw new TypeError(`The Framescaper V18 local store requires ${method}.`);
		}
	}
}

function loadOptions(value: unknown): Readonly<{ revision?: number; signal?: AbortSignal }> {
	const raw = allowedRecord(value, LOAD_FIELDS, 'Framescaper desktop V10 load options');
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

function saveOptions(value: unknown): Record<string, unknown> {
	return allowedRecord(value, SAVE_FIELDS, 'Framescaper desktop V10 save options');
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
