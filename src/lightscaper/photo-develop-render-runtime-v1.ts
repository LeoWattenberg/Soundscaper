/* SPDX-License-Identifier: AGPL-3.0-only */

import type { PhotoLibraryDevelopProxyRuntimeV1 } from '../common/editor/photo-library-develop-proxy-port-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withPhotoDevelopFullResolutionFrameV1, withPhotoDevelopProxyFrameV1, PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './controller/photo-develop-frame-v1.ts';

/** Product composition stays lazy. Both named render paths deliver only the
 * borrowed frame view and scalar histogram; neither retains original pixels. */
export const PHOTO_DEVELOP_RENDER_RUNTIME_V1: PhotoLibraryDevelopProxyRuntimeV1 = Object.freeze<PhotoLibraryDevelopProxyRuntimeV1>({
	withProxy: (request, consume) => withPhotoDevelopProxyFrameV1(request,
		view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_PROXY_LIMITS_V1.render), histogram: view.histogram })),
	withFullResolution: (request, consume) => withPhotoDevelopFullResolutionFrameV1(request,
		view => consume({ frame: readPixelFrameV1(view.frame, PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1.render), histogram: view.histogram })),
});
