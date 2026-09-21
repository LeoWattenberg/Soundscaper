/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createProjectImportService as createService,
	type ProjectImportRuntime as ProductionRuntime,
} from '../../src/common/editor/controller/import/internal/project-import-service.ts';

/**
 * Routing and rollback tests intentionally supply only the ports their branch
 * reaches, including malformed decoder results. Keep that fault-injection
 * boundary here; production composition must satisfy the complete contract.
 */
export type ProjectImportRuntime = Record<string, unknown>;

export function createProjectImportService(runtime: ProjectImportRuntime) {
	let fixtureId = 0;
	let attributionFixtureId = 0;
	// Production IDs are opaque and prefix-namespaced. Keep attribution IDs on
	// their own fixture sequence so adding provenance does not renumber the
	// source IDs used by rollback and lifecycle synchronization assertions.
	const suppliedCreateStableId = Object.hasOwn(runtime, 'createStableId')
		&& typeof runtime.createStableId === 'function'
		? runtime.createStableId as (prefix: string) => string
		: null;
	const completed = new Proxy(runtime, {
		get(target, property, receiver) {
			if (property === 'createStableId') {
				return (prefix: string) => {
					if (prefix === 'attribution') {
						return `${prefix}-fixture-${String(++attributionFixtureId)}`;
					}
					return suppliedCreateStableId?.(prefix)
						?? `${prefix}-fixture-${String(++fixtureId)}`;
				};
			}
			return Reflect.get(target, property, receiver) as unknown;
		},
	});
	return createService(completed as unknown as ProductionRuntime);
}
