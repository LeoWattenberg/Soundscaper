/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopProxyRuntimeV3 } from '../common/editor/photo-library-develop-proxy-port-v3.ts';
import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withPhotoDevelopFullResolutionFrameV3, withPhotoDevelopProxyFrameV3, type PhotoDevelopFrameOptionsV3 } from './controller/photo-develop-frame-v3.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './controller/photo-develop-frame-core.ts';
import { capturePhotoCubeLutSource } from './controller/photo-cube-lut-source-binding.ts';
import { captureMaskRasterSourceV1 } from '../common/editor/imaging/mask-raster-source-scope-v1.ts';

/** Pin selected resources before any original borrower or runtime operation yields. */
export function createPhotoDevelopRenderRuntimeV3(optionsValue: PhotoDevelopFrameOptionsV3 = {}): Readonly<PhotoLibraryDevelopProxyRuntimeV3> {
	const input = record(optionsValue, 'Photo develop runtime options', ['source', 'maskSource'], []);
	const raw = Object.hasOwn(input, 'source') ? field(input, 'source', 'Photo develop runtime source') : undefined;
	const mask = Object.hasOwn(input, 'maskSource') ? field(input, 'maskSource', 'Photo develop runtime mask source') : undefined;
	const options = Object.freeze({ ...(raw === undefined ? {} : { source: capturePhotoCubeLutSource(raw) }),
		...(mask === undefined ? {} : { maskSource: captureMaskRasterSourceV1(mask) }) });
	return Object.freeze<PhotoLibraryDevelopProxyRuntimeV3>({
		withProxy: (request, consume) => withPhotoDevelopProxyFrameV3(request,
			view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_PROXY_LIMITS_V1.render), histogram: view.histogram,
				...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }), options),
		withFullResolution: (request, consume) => withPhotoDevelopFullResolutionFrameV3(request,
			view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render), histogram: view.histogram,
				...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }), options),
	});
}
