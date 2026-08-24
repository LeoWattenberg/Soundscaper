/* SPDX-License-Identifier: AGPL-3.0-only */

/** Main-only adapter from the authenticated OpenFX service to the live V14 transformer. */

import {
	createFramescaperOpenFxLiveFrameTransformFactory,
	type FramescaperOpenFxLiveFrameTransformPorts,
} from './framescaper-openfx-live-frame-transform.ts';
import type { FramescaperOpenFxMainService } from './openfx-main-service.ts';

export function createFramescaperOpenFxLiveFrameTransformRegistration(
	service: Pick<FramescaperOpenFxMainService, 'inventory' | 'execute'>,
) {
	if (!service || typeof service.inventory !== 'function' || typeof service.execute !== 'function') {
		throw new TypeError('OpenFX live registration requires the main-owned service.');
	}
	return createFramescaperOpenFxLiveFrameTransformFactory(Object.freeze({
		inventory: () => service.inventory(),
		execute: (request: Parameters<FramescaperOpenFxLiveFrameTransformPorts['execute']>[0]) => (
			service.execute(request)
		),
	}));
}
