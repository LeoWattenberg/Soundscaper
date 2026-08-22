/* SPDX-License-Identifier: AGPL-3.0-only */

import { rebindFramescaperMulticameraSourceIdentitiesV18 } from './editor-multicamera-source-rebind-v18.ts';

/** Follow Scape source collision remaps through every V24-owned source reference. */
export function rebindFramescaperVisualSourceIdentitiesV24(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	rebindFramescaperMulticameraSourceIdentitiesV18(project, sourceIdMap);
	if (![...sourceIdMap].some(([before, after]) => before !== after)) return;
	if (Array.isArray(project.videoMaskMattes)) {
		for (const graph of project.videoMaskMattes as Record<string, unknown>[]) {
			if (!Array.isArray(graph.inputs)) continue;
			graph.inputs = (graph.inputs as Record<string, unknown>[]).map((input) => ({
				...input,
				sourceRef: sourceIdMap.get(String(input.sourceRef)) ?? input.sourceRef,
			}));
		}
	}
	if (Array.isArray(project.videoFreezeFallbacks)) {
		project.videoFreezeFallbacks = (project.videoFreezeFallbacks as Record<string, unknown>[])
			.map((fallback) => ({
				...fallback,
				renderedSourceId: sourceIdMap.get(String(fallback.renderedSourceId))
					?? fallback.renderedSourceId,
			}));
	}
	if (Array.isArray(project.sources)) {
		for (const source of project.sources as Record<string, unknown>[]) {
			const generator = source.generator as Record<string, unknown> | undefined;
			if (source.kind !== 'generator' || generator?.kind !== 'external-generator'
				|| !Array.isArray(generator.inputs)) continue;
			generator.inputs = (generator.inputs as Record<string, unknown>[]).map((input) => ({
				...input,
				sourceRef: sourceIdMap.get(String(input.sourceRef)) ?? input.sourceRef,
			}));
		}
	}
}
