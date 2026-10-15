/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopFrameRequestV3, PhotoLibraryDevelopProxyRuntimeV3, PhotoLibraryDevelopProxyViewV3 } from '../common/editor/photo-library-develop-proxy-port-v3.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1, type PhotoLibraryDevelopLinearRuntimeV1 } from '../common/editor/photo-library-develop-linear-port-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../common/editor/imaging/image-develop-linear-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createPixelFrameHistogramV1 } from '../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from './photo-develop-render-runtime-v3.ts';
import type { PhotoDevelopFrameOptionsV3 } from './controller/photo-develop-frame-v3.ts';
import { capturePhotoCubeLutSource } from './controller/photo-cube-lut-source-binding.ts';
import { captureMaskRasterSourceV1 } from '../common/editor/imaging/mask-raster-source-scope-v1.ts';
import { withPhotoDevelopProxyCurrentV1, PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1 } from './photo-develop-proxy-current-v1.ts';
import { withImageDevelopFrameCurrentV1 } from '../common/editor/imaging/image-develop-frame-current-v1.ts';
import { PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 } from '../common/editor/photo-library-develop-full-resolution-port-v1.ts';
import { PHOTO_DEVELOP_PROXY_LIMITS_V1 } from './controller/photo-develop-frame-core.ts';
import { readPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';

/** Active composition widens native depth. The permanent V3 renderer remains
 * the exact byte implementation; deep color stays Float32 through development.
 * Histogram bytes retire before a rendered frame reaches its consumer. */
export function createPhotoDevelopRenderRuntimeCurrentV1(optionsValue: PhotoDevelopFrameOptionsV3 = {}): Readonly<PhotoLibraryDevelopProxyRuntimeV3 & PhotoLibraryDevelopLinearRuntimeV1> {
	const input = record(optionsValue, 'Current develop runtime options', ['source', 'maskSource'], []);
	const source = Object.hasOwn(input, 'source') ? field(input, 'source', 'Current develop runtime source') : undefined;
	const mask = Object.hasOwn(input, 'maskSource') ? field(input, 'maskSource', 'Current develop runtime mask source') : undefined;
	const options = Object.freeze({ ...(source === undefined ? {} : { source: capturePhotoCubeLutSource(source) }),
		...(mask === undefined ? {} : { maskSource: captureMaskRasterSourceV1(mask) }) });
	const byte = createPhotoDevelopRenderRuntimeV3(options);
	return Object.freeze({ withLinearWorkingFrame: byte.withLinearWorkingFrame,
		withProxy: <Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) =>
			withPhotoDevelopProxyCurrentV1(request, consume, (value, accept) => render('proxy', value, accept, options), options),
		withFullResolution: <Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => render('full', request, consume, options),
	});
}

async function render<Result>(resolution: 'proxy' | 'full', request: unknown,
	consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>, options: PhotoDevelopFrameOptionsV3): Promise<Result> {
	const signalField = typeof request === 'object' && request !== null ? Object.getOwnPropertyDescriptor(request, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Current render signal must be an own data property.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); }; check();
	if (typeof consume !== 'function') throw new TypeError('Current rendering requires a scoped consumer.');
	const input = record(request, 'Current render', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
	const raw = field(input, 'frame', 'Current render');
	if (typeof raw !== 'object' || raw === null) throw new TypeError('Current render requires a pixel frame.');
	const descriptor = field(raw as Readonly<Record<string, unknown>>, 'descriptor', 'Current render source');
	const metadata = record(descriptor, 'Current render descriptor', ['schemaVersion', 'width', 'height', 'sampleFormat', 'primaries', 'transfer']);
	if (field(metadata, 'sampleFormat', 'Current render descriptor') === 'unorm8') {
		const profile = resolution === 'full' ? PHOTO_DEVELOP_FULL_RESOLUTION_LIMITS_V1 : PHOTO_DEVELOP_PROXY_LIMITS_V1;
		return withImageDevelopFrameCurrentV1(request, view => consume({ frame: readPixelFrameV1(view.frame, profile.render), histogram: view.histogram,
			...(view.maskOverlay ? { maskOverlay: view.maskOverlay } : {}) }), profile, options);
	}
	const profile = resolution === 'full' ? PHOTO_DEVELOP_LINEAR_LIMITS_V1 : PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1;
	return withImageDevelopLinearCurrentV1(request, async (frame, maskOverlay) => {
		const histogram = await withLinearPixelFrameDisplayV1({ frame, ...(signal ? { signal } : {}) },
			encoded => createPixelFrameHistogramV1(encoded, { ...(signal ? { signal } : {}) }), 'full');
		check(); const result = await consume(Object.freeze({ frame, histogram, ...(maskOverlay ? { maskOverlay } : {}) })); check(); return result;
	}, profile, options);
}
