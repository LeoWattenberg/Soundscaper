/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LinkedOriginalBinding } from './linked-original-binding.ts';
import {
	LinkedOriginalLifecycleCoordinator,
	type LocalStoreClearAdmission,
} from './linked-original-lifecycle-coordinator.ts';
import type { LinkedOriginalProjectAliasRepository } from './linked-original-project-alias-repository.ts';
import type { LinkedOriginalProjectReachabilityRepository } from './linked-original-project-reachability-repository.ts';
import type {
	LinkedOriginalCatalogProjectRevision,
	LinkedOriginalStartupReconciliationRepository,
} from './linked-original-startup-reconciliation-repository.ts';
import {
	maintainOpenedProjectWithLinkedOriginalReachability,
	maintainOpenedProjectWithLinkedVideoOriginalReachability,
} from './linked-original-project-open-maintenance.ts';
import { saveProjectWithLinkedOriginalReachability } from './linked-original-project-save.ts';
import type {
	LinkedOriginalLocatorReference,
	LinkedOriginalRepository,
} from './linked-original-repository.ts';
import type {
	BindLinkedOriginalOptions,
	LinkedAudioOriginalSource,
	LinkedOriginalResolver,
} from './linked-original-resolver.ts';
import type { MediaRepository } from './media-repository.ts';
import {
	canonicalMediaContentBlob,
	digestMediaContent,
} from './media-content-digest.ts';
import {
	duplicateProjectWithLinkedOriginals,
	duplicateProjectWithLinkedVideoOriginals,
	type ProjectDuplicationRequest,
} from './project-duplication.ts';
import type { ProjectPublicationStore } from './project-publication-options.ts';
import type { ProjectDocument, ProjectRepositoryPort } from './project-repository.ts';
import {
	LinkedVideoOriginalLifecycleCoordinator,
} from './linked-video-original-lifecycle-coordinator.ts';
import type { LinkedVideoOriginalProjectAliasRepository } from './linked-video-original-project-alias-repository.ts';
import type { LinkedVideoOriginalProjectReachabilityRepository } from './linked-video-original-project-reachability-repository.ts';
import { saveProjectWithLinkedVideoOriginalReachability } from './linked-video-original-project-save.ts';
import type {
	LinkedVideoOriginalBinding,
} from './linked-video-original-binding.ts';
import type {
	LinkedVideoOriginalLocatorReference,
	LinkedVideoOriginalRepository,
} from './linked-video-original-repository.ts';
import type {
	BindLinkedVideoOriginalOptions,
	LinkedVideoOriginalResolver,
	LinkedVideoOriginalSource,
} from './linked-video-original-resolver.ts';
import { linkedVideoDerivativeOriginal } from './video-derivative-relationship.ts';
import type {
	VideoDerivativeInput,
	VideoDerivativeSelector,
} from './video-derivative-repository.ts';

export interface LinkedOriginalStoreRepositories {
	readonly linkedOriginalBindings: LinkedOriginalRepository;
	readonly linkedOriginalProjectAliases: LinkedOriginalProjectAliasRepository;
	readonly linkedOriginalProjectReachability: LinkedOriginalProjectReachabilityRepository;
	readonly linkedOriginalStartupReconciliation?: LinkedOriginalStartupReconciliationRepository;
	readonly linkedOriginals: LinkedOriginalResolver | null;
	readonly linkedVideoOriginalBindings: LinkedVideoOriginalRepository;
	readonly linkedVideoOriginalProjectAliases: LinkedVideoOriginalProjectAliasRepository;
	readonly linkedVideoOriginalProjectReachability: LinkedVideoOriginalProjectReachabilityRepository;
	readonly linkedVideoOriginals: LinkedVideoOriginalResolver | null;
	readonly media: MediaRepository;
}

export interface LinkedOriginalStoreServiceOptions {
	readonly onCleanupError?: (error: unknown) => void;
}

export interface ProjectDuplicationDependencies {
	loadProject(projectId: string): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
	listProjects(): PromiseLike<readonly ProjectDocument[]> | readonly ProjectDocument[];
	createProjectIfAbsent(project: ProjectDocument): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
}

export interface LinkedOriginalReconciliationInventory {
	isDurable(): PromiseLike<boolean> | boolean;
	projectRevisions(): PromiseLike<readonly LinkedOriginalCatalogProjectRevision[]>
		| readonly LinkedOriginalCatalogProjectRevision[];
}

export interface RelinkLinkedOriginalOptions {
	readonly expectedBindingToken: string;
	readonly expectedLocatorRevision: string;
	readonly expectedSnapshot: unknown;
	readonly assertCanPublish?: () => void;
	readonly signal?: AbortSignal;
}

export interface RelinkLinkedAudioOriginalOptions extends RelinkLinkedOriginalOptions {
	/** Exact-content relink is the default; changed content requires explicit admission. */
	readonly admission?: 'exact-content' | 'changed-content';
}

export interface RelinkLinkedVideoOriginalOptions extends RelinkLinkedOriginalOptions {
	/** Exact-content relink is the default; changed content requires explicit admission. */
	readonly admission?: 'exact-content' | 'changed-content';
}

type ActiveLifecycle = LinkedOriginalLifecycleCoordinator | LinkedVideoOriginalLifecycleCoordinator;

/** Chooses one mixed-media lifecycle while retaining the schema-v1 video facade. */
export class LinkedOriginalStoreService {
	readonly #repositories: LinkedOriginalStoreRepositories;
	readonly #lifecycle: ActiveLifecycle;
	readonly linkedOriginalLifecycle: LinkedOriginalLifecycleCoordinator | null;
	readonly linkedVideoOriginalLifecycle: ActiveLifecycle;

	constructor(
		repositories: LinkedOriginalStoreRepositories,
		options: LinkedOriginalStoreServiceOptions = {},
	) {
		this.#repositories = repositories;
		this.linkedOriginalLifecycle = repositories.linkedOriginals
			? new LinkedOriginalLifecycleCoordinator(
				repositories.linkedOriginalBindings,
				repositories.linkedOriginals,
				options.onCleanupError ? { onCleanupError: options.onCleanupError } : {},
			)
			: null;
		this.#lifecycle = this.linkedOriginalLifecycle
			?? new LinkedVideoOriginalLifecycleCoordinator(
				repositories.linkedVideoOriginalBindings,
				repositories.linkedVideoOriginals,
				options.onCleanupError ? { onCleanupError: options.onCleanupError } : {},
			);
		this.linkedVideoOriginalLifecycle = this.#lifecycle;
	}

	saveProject(
		store: ProjectPublicationStore,
		projects: ProjectRepositoryPort,
		project: ProjectDocument,
		options: unknown = {},
	): Promise<ProjectDocument> {
		if (this.linkedOriginalLifecycle) {
			return saveProjectWithLinkedOriginalReachability({
				store,
				projects,
				lifecycle: this.linkedOriginalLifecycle,
				reachability: this.#repositories.linkedOriginalProjectReachability,
			}, project, options);
		}
		return saveProjectWithLinkedVideoOriginalReachability({
			store,
			projects,
			lifecycle: this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator,
			reachability: this.#repositories.linkedVideoOriginalProjectReachability,
		}, project, options);
	}

	maintainOpenedProject(
		projects: ProjectRepositoryPort,
		projectId: string,
		collectProtectedSourceReferences: () => unknown,
		isDurable: () => PromiseLike<boolean> | boolean,
	): Promise<boolean> {
		return this.linkedOriginalLifecycle
			? maintainOpenedProjectWithLinkedOriginalReachability({
				projects,
				lifecycle: this.linkedOriginalLifecycle,
				reachability: this.#repositories.linkedOriginalProjectReachability,
				isDurable,
			}, projectId, collectProtectedSourceReferences)
			: maintainOpenedProjectWithLinkedVideoOriginalReachability({
				projects,
				lifecycle: this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator,
				reachability: this.#repositories.linkedVideoOriginalProjectReachability,
				isDurable,
			}, projectId, collectProtectedSourceReferences);
	}

	deleteProject<Value>(
		projectId: string,
		operation: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		return this.#lifecycle.deleteProject(projectId, operation);
	}

	duplicateProject(
		dependencies: ProjectDuplicationDependencies,
		request: ProjectDuplicationRequest,
	): Promise<ProjectDocument> {
		return this.#lifecycle.run(() => this.linkedOriginalLifecycle
			? duplicateProjectWithLinkedOriginals({
				...dependencies,
				aliases: this.#repositories.linkedOriginalProjectAliases,
			}, request)
			: duplicateProjectWithLinkedVideoOriginals({
				...dependencies,
				aliases: this.#repositories.linkedVideoOriginalProjectAliases,
			}, request));
	}

	clear(admission: LocalStoreClearAdmission): Promise<void> {
		return this.#lifecycle.clear(admission);
	}

	run<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		return this.#lifecycle.run(operation);
	}

	reconcileOriginalLocators(inventory: LinkedOriginalReconciliationInventory): Promise<boolean> {
		return this.#lifecycle.run(async () => {
			const generic = this.#repositories.linkedOriginals;
			const legacyVideo = this.#repositories.linkedVideoOriginals;
			const startup = this.#repositories.linkedOriginalStartupReconciliation;
			if ((!generic && !legacyVideo) || !startup || !await inventory.isDurable()) return false;
			const catalog = await inventory.projectRevisions();
			if (generic?.canReconcileLocators()) {
				const references = await startup.reconcileDurableLocatorReferences(catalog);
				return references !== null && await generic.reconcileLocatorReferences(references) !== null;
			}
			if (!legacyVideo?.canReconcileLocators()) return false;
			const references = await startup.reconcileDurableVideoLocatorReferences(catalog);
			return references !== null && await legacyVideo.reconcileLocatorReferences(references) !== null;
		});
	}

	reconcileVideoLocators(inventory: LinkedOriginalReconciliationInventory): Promise<boolean> {
		return this.#lifecycle.run(async () => {
			const resolver = this.#repositories.linkedVideoOriginals;
			const startup = this.#repositories.linkedOriginalStartupReconciliation;
			if (!startup || !resolver?.canReconcileLocators() || !await inventory.isDurable()) return false;
			const references = await startup.reconcileDurableVideoLocatorReferences(
				await inventory.projectRevisions(),
			);
			return references !== null && await resolver.reconcileLocatorReferences(references) !== null;
		});
	}

	bindAudio(
		projectId: string,
		source: LinkedAudioOriginalSource,
		locatorId: string,
		options: BindLinkedOriginalOptions = {},
	): Promise<LinkedOriginalBinding> {
		this.#assertAudioSource(source);
		const { resolver, lifecycle } = this.#audioOwnership();
		return lifecycle.bind(
			projectId,
			{ kind: 'audio', sourceId: source.id },
			() => resolver.bind(projectId, source, locatorId, options),
		);
	}

	relinkAudio(
		projectId: string,
		source: LinkedAudioOriginalSource,
		locatorId: string,
		options: RelinkLinkedAudioOriginalOptions,
	): Promise<LinkedOriginalBinding> {
		this.#assertAudioSource(source);
		const { resolver, lifecycle } = this.#audioOwnership();
		return lifecycle.bind(
			projectId,
			{ kind: 'audio', sourceId: source.id },
			async () => {
				throwIfRelinkAborted(options?.signal, 'audio');
				const current = await this.#repositories.linkedOriginalBindings.get(projectId, source.id);
				throwIfRelinkAborted(options?.signal, 'audio');
				if (current?.kind !== 'audio'
					|| current.bindingToken !== options?.expectedBindingToken) {
					throw new Error('The linked audio original binding changed before relink.');
				}
				await resolver.assertBindingCurrent(projectId, source, current, { signal: options.signal });
				const selected = options.admission === 'changed-content'
					? changedContentAudioRelinkSnapshot(current, options)
					: await exactRelinkSnapshot(current, options, 'audio');
				return resolver.bind(projectId, source, locatorId, {
					expectedBindingToken: current.bindingToken,
					expectedLocatorRevision: options.expectedLocatorRevision,
					expectedSnapshot: selected,
					...(options.assertCanPublish ? { assertCanPublish: options.assertCanPublish } : {}),
					...(options.signal ? { signal: options.signal } : {}),
				});
			},
		);
	}

	resolveAudio(
		projectId: string,
		source: LinkedAudioOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	) {
		this.#assertAudioSource(source);
		return this.#requiredOriginalResolver().resolve(projectId, source, options);
	}

	metadataAudio(projectId: string, source: LinkedAudioOriginalSource) {
		this.#assertAudioSource(source);
		return this.#requiredOriginalResolver().metadata(projectId, source);
	}

	getBinding(projectId: string, sourceId: string): Promise<LinkedOriginalBinding | null> {
		return this.#repositories.linkedOriginalBindings.get(projectId, sourceId);
	}

	unlinkAudio(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		const { resolver, lifecycle } = this.#audioOwnership();
		return lifecycle.unlink(
			projectId,
			{ kind: 'audio', sourceId, bindingToken: expectedBindingToken },
			async () => {
				const binding = await this.#repositories.linkedOriginalBindings.get(projectId, sourceId);
				if (binding?.kind === 'video') {
					throw new TypeError('A linked audio original binding is required.');
				}
				return resolver.unlink(projectId, sourceId, expectedBindingToken);
			},
		);
	}

	releaseOriginal(reference: LinkedOriginalLocatorReference): Promise<boolean> {
		if (this.linkedOriginalLifecycle) {
			return this.linkedOriginalLifecycle.releaseUnused(reference);
		}
		if (reference?.kind !== 'video') {
			throw new Error('Linked original resolution is unavailable.');
		}
		this.#requiredVideoResolver();
		return (this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator).releaseUnused({
			locatorId: reference.locatorId,
			locatorRevision: reference.locatorRevision,
		});
	}

	bindVideo(
		projectId: string,
		source: LinkedVideoOriginalSource,
		locatorId: string,
		options: BindLinkedVideoOriginalOptions = {},
	) {
		const resolver = this.#requiredVideoResolver();
		if (this.linkedOriginalLifecycle) {
			return this.linkedOriginalLifecycle.bind(
				projectId,
				{ kind: 'video', sourceId: source.id },
				() => resolver.bind(projectId, source, locatorId, options),
			);
		}
		return (this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator).bind(
			projectId,
			source.id,
			() => resolver.bind(projectId, source, locatorId, options),
		);
	}

	relinkVideo(
		projectId: string,
		source: LinkedVideoOriginalSource,
		locatorId: string,
		options: RelinkLinkedVideoOriginalOptions,
	): Promise<LinkedVideoOriginalBinding> {
		const resolver = this.#requiredVideoResolver();
		const operation = async (): Promise<LinkedVideoOriginalBinding> => {
			throwIfRelinkAborted(options?.signal);
			const current = await this.#repositories.linkedVideoOriginalBindings.get(projectId, source.id);
			throwIfRelinkAborted(options?.signal);
			if (!current || current.bindingToken !== options?.expectedBindingToken) {
				throw new Error('The linked video original binding changed before relink.');
			}
			await resolver.assertBindingCurrent(projectId, source, current, { signal: options.signal });
			const selected = options.admission === 'changed-content'
				? await changedContentRelinkSnapshot(current, options)
				: await exactRelinkSnapshot(current, options, 'video');
			return resolver.bind(projectId, source, locatorId, {
				expectedBindingToken: current.bindingToken,
				expectedLocatorRevision: options.expectedLocatorRevision,
				expectedSnapshot: selected,
				...(options.assertCanPublish ? { assertCanPublish: options.assertCanPublish } : {}),
				...(options.signal ? { signal: options.signal } : {}),
			});
		};
		return this.linkedOriginalLifecycle
			? this.linkedOriginalLifecycle.bind(
				projectId,
				{ kind: 'video', sourceId: source.id },
				operation,
			)
			: (this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator).bind(
				projectId,
				source.id,
				operation,
			);
	}

	resolveVideo(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	) {
		return this.#requiredVideoResolver().resolve(projectId, source, options);
	}

	leaseVideoPlayback(
		projectId: string,
		source: LinkedVideoOriginalSource,
		options: Readonly<{ signal?: AbortSignal }> = {},
	) {
		return this.#repositories.linkedVideoOriginals?.leasePlayback(projectId, source, options) ?? null;
	}

	metadataVideo(projectId: string, source: LinkedVideoOriginalSource) {
		return this.#requiredVideoResolver().metadata(projectId, source);
	}

	getVideoBinding(projectId: string, sourceId: string) {
		return this.#repositories.linkedVideoOriginalBindings.get(projectId, sourceId);
	}

	unlinkVideo(
		projectId: string,
		sourceId: string,
		expectedBindingToken: string,
	): Promise<boolean> {
		const remove = async () => {
			const binding = await this.#repositories.linkedOriginalBindings.get(projectId, sourceId);
			if (binding?.kind === 'audio') {
				throw new TypeError('A linked video original binding is required.');
			}
			return this.#repositories.linkedVideoOriginalBindings.deleteIfCurrent(
				projectId,
				sourceId,
				expectedBindingToken,
			);
		};
		return this.linkedOriginalLifecycle
			? this.linkedOriginalLifecycle.unlink(
				projectId,
				{ kind: 'video', sourceId, bindingToken: expectedBindingToken },
				remove,
			)
			: (this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator).unlink(
				projectId, sourceId, expectedBindingToken, remove,
			);
	}

	releaseVideo(reference: LinkedVideoOriginalLocatorReference): Promise<boolean> {
		this.#requiredVideoResolver();
		return this.linkedOriginalLifecycle
			? this.linkedOriginalLifecycle.releaseUnused({ kind: 'video', ...reference })
			: (this.#lifecycle as LinkedVideoOriginalLifecycleCoordinator).releaseUnused(reference);
	}

	async saveLinkedVideoDerivative(
		projectId: string,
		source: LinkedVideoOriginalSource,
		binding: LinkedVideoOriginalBinding,
		input: VideoDerivativeInput = {},
	) {
		const resolver = this.#requiredVideoResolver();
		await resolver.assertBindingCurrent(projectId, source, binding);
		const result = await this.#repositories.media.saveDerivative(source.storageKey || source.id, {
			...input,
			original: linkedVideoDerivativeOriginal(binding),
		});
		await resolver.assertBindingCurrent(projectId, source, binding);
		return result;
	}

	async loadLinkedVideoDerivative(
		projectId: string,
		source: LinkedVideoOriginalSource,
		binding: LinkedVideoOriginalBinding,
		selector: VideoDerivativeSelector = {},
	) {
		const resolver = this.#requiredVideoResolver();
		await resolver.assertBindingCurrent(projectId, source, binding);
		const result = await this.#repositories.media.loadDerivative(source.storageKey || source.id, {
			...selector,
			original: linkedVideoDerivativeOriginal(binding),
		});
		await resolver.assertBindingCurrent(projectId, source, binding);
		return result;
	}

	async listLinkedVideoDerivatives(
		projectId: string,
		source: LinkedVideoOriginalSource,
		binding: LinkedVideoOriginalBinding,
		selector: Pick<VideoDerivativeSelector, 'type' | 'recipe'> = {},
	) {
		const resolver = this.#requiredVideoResolver();
		await resolver.assertBindingCurrent(projectId, source, binding);
		const result = await this.#repositories.media.listDerivatives(source.storageKey || source.id, {
			...selector,
			original: linkedVideoDerivativeOriginal(binding),
		});
		await resolver.assertBindingCurrent(projectId, source, binding);
		return result;
	}

	#requiredOriginalResolver(): LinkedOriginalResolver {
		if (!this.#repositories.linkedOriginals) {
			throw new Error('Linked audio original resolution is unavailable.');
		}
		return this.#repositories.linkedOriginals;
	}

	#assertAudioSource(source: LinkedAudioOriginalSource): void {
		if (!source || typeof source !== 'object' || source.kind !== 'audio') {
			throw new TypeError('A linked audio original source is required.');
		}
	}

	#audioOwnership(): Readonly<{
		resolver: LinkedOriginalResolver;
		lifecycle: LinkedOriginalLifecycleCoordinator;
	}> {
		const resolver = this.#requiredOriginalResolver();
		if (!this.linkedOriginalLifecycle) {
			throw new Error('Linked audio original lifecycle is unavailable.');
		}
		return { resolver, lifecycle: this.linkedOriginalLifecycle };
	}

	#requiredVideoResolver(): LinkedVideoOriginalResolver {
		if (!this.#repositories.linkedVideoOriginals) {
			throw new Error('Linked video original resolution is unavailable.');
		}
		return this.#repositories.linkedVideoOriginals;
	}
}

function throwIfRelinkAborted(
	signal?: AbortSignal,
	kind: 'audio' | 'video' = 'video',
): void {
	if (!signal?.aborted) return;
	if (signal.reason !== undefined) throw signal.reason;
	if (typeof DOMException === 'function') {
		throw new DOMException(`Linked ${kind} original relink was cancelled.`, 'AbortError');
	}
	const error = new Error(`Linked ${kind} original relink was cancelled.`);
	error.name = 'AbortError';
	throw error;
}

async function changedContentRelinkSnapshot(
	current: Readonly<{ mimeType: string; sourceShape: Readonly<{ hasAudio: boolean }> }>,
	options: RelinkLinkedOriginalOptions,
): Promise<Blob> {
	const selected = canonicalMediaContentBlob(options.expectedSnapshot);
	if (current.sourceShape.hasAudio !== false) {
		throw new Error(
			'The linked video original retains canonical extracted audio; '
			+ 'changed-content relink requires a silent video source.',
		);
	}
	if ((selected.type || current.mimeType) !== current.mimeType) {
		throw new Error('The selected linked video original does not match the current MIME type.');
	}
	throwIfRelinkAborted(options.signal, 'video');
	return selected;
}

function changedContentAudioRelinkSnapshot(
	current: Readonly<{ mimeType: string }>,
	options: RelinkLinkedOriginalOptions,
): Blob {
	const selected = canonicalMediaContentBlob(options.expectedSnapshot);
	if ((selected.type || current.mimeType) !== current.mimeType) {
		throw new Error('The selected linked audio original does not match the current MIME type.');
	}
	throwIfRelinkAborted(options.signal, 'audio');
	return selected;
}

async function exactRelinkSnapshot(
	current: Readonly<{ byteLength: number; sha256: string }>,
	options: RelinkLinkedOriginalOptions,
	kind: 'audio' | 'video',
): Promise<Blob> {
	const selected = canonicalMediaContentBlob(options.expectedSnapshot);
	if (selected.size !== current.byteLength) {
		throw new Error(`The selected linked ${kind} original does not match the current byte length.`);
	}
	const selectedDigest = await digestMediaContent(selected, { signal: options.signal });
	if (selectedDigest !== current.sha256) {
		throw new Error(`The selected linked ${kind} original does not match the current SHA-256.`);
	}
	throwIfRelinkAborted(options.signal, kind);
	return selected;
}
