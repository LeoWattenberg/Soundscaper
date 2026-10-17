/* SPDX-License-Identifier: AGPL-3.0-only */
import { readClosedDomainField as field, readClosedDomainRecord as record } from './closed-domain-value.ts';
import type { PhotoLibraryDevelopFrameRequestCurrentV1, PhotoLibraryDevelopProxyRuntimeCurrentV1 } from './photo-library-develop-proxy-port-current-v1.ts';
import type { PhotoLibraryDevelopProxyViewV3 } from './photo-library-develop-proxy-port-v3.ts';

export type PhotoDevelopPreviewRendererCurrentV1 = 'cpu' | 'gpu-preferred';
export interface PhotoDevelopPreviewExecutionCurrentV1 { readonly backend: 'webgl2' | 'cpu'; readonly reason?: string }
export interface PhotoLibraryDevelopGpuPreviewViewCurrentV1 extends PhotoLibraryDevelopProxyViewV3 {
	readonly execution: Readonly<PhotoDevelopPreviewExecutionCurrentV1>;
}
/** Preview-only capability. The existing CPU/export entry points stay exact. */
export interface PhotoLibraryDevelopGpuPreviewRuntimeCurrentV1 extends PhotoLibraryDevelopProxyRuntimeCurrentV1 {
	withGpuPreview<Result>(resolution: 'proxy' | 'full', request: Readonly<PhotoLibraryDevelopFrameRequestCurrentV1>,
		consume: (view: Readonly<PhotoLibraryDevelopGpuPreviewViewCurrentV1>) => Result | Promise<Result>): Promise<Result>;
}
export function preparePhotoDevelopPreviewRendererCurrentV1(value: unknown): PhotoDevelopPreviewRendererCurrentV1 {
	if (value !== 'cpu' && value !== 'gpu-preferred') throw new RangeError('Unknown Current preview renderer.');
	return value;
}
export function preparePhotoDevelopPreviewExecutionCurrentV1(value: unknown): Readonly<PhotoDevelopPreviewExecutionCurrentV1> {
	const input = record(value, 'Current preview execution', ['backend', 'reason'], ['backend']);
	const backend = field(input, 'backend', 'Current preview execution');
	if (backend !== 'webgl2' && backend !== 'cpu') throw new RangeError('Unknown Current preview execution backend.');
	const reason = Object.hasOwn(input, 'reason') ? field(input, 'reason', 'Current preview execution') : undefined;
	if (reason !== undefined && (typeof reason !== 'string' || reason.length === 0 || reason.length > 256)) throw new TypeError('Preview fallback requires a bounded reason.');
	return Object.freeze({ backend, ...(reason === undefined ? {} : { reason }) });
}
