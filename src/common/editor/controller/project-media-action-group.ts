/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * The project-media action group: operations that move the bytes a project
 * refers to, rather than the bytes it delivers.
 *
 * Consolidate belongs here rather than beside the exporters because it changes
 * where the project's own media lives. It shares one thing with them, though,
 * and deliberately: its report is published as the current delivery report, so
 * the single menu entry that shows "what an operation could not carry" shows
 * this too. A consolidate that left a source behind has exactly the kind of
 * omission that surface exists for.
 *
 * The project is read as the document, not through the render projection the
 * exporters use. Which bytes a project needs has nothing to do with what is
 * audible or visible: hiding a track must never be a way to leave its media
 * behind, which is the same rule trim-media follows and the opposite of the one
 * the interchange profiles follow.
 */

import {
	consolidateProjectMedia,
	planProjectConsolidation,
	type ConsolidateMediaStore,
	type ConsolidatePlan,
	type ConsolidateRunResult,
} from './consolidate-media-service.ts';
import { saveCurrentScapeArchiveManifest } from './scape-archive-manifest-action.ts';
import {
	planProjectTrim,
	trimProjectMedia,
	type TrimMediaFfmpegHost,
	type TrimMediaPlan,
	type TrimMediaProjectResult,
	type TrimMediaStore,
} from './trim-media-service.ts';

export interface ProjectMediaActionRuntime {
	readonly state: Record<string, unknown>;
	readonly getProject: () => Readonly<Record<string, unknown>> | null | undefined;
	readonly store: ConsolidateMediaStore | null | undefined;
	readonly publishDocumentSnapshot?: () => void;
	readonly setStatus?: (message: string, tone?: string) => void;
	readonly copy?: Readonly<Record<string, string>>;
	readonly fileService?: { saveFile?: (request: never) => unknown } | null;
	readonly ffmpeg?: Partial<TrimMediaFfmpegHost> | null;
	/** Applies a command batch through the project's own history. */
	readonly commit?: (command: unknown) => unknown;
}

export interface ConsolidateActionResult {
	readonly plan: ConsolidatePlan;
	readonly run: ConsolidateRunResult;
}

export function createProjectMediaActionGroup(runtime: ProjectMediaActionRuntime) {
	return Object.freeze({
		/** What consolidating would copy, without copying anything. */
		planConsolidate: async (): Promise<ConsolidatePlan | null> => {
			const request = consolidateRequest(runtime);
			return request ? planProjectConsolidation(request) : null;
		},
		consolidate: async (
			options: Readonly<{ signal?: AbortSignal }> = {},
		): Promise<ConsolidateActionResult | null> => {
			const request = consolidateRequest(runtime, options.signal);
			if (!request) return null;
			const copy = runtime.copy ?? {};
			runtime.setStatus?.(copy.consolidatingMedia ?? 'Consolidating media');
			const result = await consolidateProjectMedia(request);
			// Published before the status settles, so a run that left something
			// behind is readable the moment the message says it finished.
			runtime.state.deliveryReport = result.run.report;
			runtime.publishDocumentSnapshot?.();
			runtime.setStatus?.(
				result.run.complete
					? copy.consolidatedMedia ?? 'Media consolidated.'
					: copy.consolidatedMediaIncomplete ?? 'Some media could not be consolidated.',
				result.run.complete ? 'success' : 'warning',
			);
			return Object.freeze(result);
		},
		/** What trimming would discard, without cutting anything. */
		planTrim: (): TrimMediaPlan | null => {
			const request = trimRequest(runtime);
			return request ? planProjectTrim(request) : null;
		},
		/**
		 * Cut every trimmable source down to what the project still references,
		 * and move the project onto the result in one undoable batch.
		 *
		 * The batch is committed rather than applied directly, because a trim
		 * that rewrote the media and left the document alone would silently
		 * change what the project plays — and one that could not be undone would
		 * leave a user with no way back to the edit they had.
		 */
		trim: async (
			options: Readonly<{ signal?: AbortSignal }> = {},
		): Promise<TrimMediaProjectResult | null> => {
			const request = trimRequest(runtime, options.signal);
			if (!request) return null;
			const copy = runtime.copy ?? {};
			runtime.setStatus?.(copy.trimmingMedia ?? 'Trimming media');
			const result = await trimProjectMedia(request);
			// The batch was computed against the document as it was when the cut
			// began, and a cut runs for as long as the media takes. Committing it to
			// whatever the document has become since would repoint clips whose
			// in-points moved at material they never referenced, and the rewrite
			// itself only checks that the same clip ids are still there.
			request.assertCurrent();
			if (result.edit.command) runtime.commit?.(result.edit.command);
			// One report covering both halves: a source can be impossible to cut,
			// or cut perfectly and then impossible to bind to, and a surface shown
			// only one of those would call a half-finished trim complete.
			runtime.state.deliveryReport = result.report;
			runtime.publishDocumentSnapshot?.();
			const complete = result.complete;
			runtime.setStatus?.(
				complete
					? copy.trimmedMedia ?? 'Media trimmed.'
					: copy.trimmedMediaIncomplete ?? 'Some media could not be trimmed.',
				complete ? 'success' : 'warning',
			);
			return result;
		},
		/**
		 * Save the checksum manifest of the archive this session last wrote.
		 *
		 * It answers with a reason rather than nothing when there is none, because
		 * a streamed save leaves no bytes to have measured and that is a different
		 * answer from an archive that checked out.
		 */
		saveArchiveManifest: async (): Promise<Readonly<{ saved: boolean; reason: string | null }>> => {
			const result = await saveCurrentScapeArchiveManifest({
				state: runtime.state,
				...(runtime.fileService ? { fileService: runtime.fileService } : {}),
				...(runtime.publishDocumentSnapshot
					? { publishDocumentSnapshot: runtime.publishDocumentSnapshot }
					: {}),
			});
			if (result.saved) {
				runtime.setStatus?.(
					runtime.copy?.archiveManifestSaved ?? 'Archive checksums saved',
					'success',
				);
			} else if (result.reason) {
				runtime.setStatus?.(result.reason, 'warning');
			}
			return result;
		},
	});
}

function trimRequest(runtime: ProjectMediaActionRuntime, signal?: AbortSignal) {
	const project = runtime.getProject?.();
	const ffmpeg = runtime.ffmpeg;
	if (!project || !runtime.store || typeof ffmpeg?.runTrimMediaOperation !== 'function') return null;
	return {
		project,
		store: runtime.store as unknown as TrimMediaStore,
		ffmpeg: ffmpeg as TrimMediaFfmpegHost,
		assertCurrent: projectFence(runtime, project),
		...(signal ? { signal } : {}),
	};
}

/**
 * Refuse to keep working against a document that has moved on.
 *
 * A media operation is planned, cut, and remapped against one snapshot, and the
 * editor stays writable throughout — there is no edit block for it. The document
 * states its own identity and revision, so this is the whole test: the operation
 * asks it at every awaited boundary, and the action asks it once more before it
 * commits what the cut proved.
 */
function projectFence(
	runtime: ProjectMediaActionRuntime,
	project: Readonly<Record<string, unknown>>,
): () => void {
	const id = String(project.id ?? '');
	const revision = Number(project.revision ?? 0);
	return () => {
		const current = runtime.getProject?.();
		if (String(current?.id ?? '') === id && Number(current?.revision ?? 0) === revision) return;
		throw new Error('The project changed while its media was being trimmed.');
	};
}

function consolidateRequest(runtime: ProjectMediaActionRuntime, signal?: AbortSignal) {
	const project = runtime.getProject?.();
	const projectId = String((project as Record<string, unknown> | null)?.id ?? '');
	if (!project || !projectId || !runtime.store) return null;
	return {
		projectId,
		project,
		store: runtime.store,
		...(signal ? { signal } : {}),
	};
}
