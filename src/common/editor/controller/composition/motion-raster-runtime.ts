/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionRasterRuntime } from '../../motion-canvaskit-browser.ts';
import type { MotionRasterResources, CanvasKitMotionRasterizer } from '../../motion-canvaskit-rasterizer.ts';
import { createCanvasKitMotionRasterizer } from '../../motion-canvaskit-rasterizer.ts';

/** A failed load may be retried; one cancelled consumer does not terminate another consumer's WASM. */
export function createMotionRasterRuntimeLoader(initialize: () => Promise<MotionRasterRuntime>): (signal?: AbortSignal) => Promise<MotionRasterRuntime> {
	let runtime: Promise<MotionRasterRuntime> | null = null;
	return async (signal) => {
		signal?.throwIfAborted();
		runtime ??= initialize().catch((error: unknown) => { runtime = null; throw error; });
		const loaded = await runtime;
		signal?.throwIfAborted();
		return loaded;
	};
}

export const loadMotionRasterRuntime = createMotionRasterRuntimeLoader(() => import('../../motion-canvaskit-browser.ts').then((module) => module.initializeMotionRasterRuntime()));

export async function createMotionBrowserRasterizer(resources: Omit<MotionRasterResources, 'fallbackFonts'>, signal?: AbortSignal): Promise<CanvasKitMotionRasterizer> {
	const loaded = await loadMotionRasterRuntime(signal);
	return createCanvasKitMotionRasterizer(loaded.kit, { ...resources, fallbackFonts: loaded.fallbackFonts });
}
