/* SPDX-License-Identifier: AGPL-3.0-only */

import { applyEditorCommand } from '../../../../commands.js';
import type { AudioEditorCommand } from '../../../../commands/protocol.ts';
import { validateAudioEditorProjectV17 } from '../../../../project-v17-validation.ts';
import type { ProjectDocumentBody } from '../../../../project-document-body-types.ts';
import type { MediaClipLeaf, MediaSourceLeaf } from '../../../../project-media-types.ts';
import type { FramescaperImageClipV1, FramescaperImageSourceV1 } from '../../../../timeline-image-model.ts';

/** The durable cycle preserves the selected product's document identity and media inventory. */
export type TakeCycleProjectDocument = ProjectDocumentBody<
	MediaSourceLeaf | (FramescaperImageSourceV1 & Readonly<Record<string, unknown>>),
	MediaClipLeaf | (FramescaperImageClipV1 & Readonly<Record<string, unknown>>)
>;

/** The common fallback owns V17; product cycles supply their selected command runtime. */
export function applyDefaultTakeCycleProjectCommand(
	project: TakeCycleProjectDocument, command: AudioEditorCommand,
	options?: Readonly<{ now?: Date | string }>,
): TakeCycleProjectDocument {
	if (!validateAudioEditorProjectV17(project)) throw new TypeError('The default take cycle requires a V17 document.');
	return applyEditorCommand(project, command, options);
}
