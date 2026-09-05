/* SPDX-License-Identifier: AGPL-3.0-only */

import { isMixerGraphV21Surface } from '../mixer-graph-surface-v21.ts';
import { hasProductionMixerProjectAuthority } from '../project-schema-version.ts';
import type { EngineProject } from './types.ts';

/**
 * Which of the two audio graph builders compiles every path in one session.
 *
 * The engine resolves this once, when a project is loaded, and carries the
 * answer on the runtime host. Every scheduler, scrub, realtime-render and
 * offline-render call in that session then compiles through the same builder,
 * instead of each call re-deriving it from whatever the project object happens
 * to look like at that moment.
 */
export type ProjectGraphSelection = 'v21' | 'legacy';

/**
 * The default resolution.
 *
 * A persisted document declares its production mixer authority through the
 * family-qualified schema tuple, which is what playback has always keyed on.
 * Transient engine input — an audition preview, an effect-macro step, the
 * take-comp flatten that commits audio — is deliberately schema-less and never
 * carries that tuple, so it is admitted on the routing surface it actually
 * presents: a V21 mixer graph plus automation lanes is everything the
 * production builder reads. Schema-qualified documents are unaffected, because
 * the authority check already covers them.
 */
export function resolveProjectGraphSelection(
	project: EngineProject | null | undefined,
): ProjectGraphSelection {
	if (!project) return 'legacy';
	if (hasProductionMixerProjectAuthority(project)) return 'v21';
	return isMixerGraphV21Surface(project.mixer) && Array.isArray(project.automationLanes)
		? 'v21'
		: 'legacy';
}
