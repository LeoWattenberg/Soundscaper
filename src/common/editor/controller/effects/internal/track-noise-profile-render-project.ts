/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAutomationLaneV21 } from '../../../automation-lane-v21.ts';
import { createIsolatedTrackRenderProjectV21, type IsolatedTrackRenderProjectV21 }
	from '../../shared/isolated-track-render-project-v21.ts';
import { projectTransientRenderFeatures } from '../../shared/transient-render-feature-projection.ts';
import type { EffectAudioEffect, EffectAudioProject } from './effect-audio-service-types.ts';

/** Profile the authored rack prefix while excluding its listening strip and later processors. */
export function createTrackNoiseProfileRenderProject(
	project: EffectAudioProject, trackId: string, prefix: readonly EffectAudioEffect[],
): EffectAudioProject {
	const isolated = createIsolatedTrackRenderProjectV21(project as unknown as IsolatedTrackRenderProjectV21,
		{ trackId, effects: prefix });
	const prefixIds = new Set(prefix.map(effect => effect.id));
	const lanes: readonly unknown[] = Array.isArray(project.automationLanes) ? project.automationLanes : [];
	const capture = { ...isolated, automationLanes: lanes.map(lane => normalizeAutomationLaneV21(lane))
		.filter(({ address }) => address.kind === 'effect' && address.strip.kind === 'track'
			&& address.strip.id === trackId && prefixIds.has(address.effectId)) };
	projectTransientRenderFeatures(capture);
	return capture as unknown as EffectAudioProject;
}
