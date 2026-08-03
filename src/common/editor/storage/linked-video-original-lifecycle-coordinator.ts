/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	LinkedOriginalLifecycleCoordinator,
	LinkedOriginalLocatorCleanupError,
	LinkedOriginalProjectBindingCleanupError,
	type LinkedOriginalCleanupOperation,
	type LinkedOriginalProjectBindingCleanupOperation,
	type LinkedOriginalLifecycleBindingPort,
	type LinkedOriginalLifecycleResolverPort,
	type LocalStoreClearAdmission,
} from './linked-original-lifecycle-coordinator.ts';
import type {
	LinkedVideoOriginalLocatorReference,
	LinkedVideoOriginalRepository,
} from './linked-video-original-repository.ts';
import type { LinkedVideoOriginalResolver } from './linked-video-original-resolver.ts';
import type {
	LinkedOriginalBindingPublicationResult,
	LinkedOriginalTransientBindingReference,
} from './linked-original-transient-binding-reference.ts';

export {
	admitLocalStoreClear,
	type LocalStoreClearAdmission,
	type LocalStoreClearOperation,
	type LocalStoreClearPort,
} from './linked-original-lifecycle-coordinator.ts';

export type LinkedVideoOriginalCleanupOperation = LinkedOriginalCleanupOperation;

export interface LinkedVideoOriginalProjectBindingPruneResult {
	readonly durableVideoSourceIds: readonly string[];
	readonly removedLocatorReferences: readonly LinkedVideoOriginalLocatorReference[];
	readonly settledTransientBindings: readonly LinkedOriginalTransientBindingReference[];
}

export type LinkedVideoOriginalCleanupError =
	| LinkedVideoOriginalLocatorCleanupError
	| LinkedVideoOriginalProjectBindingCleanupError;

export interface LinkedVideoOriginalLifecycleOptions {
	readonly onCleanupError?: (error: LinkedVideoOriginalCleanupError) => void;
}

export class LinkedVideoOriginalLocatorCleanupError extends Error {
	readonly committed = true;
	readonly operation: LinkedVideoOriginalCleanupOperation;
	readonly pendingCount: number;

	constructor(
		operation: LinkedVideoOriginalCleanupOperation,
		pendingCount: number,
		cause: unknown,
	) {
		super('Committed linked-video binding cleanup could not release every platform locator.', { cause });
		this.name = 'LinkedVideoOriginalLocatorCleanupError';
		this.operation = operation;
		this.pendingCount = pendingCount;
	}
}

export class LinkedVideoOriginalProjectBindingCleanupError extends Error {
	readonly committed = true;
	readonly operation: LinkedOriginalProjectBindingCleanupOperation;
	readonly projectId: string;

	constructor(operation: LinkedOriginalProjectBindingCleanupOperation, projectId: string, cause: unknown) {
		super(`Project ${projectId} ${operation === 'save-project' ? 'committed' : 'activated'}, but linked-video binding cleanup failed.`, { cause });
		this.name = 'LinkedVideoOriginalProjectBindingCleanupError';
		this.operation = operation;
		this.projectId = projectId;
	}
}

/** Schema-v1 video facade over the kindful linked-original lifecycle. */
export class LinkedVideoOriginalLifecycleCoordinator {
	readonly #coordinator: LinkedOriginalLifecycleCoordinator;

	constructor(
		bindings: LinkedVideoOriginalRepository | null,
		resolver: LinkedVideoOriginalResolver | null,
		options: LinkedVideoOriginalLifecycleOptions = {},
	) {
		if (options.onCleanupError !== undefined && typeof options.onCleanupError !== 'function') {
			throw new TypeError('Linked-video locator cleanup reporting must be a function.');
		}
		this.#coordinator = new LinkedOriginalLifecycleCoordinator(
			bindings ? bindingAdapter(bindings) : null,
			resolver ? resolverAdapter(resolver) : null,
			options.onCleanupError ? {
				onCleanupError: (error) => { options.onCleanupError!(legacyCleanupError(error)); },
			} : {},
		);
	}

	run<Value>(operation: () => PromiseLike<Value> | Value): Promise<Value> {
		return this.#coordinator.run(operation);
	}

	bind<Value extends LinkedOriginalBindingPublicationResult>(
		projectId: string,
		sourceId: string,
		operation: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		return this.#coordinator.bind(projectId, { kind: 'video', sourceId }, operation);
	}

	unlink(
		projectId: string,
		sourceId: string,
		bindingToken: string,
		operation: () => PromiseLike<boolean> | boolean,
	): Promise<boolean> {
		return this.#coordinator.unlink(
			projectId,
			{ kind: 'video', sourceId, bindingToken },
			operation,
		);
	}

	saveProject<Value>(
		projectId: string,
		operation: (maintain: () => Promise<void>) => PromiseLike<Value> | Value,
		prune: (
			transientBindings: readonly LinkedOriginalTransientBindingReference[],
		) => PromiseLike<LinkedVideoOriginalProjectBindingPruneResult | null>
			| LinkedVideoOriginalProjectBindingPruneResult | null,
	): Promise<Value> {
		return this.#coordinator.saveProject(projectId, operation, async (transientBindings) => {
			const result = await prune(transientBindings);
			if (!result) return null;
			return Object.freeze({
				durableSourceReferences: Object.freeze(result.durableVideoSourceIds.map((sourceId) => (
					Object.freeze({ kind: 'video' as const, sourceId })
				))),
				removedLocatorReferences: Object.freeze(result.removedLocatorReferences.map((reference) => (
					Object.freeze({ kind: 'video' as const, ...reference })
				))),
				settledTransientBindings: result.settledTransientBindings,
			});
		});
	}

	maintainOpenedProject(
		projectId: string,
		prune: (
			transientBindings: readonly LinkedOriginalTransientBindingReference[],
		) => PromiseLike<LinkedVideoOriginalProjectBindingPruneResult | null>
			| LinkedVideoOriginalProjectBindingPruneResult | null,
	): Promise<boolean> {
		return this.#coordinator.maintainOpenedProject(projectId, async (transientBindings) => {
			const result = await prune(transientBindings);
			if (!result) return null;
			return Object.freeze({
				durableSourceReferences: Object.freeze(result.durableVideoSourceIds.map((sourceId) => (
					Object.freeze({ kind: 'video' as const, sourceId })
				))),
				removedLocatorReferences: Object.freeze(result.removedLocatorReferences.map((reference) => (
					Object.freeze({ kind: 'video' as const, ...reference })
				))),
				settledTransientBindings: result.settledTransientBindings,
			});
		});
	}

	deleteProject<Value>(
		projectIdOrOperation: string | (() => PromiseLike<Value> | Value),
		requestedOperation?: () => PromiseLike<Value> | Value,
	): Promise<Value> {
		return this.#coordinator.deleteProject(projectIdOrOperation, requestedOperation);
	}

	clear(admission: LocalStoreClearAdmission): Promise<void> {
		return this.#coordinator.clear(admission);
	}

	releaseUnused(reference: LinkedVideoOriginalLocatorReference): Promise<boolean> {
		return this.#coordinator.releaseUnused(genericReferenceFromLegacy(reference));
	}
}

function genericReferenceFromLegacy(value: unknown): Readonly<{
	kind: 'video';
	locatorId: string;
	locatorRevision: string;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked video original locator reference is required.');
	}
	const fields = ['locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked video original locator reference contains an unsupported field.');
	}
	const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
	for (const field of fields) {
		const descriptor = Object.getOwnPropertyDescriptor(value, field);
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`Linked video original ${field} must be an enumerable data field.`);
		}
		output[field] = descriptor.value;
	}
	return Object.freeze({
		kind: 'video',
		locatorId: output.locatorId as string,
		locatorRevision: output.locatorRevision as string,
	});
}

function bindingAdapter(repository: LinkedVideoOriginalRepository): LinkedOriginalLifecycleBindingPort {
	return {
		listLocatorReferences: async () => Object.freeze((await repository.listLocatorReferences()).map(
			(reference) => Object.freeze({ kind: 'video' as const, ...reference }),
		)),
	};
}

function resolverAdapter(resolver: LinkedVideoOriginalResolver): LinkedOriginalLifecycleResolverPort {
	return {
		canReleaseLocators: () => resolver.canReleaseLocators(),
		validateLocatorReference: (value) => {
			const reference = genericVideoReference(value);
			const admitted = resolver.validateLocatorReference({
				locatorId: reference.locatorId,
				locatorRevision: reference.locatorRevision,
			});
			return Object.freeze({ kind: 'video', ...admitted });
		},
		release: (reference) => resolver.release({
			locatorId: reference.locatorId,
			locatorRevision: reference.locatorRevision,
		}),
	};
}

function genericVideoReference(value: unknown): Readonly<{
	kind: 'video';
	locatorId: unknown;
	locatorRevision: unknown;
}> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('A linked video original locator reference is required.');
	}
	const fields = ['kind', 'locatorId', 'locatorRevision'];
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some((key) => !fields.includes(String(key)))) {
		throw new TypeError('A linked video original locator reference contains an unsupported field.');
	}
	const record = value as Readonly<Record<string, unknown>>;
	if (record.kind !== 'video') throw new TypeError('A linked video original locator must be video.');
	return record as ReturnType<typeof genericVideoReference>;
}

function legacyCleanupError(
	error: LinkedOriginalLocatorCleanupError | LinkedOriginalProjectBindingCleanupError,
): LinkedVideoOriginalCleanupError {
	return error instanceof LinkedOriginalLocatorCleanupError
		? new LinkedVideoOriginalLocatorCleanupError(error.operation, error.pendingCount, error.cause)
		: new LinkedVideoOriginalProjectBindingCleanupError(error.operation, error.projectId, error.cause);
}
