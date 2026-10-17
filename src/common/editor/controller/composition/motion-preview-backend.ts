/* SPDX-License-Identifier: AGPL-3.0-only */

import type { MotionscaperProject } from '../../motion-project-types.ts';
import { MOTION_DEFAULT_WORKING_BYTES } from '../../motion-render-budget.ts';
import { createMotionPreviewRenderSession } from './motion-preview-render-session.ts';
import { createMotionPreviewWorkerBackend, MotionPreviewWorkerUnavailableError } from './motion-preview-worker-backend.ts';
import type { MotionPreviewAssetLoader, MotionPreviewBackend, MotionPreviewFootageDecoder, MotionPreviewOptions } from './motion-preview-types.ts';

/** Worker creation/transport failure switches to the same CanvasKit CPU renderer in the host. */
export function createMotionPreviewBackend(options: Pick<MotionPreviewOptions, 'maximumAssetBytes' | 'maximumWorkingBytes'>): MotionPreviewBackend {
	const limits = { maximumAssetBytes: options.maximumAssetBytes ?? 64 * 1024 * 1024, maximumWorkingBytes: options.maximumWorkingBytes ?? MOTION_DEFAULT_WORKING_BYTES };
	const host = () => createMotionPreviewRenderSession({ ...limits, backend: 'host-cpu' });
	let backend: MotionPreviewBackend;
	try {
		backend = typeof Worker === 'function' ? createMotionPreviewWorkerBackend(new Worker(new URL('../../motion-preview-worker.ts', import.meta.url), { type: 'module', name: 'motionscaper-composition-preview' }), limits) : host();
	} catch { backend = host(); }
	let retained: { project: MotionscaperProject; loadAsset: MotionPreviewAssetLoader; decodeFootage: MotionPreviewFootageDecoder | undefined } | null = null;
	return {
		async setProject(project, loadAsset, signal, decodeFootage) {
			retained = { project, loadAsset, decodeFootage };
			try { return await backend.setProject(project, loadAsset, signal, decodeFootage); }
			catch (error) { if (!(error instanceof MotionPreviewWorkerUnavailableError)) throw error; backend.dispose(); backend = host(); return backend.setProject(project, loadAsset, signal, decodeFootage); }
		},
		async render(request, signal) {
			try { return await backend.render(request, signal); }
			catch (error) {
				if (!(error instanceof MotionPreviewWorkerUnavailableError) || !retained) throw error;
				backend.dispose(); backend = host(); await backend.setProject(retained.project, retained.loadAsset, signal, retained.decodeFootage);
				return backend.render(request, signal);
			}
		},
		dispose() { backend.dispose(); retained = null; },
	};
}
