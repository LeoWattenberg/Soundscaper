/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectTransferImportStore } from './project-transfer-bundle-admission.ts';
import { admittedProjectTransferId, asProjectTransferRecord } from './project-transfer-record.ts';

/** The create-only seams, in the order the .scape import itself prefers them. */
const PROJECT_PUBLICATION_SEAMS = ['createScapeProjectIfAbsent', 'createProjectIfAbsent'] as const;

export interface ProjectTransferWriteWitness {
	/** The store to hand the archive import in place of the real one. */
	readonly store: ProjectTransferImportStore;
	/** The exact document the store published for this identity, if any. */
	created(): unknown;
}

interface ProjectTransferWriteWitnessState {
	readonly projectId: string;
	readonly facades: WeakMap<object, ProjectTransferImportStore>;
	created: unknown;
}

const PROJECT_TRANSFER_WRITE_WITNESSES = new WeakMap<object, ProjectTransferWriteWitnessState>();

/**
 * Hand the archive import a facade over the receiving store that remembers the
 * exact document the store published for this identity.
 *
 * Everything is forwarded to the real store, and every method is applied with
 * the real store as its receiver, so a store built on private fields behaves
 * exactly as it would unwrapped. The only addition is that a create-only
 * publication's return value is retained when it carries this project id.
 */
export function witnessProjectTransferWrites(
	store: ProjectTransferImportStore,
	projectId: string,
): ProjectTransferWriteWitness {
	const state: ProjectTransferWriteWitnessState = {
		projectId,
		facades: new WeakMap(),
		created: null,
	};
	const facade = witnessStore(store as object, state);
	return Object.freeze({ store: facade, created: () => state.created });
}

/**
 * Preserve a transfer write witness when archive routing substitutes a family
 * home for the federation the import layer originally wrapped.
 */
export function projectTransferWitnessedHomeStore(store: unknown, homeStore: unknown): unknown {
	if (store === null || typeof store !== 'object'
		|| homeStore === null || typeof homeStore !== 'object') return homeStore;
	const state = PROJECT_TRANSFER_WRITE_WITNESSES.get(store);
	return state ? witnessStore(homeStore, state) : homeStore;
}

function witnessStore(
	store: object,
	state: ProjectTransferWriteWitnessState,
): ProjectTransferImportStore {
	const existing = state.facades.get(store);
	if (existing) return existing;
	const facade = new Proxy(store, {
		get(target, property) {
			const value = Reflect.get(target, property, target);
			if (typeof value !== 'function') return value;
			const method = value as (...args: unknown[]) => unknown;
			if (!(PROJECT_PUBLICATION_SEAMS as readonly (string | symbol)[]).includes(property)) {
				return (...args: unknown[]) => method.apply(target, args);
			}
			return async (...args: unknown[]) => {
				const published = await method.apply(target, args);
				const identity = asProjectTransferRecord(published).id;
				if (published && admittedProjectTransferId(identity) === state.projectId) {
					state.created = published;
				}
				return published;
			};
		},
	}) as ProjectTransferImportStore;
	state.facades.set(store, facade);
	PROJECT_TRANSFER_WRITE_WITNESSES.set(facade as object, state);
	return facade;
}
