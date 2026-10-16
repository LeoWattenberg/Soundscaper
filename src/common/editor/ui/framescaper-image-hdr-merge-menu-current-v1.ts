/* SPDX-License-Identifier: AGPL-3.0-only */

import { imageHdrMergeCopy } from '../../i18n/image-hdr-merge-copy.ts';
import { isCurrentProjectSchemaIdentity, FRAMESCAPER_PROJECT_SCHEMA_FAMILY } from '../project-schema-identity.ts';
import type { FramescaperProject } from '../../../framescaper/editor-project.ts';

interface Item { readonly id: string; readonly label: string; readonly disabled: boolean; onClick(): unknown }

/** Availability uses scalar source facts. The native owner authenticates the
 * complete selected Originals when the user opens this menu operation. */
export function createFramescaperImageHdrMergeMenuItemsCurrentV1(input: Readonly<{
	productId: string; project: unknown; editingBlocked: boolean; readOnly?: boolean; locale?: string;
}>, open?: () => unknown): readonly Item[] {
	if (input.productId !== 'framescaper' || !isCurrentProjectSchemaIdentity(input.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return Object.freeze([]);
	const project = input.project as FramescaperProject, ids = project.selection.clipIds;
	const clips = ids.map(id => project.clips.find(clip => clip.id === id));
	const sources = clips.map(clip => clip && project.sources.find(source => source.id === clip.sourceId));
	const valid = ids.length >= 2 && ids.length <= 9 && new Set(ids).size === ids.length && clips.every(clip => clip?.kind === 'image')
		&& new Set(sources.map(source => source?.id)).size === ids.length && sources.every(source => source?.kind === 'image'
			&& source.schemaVersion >= 1 && source.schemaVersion <= 4 && source.canonical.frameCount === 1 && source.canonical.hasAlpha === false
			&& source.canonical.width <= 8192 && source.canonical.height <= 8192 && source.canonical.width * source.canonical.height <= 16777216
			&& source.original.byteLength > 0 && source.original.byteLength <= 64 * 1024 * 1024)
		&& sources.every(source => source?.kind === 'image' && sources[0]?.kind === 'image'
			&& source.canonical.width === sources[0].canonical.width && source.canonical.height === sources[0].canonical.height);
	const enabled = valid && !input.editingBlocked && input.readOnly !== true && typeof open === 'function';
	return Object.freeze([Object.freeze({ id: 'image-hdr-merge', label: imageHdrMergeCopy(input.locale ?? 'en').menu, disabled: !enabled,
		onClick: () => enabled ? open?.() : undefined })]);
}
