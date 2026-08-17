/* SPDX-License-Identifier: AGPL-3.0-only */

import { type EdlExportResult } from '../edl-export.ts';
import { createProjectEdlExport } from '../edl-project-adapter.ts';

/**
 * Export the current project as an EDL.
 *
 * The report goes into session state alongside the delivery reports the encode
 * paths produce, so the one File menu entry that shows "what the delivery could
 * not carry" shows this too. An interchange export drops more than an encode
 * does — whole tracks, every transition — so routing it anywhere else would
 * mean the omissions that matter most are the ones with no surface.
 */
export async function exportProjectEdl(runtime: {
	readonly getProject: () => Readonly<Record<string, unknown>> | null | undefined;
	readonly state: Record<string, unknown>;
	readonly fileService?: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null;
	readonly publishDocumentSnapshot?: () => void;
	readonly sequenceId?: string;
	readonly trackId?: string;
	readonly reelNames?: Readonly<Record<string, string>>;
}): Promise<EdlExportResult | null> {
	const project = runtime?.getProject?.();
	if (!project) return null;
	const result = createProjectEdlExport({
		project,
		sequenceId: runtime.sequenceId,
		trackId: runtime.trackId,
		reelNames: runtime.reelNames,
	});

	// Publish the report before the save dialog, so a cancelled save still
	// leaves the user able to read what the list would have left behind.
	runtime.state.deliveryReport = result.report;
	runtime.publishDocumentSnapshot?.();

	if (runtime.fileService?.saveFile) {
		await runtime.fileService.saveFile({
			purpose: 'interchange',
			suggestedName: result.fileName,
			mimeType: result.mimeType,
			blob: new Blob([result.text], { type: result.mimeType }),
		});
	}
	return result;
}
