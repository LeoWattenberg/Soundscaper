/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopProxyRuntimeV2 } from '../common/editor/photo-library-develop-proxy-port-v2.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withPhotoDevelopFullResolutionFrameV2, withPhotoDevelopProxyFrameV2, type PhotoDevelopFrameOptionsV2 } from './controller/photo-develop-frame-v2.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './controller/photo-develop-frame-core.ts';
import { capturePhotoCubeLutSource } from './controller/photo-cube-lut-source-binding.ts';
import { captureMaskRasterSourceV1 } from '../common/editor/imaging/mask-raster-source-scope-v1.ts';

/** Current composition pins its selected resource receiver before the UI can await.
 * Bodies and original pixels remain borrowed inside each joined operation. */
export function createPhotoDevelopRenderRuntimeV2(optionsValue: PhotoDevelopFrameOptionsV2 = {}): Readonly<PhotoLibraryDevelopProxyRuntimeV2> {
	const input = record(optionsValue, 'Photo develop runtime options', ['source', 'maskSource'], []);
	const raw = Object.hasOwn(input, 'source') ? field(input, 'source', 'Photo develop runtime source') : undefined;
	const mask = Object.hasOwn(input, 'maskSource') ? field(input, 'maskSource', 'Photo develop runtime mask source') : undefined;
	const options = Object.freeze({ ...(raw === undefined ? {} : { source: capturePhotoCubeLutSource(raw) }),
		...(mask === undefined ? {} : { maskSource: captureMaskRasterSourceV1(mask) }) });
	return Object.freeze<PhotoLibraryDevelopProxyRuntimeV2>({
		withProxy: (request, consume) => withPhotoDevelopProxyFrameV2(request,
			view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_PROXY_LIMITS_V1.render), histogram: view.histogram,
				...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }), options),
		withFullResolution: (request, consume) => withPhotoDevelopFullResolutionFrameV2(request,
			view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render), histogram: view.histogram,
				...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }), options),
	});
}
