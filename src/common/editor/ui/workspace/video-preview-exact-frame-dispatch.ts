/* SPDX-License-Identifier: AGPL-3.0-only */

import type { createExactPreviewRenderCoordinator } from '../../controller/clip-video/exact-preview-render-coordinator.ts';
import type { ProductVideoVisualPreviewSession } from './product-video-visual-preview-runtime.ts';

type ExactRender = NonNullable<ProductVideoVisualPreviewSession['renderExact']>;
type Request = Parameters<ExactRender>[0];
type Result = Awaited<ReturnType<ExactRender>>;

/** The continuous coordinator's private cancellation accompanies the actual
 * current Session render; the captured method keeps its original receiver. */
export async function dispatchExactProductVideoPreview(options: Readonly<{
	readonly coordinator: ReturnType<typeof createExactPreviewRenderCoordinator>;
	readonly session: ProductVideoVisualPreviewSession;
	readonly timelineSample: Request['timelineSample'];
	readonly mediaLayers: Request['mediaLayers'];
	readonly isCurrent: () => boolean;
	readonly publish: (result: Result) => void;
	readonly onError: (error: unknown) => void;
}>): Promise<void> {
	const session = options.session, render = session.renderExact;
	if (typeof render !== 'function') throw new TypeError('The current product has no exact picture renderer.');
	const request = { timelineSample: options.timelineSample, mediaLayers: options.mediaLayers };
	const isCurrent = options.isCurrent, publish = options.publish, onError = options.onError;
	await options.coordinator.run({
		render: signal => Reflect.apply(render, session, [{ ...request, signal }]) as ReturnType<ExactRender>,
		isCurrent: () => isCurrent(), publish: result => { publish(result); }, onError: error => { onError(error); },
	});
}
