/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	PROJECT_SCHEMA_VERSION,
	readProjectSchemaIdentity,
	type ProjectSchemaFamily,
	type ProjectSchemaIdentity,
} from '../editor/project-schema-identity.ts';
import type {
	ProjectTransferArchiveExport,
	ProjectTransferArchiveImport,
	ProjectTransferArchiveInspect,
} from './project-transfer-bundle.ts';

export interface TransferFamilyArchiveRuntime {
	readonly exportProject: ProjectTransferArchiveExport;
	readonly inspectProject: ProjectTransferArchiveInspect;
	readonly importProject: ProjectTransferArchiveImport;
}

export interface CreateFamilyOwnedTransferArchiveRuntimeOptions {
	readonly probeArchiveIdentity: (
		input: unknown,
		options: Readonly<{ signal?: AbortSignal }>,
	) => PromiseLike<Readonly<ProjectSchemaIdentity>> | Readonly<ProjectSchemaIdentity>;
	readonly runtimes: Readonly<Record<ProjectSchemaFamily, TransferFamilyArchiveRuntime>>;
}

/**
 * Dispatch complete archive reads and writes to the product that owns the family-v1 root.
 * The probe is envelope-only; a product runtime is selected only after the closed tuple is known.
 */
export function createFamilyOwnedTransferArchiveRuntime(
	options: CreateFamilyOwnedTransferArchiveRuntimeOptions,
): Readonly<TransferFamilyArchiveRuntime> {
	if (!options || typeof options !== 'object' || typeof options.probeArchiveIdentity !== 'function') {
		throw new TypeError('Family-owned transfer archive dispatch requires an identity probe.');
	}
	const exportProject: ProjectTransferArchiveExport = (project, store, archiveOptions) => ownerFor(
		options.runtimes, readProjectSchemaIdentity(project),
	).exportProject(project, store, archiveOptions);
	const inspectProject: ProjectTransferArchiveInspect = async (input, store, archiveOptions) => ownerFor(
		options.runtimes, await options.probeArchiveIdentity(input, archiveOptions),
	).inspectProject(input, store, archiveOptions);
	const importProject: ProjectTransferArchiveImport = async (input, store, archiveOptions) => ownerFor(
		options.runtimes, await options.probeArchiveIdentity(input, archiveOptions),
	).importProject(input, store, archiveOptions);
	return Object.freeze({
		exportProject,
		inspectProject,
		importProject,
	});
}

function ownerFor(
	runtimes: Readonly<Record<ProjectSchemaFamily, TransferFamilyArchiveRuntime>>,
	identity: Readonly<ProjectSchemaIdentity>,
): TransferFamilyArchiveRuntime {
	if (identity.schemaVersion !== PROJECT_SCHEMA_VERSION) {
		throw new RangeError(
			`Family-owned transfer archive I/O requires family-v1, not ${identity.schemaFamily}`
				+ ` schema ${String(identity.schemaVersion)}.`,
		);
	}
	const runtime = runtimes[identity.schemaFamily];
	if (!runtime || typeof runtime.exportProject !== 'function'
		|| typeof runtime.inspectProject !== 'function' || typeof runtime.importProject !== 'function') {
		throw new TypeError(`No transfer archive runtime owns ${identity.schemaFamily} family-v1.`);
	}
	return runtime;
}
