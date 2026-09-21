/* SPDX-License-Identifier: AGPL-3.0-only */

import { createTakeCompDocumentGroupsV17 } from '../../../../take-comp-document-v17.ts';
import type { SourceProvenanceV1 } from '../../../../source-provenance.ts';

/** Media fields read by take authoring, audition, and flattening in either product. */
export interface TakeCompProject extends Readonly<Record<string, unknown>> {
	readonly sampleRate: number;
	readonly sources: readonly Readonly<{
		readonly id?: unknown;
		readonly name?: unknown;
		readonly provenance?: SourceProvenanceV1;
	}>[];
	readonly tracks: readonly Readonly<{ readonly id: string; readonly locked?: boolean }>[];
}

/** Admit the take graph against its owning sources, tracks, and sequences. */
export function readTakeCompProjectGroups(project: TakeCompProject) {
	return createTakeCompDocumentGroupsV17(project.takeGroups, project);
}
