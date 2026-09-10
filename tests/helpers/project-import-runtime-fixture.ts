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
	return createService(runtime as unknown as ProductionRuntime);
}
