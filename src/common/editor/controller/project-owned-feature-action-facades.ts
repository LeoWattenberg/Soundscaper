/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAudioWarpActionFacade } from './audio-warp-action-facade.ts';
import { createTakeCompActionFacade } from './take-comp-action-facade.ts';

export interface ProjectOwnedFeatureActionFacadeDependencies {
	readonly capabilities: Readonly<{ readonly audioWarp?: unknown; readonly takeComp?: unknown }>;
	readonly product: Readonly<{ readonly name: string }>;
	readonly audioWarpService: Readonly<Record<string, unknown>>;
	readonly takeCompService: Readonly<Record<string, unknown>>;
}

/** Keep project-owned feature facade wiring out of the near-limit root facade. */
export function createProjectOwnedFeatureActionFacades(
	dependencies: ProjectOwnedFeatureActionFacadeDependencies,
) {
	return Object.freeze({
		audioWarp: createAudioWarpActionFacade({
			enabled: Boolean(dependencies.capabilities.audioWarp),
			productName: dependencies.product.name,
			service: dependencies.audioWarpService,
		}),
		takeComp: createTakeCompActionFacade({
			enabled: Boolean(dependencies.capabilities.takeComp),
			productName: dependencies.product.name,
			service: dependencies.takeCompService,
		}),
	});
}
