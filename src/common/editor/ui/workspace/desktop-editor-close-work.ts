/* SPDX-License-Identifier: AGPL-3.0-only */

const UNSEALED_CAPTURE_PHASES = new Set([
	'armed', 'countdown', 'recording', 'paused', 'finalizing',
]);
const UNSEALED_WEB_VCR_PHASES = new Set([
	'opening', 'preparing', 'recording', 'finalizing',
]);

export function editorCloseHasActiveWork(current: Readonly<Record<string, unknown>>): boolean {
	const capture = current.capture as Readonly<{ phase?: unknown }> | null | undefined;
	const webVcr = current.webVcr as Readonly<{ phase?: unknown; modeActive?: unknown }> | null | undefined;
	return Boolean(current.importing
		|| (current.save as Readonly<{ state?: unknown }> | undefined)?.state === 'saving'
		|| current.recording
		|| current.recordingStarting
		|| current.recordingScheduling
		|| current.scheduledRecording
		|| current.exporting
		|| current.processingEffect
		|| current.analysisProcessing
		|| (current.sampleEdit as Readonly<{ processing?: unknown }> | undefined)?.processing
		|| (typeof capture?.phase === 'string' && UNSEALED_CAPTURE_PHASES.has(capture.phase))
		|| (webVcr?.modeActive === true && typeof webVcr.phase === 'string'
			&& UNSEALED_WEB_VCR_PHASES.has(webVcr.phase)));
}

export async function sealEditorCaptureForClose(controller: Readonly<{
	readonly actions: Readonly<{
		readonly capture?: Readonly<{ sealForShutdown?: () => PromiseLike<unknown> | unknown }>;
	}>;
}>): Promise<void> {
	await controller.actions.capture?.sealForShutdown?.();
}
