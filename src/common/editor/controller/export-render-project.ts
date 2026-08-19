/* SPDX-License-Identifier: AGPL-3.0-only */

import { cloneProject } from '../project.js';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';

/**
 * Detach the document an export renders from, without re-validating it.
 *
 * What an export renders is the delivery projection, and that projection is
 * deliberately not a canonical document: folder media state has been flattened
 * onto the leaves under a marker, a frozen track has had its render substituted
 * and its freeze record removed, and a rendered fallback may stand in for the
 * timeline. Playback hands exactly that object to the engine.
 *
 * Passing it through a product's canonical clone therefore refuses documents
 * that play perfectly well — the marker is a field the closed V21/V23 record
 * does not know, and the substituted track no longer satisfies the freeze
 * invariant the canonical validator enforces. The canonical document has
 * already been validated where it was loaded and committed; this is a transient
 * copy of a projection of it, so it is cloned structurally and its projection
 * trust is carried across rather than re-derived.
 */
export function createExportRenderProject<Project extends object>(project: Project): Project {
	const mediaProject = projectTrackFolderMediaStateV12(project);
	return inheritTrackFolderMediaStateProjectionV12(
		mediaProject,
		cloneProject(mediaProject as Parameters<typeof cloneProject>[0]) as Project,
	);
}
