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

export interface ProjectMediaActionRuntime {
	readonly state: Record<string, unknown>;
	readonly getProject: () => Readonly<Record<string, unknown>> | null | undefined;
	readonly store: ConsolidateMediaStore | null | undefined;
	readonly publishDocumentSnapshot?: () => void;
	readonly setStatus?: (message: string, tone?: string) => void;
	readonly copy?: Readonly<Record<string, string>>;
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
			runtime.setStatus?.(copy.consolidatingMedia ?? 'Consolidating media…');
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
	});
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
