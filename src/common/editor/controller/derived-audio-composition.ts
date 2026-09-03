/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createDerivedSourceService,
	type DerivedSourceService,
	type DerivedSourceServiceDependencies,
} from './derived-source-service.ts';
import {
	createClipResampleService,
	type ClipResampleService,
	type ClipResampleServiceDependencies,
} from './clip-resample-service.ts';
import {
	createTrackTransformService,
	type TrackTransformService,
	type TrackTransformServiceDependencies,
} from './track-transform-service.ts';

/**
 * Everything the three services need, less the derived-source service itself.
 *
 * The transform services take that service as a dependency, so a caller that
 * builds them separately has to hold the wiring order as well as the union of
 * dependencies. Composing them here means the controller states the union once
 * and never sees the order at all.
 */
export type DerivedAudioCompositionDependencies =
	& DerivedSourceServiceDependencies
	& Omit<TrackTransformServiceDependencies, 'derivedSources'>
	& Omit<ClipResampleServiceDependencies, 'derivedSources'>;

export interface DerivedAudioComposition extends TrackTransformService, ClipResampleService {
	readonly derivedSources: DerivedSourceService;
}

/**
 * Builds the services that rewrite audio into new immutable sources.
 *
 * Resampling a track and resampling a clip are the same operation at different
 * scopes, and both land through the derived-source service that owns writing
 * the rewritten audio back into the store, so the three travel together.
 */
export function createDerivedAudioComposition(
	dependencies: DerivedAudioCompositionDependencies,
): DerivedAudioComposition {
	const derivedSources = createDerivedSourceService(dependencies);
	const transforms = { ...dependencies, derivedSources };
	return Object.freeze({
		derivedSources,
		...createTrackTransformService(transforms),
		...createClipResampleService(transforms),
	});
}
