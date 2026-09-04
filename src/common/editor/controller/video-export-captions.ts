/* SPDX-License-Identifier: AGPL-3.0-only */

import { serializeAudioEditorLabels } from '../label-io.js';
import { resolveVideoCaptionCues } from '../video-caption-cues.ts';
import { saveLabelExport } from './app-helpers.ts';

/** The runtime a caption delivery reads. */
export interface VideoExportCaptionRuntime {
	// Legacy JavaScript ports are narrowed as their owning services migrate.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	readonly [name: string]: any;
}

type RuntimeValue = VideoExportCaptionRuntime[string];

/**
 * Write the caption sidecar a plan asks for, after its video has been published.
 *
 * The order matters: a delivery that failed to publish its video must not leave
 * a caption file next to nothing. This reuses the label exporter's own writer,
 * so a caption sidecar and a label export land through the same path and the
 * same browser fallback.
 */
export async function deliverCaptionSidecar(
	plan: RuntimeValue,
	exportProject: RuntimeValue,
	sampleRate: number,
	videoFileName: string,
	fileService: RuntimeValue,
): Promise<void> {
	const format = plan.captions?.sidecarFormat;
	if (!format) return;
	const cues = resolveVideoCaptionCues(exportProject, {
		trackId: plan.captions.trackId,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
	});
	const text = String(serializeAudioEditorLabels(cues, { format, sampleRate }));
	await saveLabelExport({
		format,
		fileName: `${videoFileName.replace(/\.[^.]+$/u, '')}.${format}`,
		mimeType: format === 'vtt' ? 'text/vtt' : 'application/x-subrip',
		text,
		labelCount: cues.length,
		trackIds: Object.freeze([String(plan.captions.trackId)]),
	} as never, null, fileService as never);
}

/**
 * The cue document a plan asks to mux, or null for the deliveries that mux none.
 *
 * SubRip is what the plan stages regardless of any sidecar the caller chose,
 * because both subtitle encoders read it losslessly for plain cues and one
 * staged form keeps the muxed track independent of the sidecar decision.
 */
export function stagedCaptionDocument(
	plan: RuntimeValue,
	exportProject: RuntimeValue,
	sampleRate: number,
): Blob | null {
	if (!plan.captions?.mux) return null;
	const cues = resolveVideoCaptionCues(exportProject, {
		trackId: plan.captions.trackId,
		startFrame: plan.range.startFrame,
		endFrame: plan.range.endFrame,
	});
	const text = serializeAudioEditorLabels(cues, { format: 'srt', sampleRate });
	return new Blob([text], { type: 'application/x-subrip' });
}
