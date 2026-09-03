/* SPDX-License-Identifier: AGPL-3.0-only */

import { type EdlExportResult } from '../edl-export.ts';
import { createProjectEdlExport } from '../edl-project-adapter.ts';
import { type OtioExportResult, createOtioExport } from '../otio-export.ts';
import { type FcpxmlExportResult, createFcpxmlExport } from '../fcpxml-export.ts';
import { projectForRuntimeConsumers } from '../project-current-runtime.ts';
import { resolveSequenceTimingView } from '../sequence-timing-model.ts';
import {
	inheritTrackFolderMediaStateProjectionV12,
	projectTrackFolderMediaStateV12,
} from '../track-folder-media-runtime.ts';

/**
 * Export the current project through an interchange profile.
 *
 * Every profile in the 6C-1 family saves through the one `interchange` purpose
 * and publishes its report into session state alongside the delivery reports
 * the encode paths produce, so the single File menu entry that shows "what the
 * delivery could not carry" shows these too. An interchange export drops more
 * than an encode does — whole tracks, every transition, every time effect — so
 * routing it anywhere else would mean the omissions that matter most are the
 * ones with no surface.
 */

interface InterchangeRuntime {
	readonly getProject: () => Readonly<Record<string, unknown>> | null | undefined;
	readonly state: Record<string, unknown>;
	readonly fileService?: { saveFile?: (request: Readonly<Record<string, unknown>>) => unknown } | null;
	readonly publishDocumentSnapshot?: () => void;
	readonly sequenceId?: string;
}

export async function exportProjectEdl(runtime: InterchangeRuntime & {
	readonly trackId?: string;
	readonly reelNames?: Readonly<Record<string, string>>;
}): Promise<EdlExportResult | null> {
	const project = resolveDeliveredProject(runtime);
	if (!project) return null;
	return deliver(runtime, createProjectEdlExport({
		project,
		sequenceId: runtime.sequenceId,
		trackId: runtime.trackId,
		reelNames: runtime.reelNames,
	}));
}

export async function exportProjectOtio(
	runtime: InterchangeRuntime,
): Promise<OtioExportResult | null> {
	const project = resolveDeliveredProject(runtime);
	if (!project) return null;
	// The sequence is the rate authority; OTIO must never infer one from media.
	const sequence = resolveSequenceTimingView(project, runtime.sequenceId);
	return deliver(runtime, createOtioExport({
		project,
		sequenceId: sequence.id,
		sequenceRate: sequence.rate,
		dropFrame: sequence.dropFrame,
		startFrameCount: sequence.startFrameCount,
	}));
}

export async function exportProjectFcpxml(
	runtime: InterchangeRuntime,
): Promise<FcpxmlExportResult | null> {
	const project = resolveDeliveredProject(runtime);
	if (!project) return null;
	const sequence = resolveSequenceTimingView(project, runtime.sequenceId);
	return deliver(runtime, createFcpxmlExport({
		project,
		sequenceId: sequence.id,
		sequenceRate: sequence.rate,
		dropFrame: sequence.dropFrame,
		startFrameCount: sequence.startFrameCount,
	}));
}

/**
 * The project as the render sees it.
 *
 * Every render path — playback, audio export, video export — puts the document
 * through two projections. The folder one carries inherited hidden and mute down
 * to the tracks that inherit them; the runtime one resolves authoritative timing
 * into the transient coordinates a consumer reads. An interchange file describes
 * that same render, so it is built from the same pair: skipping the first puts a
 * track inside a hidden folder in the edit list and not in the picture, and
 * skipping the second reads timing fields a current document does not carry at
 * all — a persisted video clip states sequence frames, and a musical audio clip
 * states beats, so all three profiles refused every real document outright.
 */
export function resolveDeliveredProject(
	runtime: InterchangeRuntime,
): Readonly<Record<string, unknown>> | null {
	const persistedProject = runtime?.getProject?.();
	if (!persistedProject) return null;
	const mediaProject = projectTrackFolderMediaStateV12(persistedProject);
	const project = projectForRuntimeConsumers(mediaProject as never);
	return project === mediaProject
		? project
		: inheritTrackFolderMediaStateProjectionV12(mediaProject, project);
}

async function deliver<T extends {
	text: string; fileName: string; mimeType: string; report: unknown;
}>(runtime: InterchangeRuntime, result: T): Promise<T> {
	// Publish the report before the save dialog, so a cancelled save still
	// leaves the user able to read what the export would have left behind.
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
