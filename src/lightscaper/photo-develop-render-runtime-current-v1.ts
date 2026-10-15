/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../common/editor/closed-domain-value.ts';
import type { PhotoLibraryDevelopFrameRequestV3, PhotoLibraryDevelopProxyRuntimeV3, PhotoLibraryDevelopProxyViewV3 } from '../common/editor/photo-library-develop-proxy-port-v3.ts';
import { PHOTO_DEVELOP_LINEAR_LIMITS_V1, type PhotoLibraryDevelopLinearRuntimeV1 } from '../common/editor/photo-library-develop-linear-port-v1.ts';
import { planPixelFrameV1 } from '../common/editor/imaging/pixel-frame-contract-v1.ts';
import { withImageDevelopLinearCurrentV1 } from '../common/editor/imaging/image-develop-linear-current-v1.ts';
import { withLinearPixelFrameDisplayV1 } from '../common/editor/imaging/pixel-frame-linear-display-v1.ts';
import { createPixelFrameHistogramV1 } from '../common/editor/imaging/pixel-frame-histogram-v1.ts';
import { captureRepairSignalV1, checkRepairSignalV1 } from '../common/editor/imaging/pixel-frame-repair-lifetime-v1.ts';
import { createPhotoDevelopRenderRuntimeV3 } from './photo-develop-render-runtime-v3.ts';
import type { PhotoDevelopFrameOptionsV3 } from './controller/photo-develop-frame-v3.ts';

const PROXY = Object.freeze({
	source: Object.freeze({ maximumSidePixels: 2048, maximumPixels: 4_194_304, maximumBytes: 67_108_864 }),
	render: Object.freeze({ maximumSidePixels: 4096, maximumPixels: 8_388_608, maximumBytes: 134_217_728 }),
});

/** Active composition widens native depth. The permanent V3 renderer remains
 * the exact byte implementation; deep color stays Float32 through development.
 * Histogram bytes retire before a rendered frame reaches its consumer. */
export function createPhotoDevelopRenderRuntimeCurrentV1(options: PhotoDevelopFrameOptionsV3 = {}): Readonly<PhotoLibraryDevelopProxyRuntimeV3 & PhotoLibraryDevelopLinearRuntimeV1> {
	const byte = createPhotoDevelopRenderRuntimeV3(options);
	return Object.freeze({ withLinearWorkingFrame: byte.withLinearWorkingFrame,
		withProxy: <Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => render('proxy', request, consume, byte),
		withFullResolution: <Result>(request: Readonly<PhotoLibraryDevelopFrameRequestV3>, consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>) => render('full', request, consume, byte),
	});
}

async function render<Result>(resolution: 'proxy' | 'full', request: Readonly<PhotoLibraryDevelopFrameRequestV3>,
	consume: (view: PhotoLibraryDevelopProxyViewV3) => Result | Promise<Result>, byte: Readonly<PhotoLibraryDevelopProxyRuntimeV3>): Promise<Result> {
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
		return resolution === 'full' ? byte.withFullResolution(request, consume) : byte.withProxy(request, consume);
	}
	const profile = resolution === 'full' ? PHOTO_DEVELOP_LINEAR_LIMITS_V1 : PROXY;
	const plan = planPixelFrameV1(descriptor, profile.source);
	// Borrowed source + one Float32 working plane + one transient histogram/display
	// plane. The encoded histogram plane is gone before downstream presentation.
	if (plan.byteLength + plan.pixelCount * 20 > 512 * 1024 * 1024) throw new RangeError('Current deep render exceeds its 512 MiB working byte budget.');
	return withImageDevelopLinearCurrentV1(request, async frame => {
		const histogram = await withLinearPixelFrameDisplayV1({ frame, ...(signal ? { signal } : {}) },
			encoded => createPixelFrameHistogramV1(encoded, { ...(signal ? { signal } : {}) }), 'full');
		check(); const result = await consume(Object.freeze({ frame, histogram })); check(); return result;
	}, profile);
}
