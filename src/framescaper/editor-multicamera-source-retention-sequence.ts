/* SPDX-License-Identifier: AGPL-3.0-only */

import type { FramescaperProjectSequence } from './editor-project-sequence-validation.ts';

/** The inherited clip/bin command cannot release an angle still owned by a native group. */
export function retainFramescaperMulticameraSourcesSequence(
	project: FramescaperProjectSequence,
	draft: Record<string, unknown>,
): void {
	const sources = draft.sources as Record<string, unknown>[];
	const presentIds = new Set(sources.map(source => source.id));
	const priorSourceById = new Map(project.sources.map(source => [source.id, source]));
	for (const group of project.multicameraGroups) {
		for (const member of group.members) {
			if (presentIds.has(member.sourceId)) continue;
			const source = priorSourceById.get(member.sourceId);
			if (!source) throw new ReferenceError(`The retained camera source ${member.sourceId} is missing.`);
			sources.push(structuredClone(source));
			presentIds.add(member.sourceId);
		}
	}
}
