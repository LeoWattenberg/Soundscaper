/* SPDX-License-Identifier: AGPL-3.0-only */
import type {
	ProductVideoExportEncodedOutput,
	ProductVideoExportSinkOutput,
} from '../common/editor/controller/export/product-video-export-strategy.ts';
import type {
	VideoKeyframeVideoEncoderResult,
	VideoKeyframeVideoSinkEncoderResult,
} from '../common/editor/video-keyframe-video-encoder.ts';
import {
	projectVideoExportBrowserResult,
	projectVideoExportSinkResult,
	type VideoExportResultErrorText,
} from '../common/editor/video-export-strategy-encode-core.ts';
import type { FramescaperVideoVisualPlanFinishing } from './video-export-visual-plan-finishing.ts';

const PICTURE_ERRORS: VideoExportResultErrorText = Object.freeze({
	identity: 'The finishing picture encoder output does not match its exact plan.',
	bytes: 'The finishing picture-only output byte length is inconsistent.',
	chunks: 'The finishing picture-only output chunk count is invalid.',
});

export function framescaperPictureBrowserResultFinishing(
	encoded: VideoKeyframeVideoEncoderResult,
	plan: FramescaperVideoVisualPlanFinishing,
): ProductVideoExportEncodedOutput {
	return projectVideoExportBrowserResult(encoded, plan, PICTURE_ERRORS);
}

export function framescaperPictureSinkResultFinishing<Output>(
	encoded: VideoKeyframeVideoSinkEncoderResult<Output>,
	plan: FramescaperVideoVisualPlanFinishing,
): ProductVideoExportSinkOutput<Output> {
	return projectVideoExportSinkResult(encoded, plan, PICTURE_ERRORS);
}
