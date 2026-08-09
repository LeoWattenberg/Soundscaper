/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	validateAudioEditorProjectV10,
	type AudioEditorProjectV10,
} from '../project-v10-validation.ts';
import { throwIfScapeAborted } from '../scape-abort.ts';
import {
	managedSourceBinding,
	reachableProjectSources,
	type ManagedVideoSource,
} from './desktop-shared-project-media-sources.ts';
import type {
	InspectedLinkedVideoOriginal,
	FoundationLinkedVideoOriginalSource,
	LinkedVideoOriginalResolver,
	ResolvedLinkedVideoOriginal,
} from './linked-video-original-resolver.ts';

interface LinkedVideoReadStore {
	getMediaAssetMetadata(sourceId: string): PromiseLike<unknown> | unknown;
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; backfillDigest?: boolean }>,
	): PromiseLike<unknown> | unknown;
}

type LinkedVideoOverlayStore<Store extends LinkedVideoReadStore> = Omit<
	Store,
	'getMediaAssetMetadata' | 'loadMediaAsset'
> & Readonly<{
	getMediaAssetMetadata(
		sourceId: string,
	): Promise<Awaited<ReturnType<Store['getMediaAssetMetadata']>> | ResolvedLinkedVideoOriginal['metadata']>;
	loadMediaAsset(
		sourceId: string,
		options?: Readonly<{ signal?: AbortSignal; backfillDigest?: boolean }>,
	): Promise<Awaited<ReturnType<Store['loadMediaAsset']>> | Blob>;
}>;

interface LinkedVideoEntry {
	blob: Blob | null;
	readonly inspected: readonly InspectedLinkedVideoOriginal[];
	readonly metadata: ResolvedLinkedVideoOriginal['metadata'];
	readonly projectId: string;
	readonly resolver: LinkedVideoResolver;
	readonly sources: readonly ManagedVideoSource[];
}

interface LinkedVideoSessionState {
	readonly byStorageKey: ReadonlyMap<string, LinkedVideoEntry>;
	readonly sourceBindings: ReadonlyMap<string, string>;
}

type LinkedVideoResolver = Pick<
	LinkedVideoOriginalResolver,
	'inspect' | 'resolve' | 'assertBindingCurrent'
>;

declare const LINKED_VIDEO_SESSION_BRAND: unique symbol;

/** Opaque proof that exact project-scoped bindings and bodies were verified together. */
export interface DesktopSharedLinkedVideoOriginalSession {
	readonly [LINKED_VIDEO_SESSION_BRAND]: true;
}

const SESSION_STATES = new WeakMap<object, LinkedVideoSessionState>();

/**
 * Inspect each complete compatible linked-video group before shared-project
 * publication. Bodies remain lazy so the caller can finish its complete
 * aggregate preflight before the first platform read.
 */
export async function resolveDesktopSharedProjectLinkedVideoOriginals(
	projectValue: unknown,
	resolver: LinkedVideoResolver,
	options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<DesktopSharedLinkedVideoOriginalSession> {
	validateAudioEditorProjectV10(projectValue);
	assertResolver(resolver);
	const project = projectValue as AudioEditorProjectV10;
	const groups = linkedVideoGroups(project);
	const byStorageKey = new Map<string, LinkedVideoEntry>();
	const sourceBindings = new Map<string, string>();

	for (const sources of groups.values()) {
		throwIfScapeAborted(options.signal);
		const inspected: InspectedLinkedVideoOriginal[] = [];
		let complete = true;
		for (const source of sources) {
			const value = await resolver.inspect(
				project.id,
				source as FoundationLinkedVideoOriginalSource,
				{ signal: options.signal },
			);
			throwIfScapeAborted(options.signal);
			if (!value) {
				complete = false;
				continue;
			}
			inspected.push(value);
		}
		if (!complete) continue;
		const firstInspection = inspected[0];
		const firstSource = sources[0];
		if (!firstInspection || !firstSource) continue;
		for (const candidate of inspected.slice(1)) {
			if (!sameLinkedBody(firstInspection, candidate)) {
				throw new Error(`Linked video aliases for ${firstSource.storageKey} identify different originals.`);
			}
		}
		for (let index = 0; index < sources.length; index += 1) {
			const source = sources[index];
			if (!source || !inspected[index]) {
				throw new Error('The linked video original alias set changed during resolution.');
			}
			sourceBindings.set(source.id, managedSourceBinding(source));
		}
		byStorageKey.set(firstSource.storageKey, {
			blob: null,
			inspected: Object.freeze(inspected),
			metadata: firstInspection.metadata,
			projectId: project.id,
			resolver,
			sources: Object.freeze([...sources]),
		});
	}

	const session = Object.freeze(Object.create(null)) as DesktopSharedLinkedVideoOriginalSession;
	SESSION_STATES.set(session, Object.freeze({ byStorageKey, sourceBindings }));
	return session;
}

/** Overlay only the two retained-video reads; all other operations stay on the owner store. */
export function overlayDesktopSharedLinkedVideoOriginals<Store extends LinkedVideoReadStore>(
	session: DesktopSharedLinkedVideoOriginalSession,
	fallback: Store,
): LinkedVideoOverlayStore<Store> {
	const state = sessionState(session);
	if (!fallback || typeof fallback !== 'object'
		|| typeof fallback.getMediaAssetMetadata !== 'function'
		|| typeof fallback.loadMediaAsset !== 'function') {
		throw new TypeError('A desktop shared linked-video fallback store is required.');
	}
	const getMediaAssetMetadata = async (storageKey: string) => {
		const entry = state.byStorageKey.get(storageKey);
		if (!entry) return await fallback.getMediaAssetMetadata.call(fallback, storageKey);
		await assertEntryCurrent(entry);
		return entry.metadata;
	};
	const loadMediaAsset = async (
		storageKey: string,
		options?: Readonly<{ signal?: AbortSignal; backfillDigest?: boolean }>,
	) => {
		const entry = state.byStorageKey.get(storageKey);
		if (!entry) return await fallback.loadMediaAsset.call(fallback, storageKey, options);
		throwIfScapeAborted(options?.signal);
		return loadEntry(entry, options?.signal);
	};
	return new Proxy(fallback, {
		get(target, property) {
			if (property === 'getMediaAssetMetadata') return getMediaAssetMetadata;
			if (property === 'loadMediaAsset') return loadMediaAsset;
			const value = Reflect.get(target, property, target) as unknown;
			return typeof value === 'function' ? value.bind(target) : value;
		},
	}) as LinkedVideoOverlayStore<Store>;
}

export function desktopSharedLinkedVideoTrustedSourceIds(
	session: DesktopSharedLinkedVideoOriginalSession,
): ReadonlySet<string> {
	return new Set(sessionState(session).sourceBindings.keys());
}

/** Exact group authorization consumed by managed acquisition; storageKey alone is insufficient. */
export function desktopSharedLinkedVideoGroupMatches(
	session: DesktopSharedLinkedVideoOriginalSession,
	sources: readonly ManagedVideoSource[],
	metadata: unknown,
): boolean {
	const state = sessionState(session);
	if (!Array.isArray(sources) || sources.length < 1) return false;
	const first = sources[0];
	if (!first || sources.some((source) => (
		source.kind !== 'video'
		|| source.storageKey !== first.storageKey
		|| state.sourceBindings.get(source.id) !== managedSourceBinding(source)
	))) return false;
	const entry = state.byStorageKey.get(first.storageKey);
	if (!entry || !metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
	const candidate = metadata as Record<PropertyKey, unknown>;
	return ownDataValue(candidate, 'sourceId') === entry.metadata.sourceId
		&& ownDataValue(candidate, 'mimeType') === entry.metadata.mimeType
		&& ownDataValue(candidate, 'size') === entry.metadata.size
		&& ownDataValue(candidate, 'sha256') === entry.metadata.sha256;
}

function linkedVideoGroups(project: AudioEditorProjectV10): ReadonlyMap<string, readonly ManagedVideoSource[]> {
	const groups = new Map<string, ManagedVideoSource[]>();
	const bindings = new Map<string, string>();
	for (const source of reachableProjectSources(project)) {
		if (source.kind !== 'video') continue;
		const binding = managedSourceBinding(source);
		const prior = bindings.get(source.storageKey);
		if (prior && prior !== binding) {
			throw new Error(`Linked video aliases for ${source.storageKey} have conflicting project geometry.`);
		}
		bindings.set(source.storageKey, binding);
		const group = groups.get(source.storageKey) ?? [];
		group.push(source);
		groups.set(source.storageKey, group);
	}
	return groups;
}

function sameLinkedBody(
	left: InspectedLinkedVideoOriginal,
	right: InspectedLinkedVideoOriginal,
): boolean {
	const leftBinding = left.binding;
	const rightBinding = right.binding;
	return leftBinding.storageKey === rightBinding.storageKey
		&& leftBinding.locatorId === rightBinding.locatorId
		&& leftBinding.locatorRevision === rightBinding.locatorRevision
		&& leftBinding.mimeType === rightBinding.mimeType
		&& leftBinding.byteLength === rightBinding.byteLength
		&& leftBinding.sha256 === rightBinding.sha256
		&& JSON.stringify(leftBinding.sourceShape) === JSON.stringify(rightBinding.sourceShape);
}

function sameInspectedBinding(
	resolved: ResolvedLinkedVideoOriginal,
	inspected: InspectedLinkedVideoOriginal,
): boolean {
	return resolved.binding.bindingToken === inspected.binding.bindingToken
		&& JSON.stringify(resolved.binding) === JSON.stringify(inspected.binding);
}

async function loadEntry(entry: LinkedVideoEntry, signal?: AbortSignal): Promise<Blob> {
	await assertEntryCurrent(entry, signal);
	if (entry.blob) return entry.blob;
	const source = entry.sources[0];
	const inspected = entry.inspected[0];
	if (!source || !inspected) throw new Error('The linked video original group is empty.');
	const resolved = await entry.resolver.resolve(
		entry.projectId,
		source as FoundationLinkedVideoOriginalSource,
		{ signal },
	);
	throwIfScapeAborted(signal);
	if (!resolved || !sameInspectedBinding(resolved, inspected)) {
		throw new Error('The linked video original binding changed during grouped resolution.');
	}
	await assertEntryCurrent(entry, signal);
	entry.blob = resolved.blob;
	return entry.blob;
}

async function assertEntryCurrent(entry: LinkedVideoEntry, signal?: AbortSignal): Promise<void> {
	for (let index = 0; index < entry.sources.length; index += 1) {
		const source = entry.sources[index];
		const inspected = entry.inspected[index];
		if (!source || !inspected) throw new Error('The linked video original alias set is incomplete.');
		await entry.resolver.assertBindingCurrent(
			entry.projectId,
			source as FoundationLinkedVideoOriginalSource,
			inspected.binding,
			{ signal },
		);
	}
}

function ownDataValue(record: Record<PropertyKey, unknown>, key: PropertyKey): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
}

function sessionState(session: DesktopSharedLinkedVideoOriginalSession): LinkedVideoSessionState {
	if (!session || typeof session !== 'object') {
		throw new TypeError('A verified desktop shared linked-video session is required.');
	}
	const state = SESSION_STATES.get(session);
	if (!state) throw new TypeError('The desktop shared linked-video session is not authentic.');
	return state;
}

function assertResolver(value: LinkedVideoResolver): void {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A linked video original resolver is required.');
	}
	for (const method of ['inspect', 'resolve', 'assertBindingCurrent'] as const) {
		if (typeof value[method] !== 'function') {
			throw new TypeError(`Linked video original resolver.${method} is required.`);
		}
	}
}
