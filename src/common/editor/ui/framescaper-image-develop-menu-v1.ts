/* SPDX-License-Identifier: AGPL-3.0-only */

import { framescaperImageDevelopCopy } from '../../i18n/framescaper-image-develop-copy.ts';
import { isCurrentProjectSchemaIdentity, FRAMESCAPER_PROJECT_SCHEMA_FAMILY } from '../project-schema-identity.ts';
import type { FramescaperProject } from '../../../framescaper/editor-project.ts';

export type FramescaperImageDevelopKindV1 = 'repairs' | 'masks' | 'brush';
interface Item { readonly id: string; readonly label: string; readonly disabled: boolean; onClick(): unknown }
/** Presentation reads only scalar menu availability. The selected native
 * controller admits the complete current project and owns every edit. */
export function createFramescaperImageDevelopMenuItemsV1(input: Readonly<{
	productId: string; project: unknown; selectedClipId?: unknown; editingBlocked: boolean; readOnly?: boolean; locale?: string;
}>, open?: (kind: FramescaperImageDevelopKindV1) => unknown): readonly Item[] {
	if (input.productId !== 'framescaper' || !isCurrentProjectSchemaIdentity(input.project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY)) return Object.freeze([]);
	const project = input.project as FramescaperProject;
	const clip = [...project.clips, ...project.projectBin.clips].find(value => value.id === input.selectedClipId);
	const source = clip && project.sources.find(value => value.id === clip.sourceId);
	const locked = clip && project.tracks.some(value => value.locked && Array.isArray(value.clipIds) && value.clipIds.includes(clip.id));
	const enabled = !input.editingBlocked && input.readOnly !== true && typeof open === 'function' && !locked
		&& clip?.kind === 'image' && source?.kind === 'image' && source.canonical.frameCount === 1;
	const copy = framescaperImageDevelopCopy(input.locale ?? 'en');
	return Object.freeze((['repairs', 'masks', 'brush'] as const).map(kind => Object.freeze({
		id: `image-develop-${kind}`, label: copy[kind], disabled: !enabled, onClick: () => enabled ? open?.(kind) : undefined,
	})));
}
