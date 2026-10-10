/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FileSizeWarningConfirmation } from '../../../shared/file-size-warning.ts';
import type { ProductVideoExportPlan } from '../../product-video-export-strategy.ts';
import type { acquireVideoExportTimingIndexes } from '../../video-export-timing.ts';
import type { VideoExportServiceRuntime } from './video-export-service.ts';

type RuntimeValue = VideoExportServiceRuntime[string];

export function productEncodeRequest(
	canonicalProject: RuntimeValue,
	exportProject: RuntimeValue,
	plan: ProductVideoExportPlan,
	timingIndexes: Awaited<ReturnType<typeof acquireVideoExportTimingIndexes>> | null,
	videoBlobs: ReadonlyMap<string, Blob>,
	audioMix: Blob | null,
	editorFfmpeg: RuntimeValue,
	signal: AbortSignal,
	assertCurrent: () => void,
	maximumOutputBytes: unknown,
	confirmFileSizeWarning: FileSizeWarningConfirmation | undefined,
	webCodecs: Readonly<{ codec: string; bitrate: number }> | null,
) {
	if (!timingIndexes) throw new Error('Keyed video export lost its exact timing lease.');
	return Object.freeze({
		canonicalProject,
		exportProject,
		plan,
		timingBySourceId: timingIndexes.timingBySourceId,
		timingViewsBySourceId: timingIndexes.timingViewsBySourceId,
		videoBlobs,
		audioMix,
		editorFfmpeg,
		webCodecs,
		signal,
		assertCurrent,
		maximumOutputBytes, confirmFileSizeWarning,
	});
}
