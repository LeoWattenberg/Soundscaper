/* SPDX-License-Identifier: AGPL-3.0-only */
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorPlaybackCanonicalProject } from './editor-project-successor-playback.ts';
/** Playback projections carry their own immutable canonical owner; never read a newer live document. */
export function framescaperCompositionPreviewProject(value: unknown) {
	const retained = value && typeof value === 'object' ? framescaperSuccessorPlaybackCanonicalProject(value) : null;
	if (retained) return retained;
	return classifyProjectSchemaIdentity(value, 'framescaper', 'successor').disposition === 'current' ? normalizeFramescaperSuccessorProject(value) : null;
}
