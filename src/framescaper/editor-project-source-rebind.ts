/* SPDX-License-Identifier: AGPL-3.0-only */

import { rebindFramescaperSourceIdentitiesAssistance } from './editor-project-assistance-source-rebind.ts';

/** Rebind every selected visual, image, and assistance source reference in place. */
export function rebindFramescaperSourceIdentities(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperSourceIdentitiesAssistance(project, sourceIdMap);
}
