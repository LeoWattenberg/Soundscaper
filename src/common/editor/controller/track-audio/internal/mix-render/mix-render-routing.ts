/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { preserveProductionTrackRouting } from '../../../../derived-track-routing.ts';
import type { MixRenderOperationCommit } from './mix-render-commit.ts';
import type { ControllerProject } from '../../track-domain-types.ts';

export { preserveProductionTrackRouting } from '../../../../derived-track-routing.ts';

type RoutingProject = Readonly<Record<string, unknown>>;

export type MixRenderCommandPreview = (
	project: ControllerProject,
	command: AudioEditorCommand,
) => RoutingProject;

/** Restate production sibling routes after all new clips have established their exact widths. */
export function preserveProductionMixRenderRouting(
	project: ControllerProject,
	prepared: Readonly<MixRenderOperationCommit>,
	previewCommand: MixRenderCommandPreview,
	createId: (prefix: string) => string,
): Readonly<MixRenderOperationCommit> {
	const command = preserveProductionTrackRouting(project, prepared.command, prepared.routingCopies,
		previewCommand, createId, prepared.directRoutingTrackIds);
	return command === prepared.command ? prepared : Object.freeze({ ...prepared, command });
}
