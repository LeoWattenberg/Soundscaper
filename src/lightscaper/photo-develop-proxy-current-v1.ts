/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopProxyViewV3 } from '../common/editor/photo-library-develop-proxy-port-v3.ts';
import { captureImageDevelopRawRequestCurrentV1 } from '../common/editor/imaging/image-develop-raw-request-current-v1.ts';
import { prepareDevelopProxyMetadataCurrentV1 } from '../common/editor/imaging/image-develop-linear-metadata-current-v1.ts';
import { prepareImageDevelopMaskOverlaySelectionV1 } from '../common/editor/imaging/image-develop-mask-overlay-v1.ts';
import { prepareNativeDevelopProxySourceCurrentV1, withNativeDevelopProxySourceCurrentV1 } from '../common/editor/imaging/native-develop-proxy-source-current-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import type { ImageDevelopFrameOptionsV3 } from '../common/editor/imaging/image-develop-frame-v3.ts';

export const PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1 = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 67_108_864 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 134_217_728 }),
});

/** Authenticate the complete proxy-grid recipe before any source pixels are
 * read. Native-format sampling precedes every adjustment; no camera/culling
 * representation or persisted recipe projection participates in this path. */
export async function withPhotoDevelopProxyCurrentV1<Result>(value: unknown,
	consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>,
	evaluate: (request: unknown, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => Promise<Result>,
	options: ImageDevelopFrameOptionsV3): Promise<Result> {
	const signalField = typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, 'signal') : undefined;
	if (signalField && !Object.hasOwn(signalField, 'value')) throw new TypeError('Current proxy signal must be own data.');
	const signal = captureRepairSignalV1(signalField?.value), check = () => { checkRepairSignalV1(signal); };
	const prepared = (() => { try {
		check(); if (typeof consume !== 'function') throw new TypeError('Current proxy requires a scoped consumer.');
		const input = record(captureImageDevelopRawRequestCurrentV1(value), 'Current Develop proxy', ['frame', 'develop', 'signal', 'maskOverlay'], ['frame', 'develop']);
		const develop = field(input, 'develop', 'Current Develop proxy');
		const selection = Object.hasOwn(input, 'maskOverlay') ? prepareImageDevelopMaskOverlaySelectionV1(field(input, 'maskOverlay', 'Current Develop proxy')) : undefined;
		const plan = prepareNativeDevelopProxySourceCurrentV1(field(input, 'frame', 'Current Develop proxy'), signal);
		const request = { develop, ...(signal ? { signal } : {}), ...(selection ? { maskOverlay: selection } : {}) };
		const metadata = prepareDevelopProxyMetadataCurrentV1({ ...request, frame: { descriptor: plan.proxyPlan.descriptor } }, PHOTO_DEVELOP_PROXY_PROFILE_CURRENT_V1, options);
		check(); return { plan, peak: metadata.peakWorkingBytes, request };
	} catch (error) { check(); throw error; } })();
	return withNativeDevelopProxySourceCurrentV1(prepared.plan, prepared.peak,
		frame => evaluate({ ...prepared.request, frame }, consume));
}
