/* SPDX-License-Identifier: AGPL-3.0-only */

interface TakeSourceReference extends Readonly<Record<string, unknown>> {
	readonly sourceId?: unknown;
}

interface TakeGroupSourceReference extends Readonly<Record<string, unknown>> {
	readonly takes?: readonly TakeSourceReference[];
}

export interface TakeGroupSourceReferenceProject extends Readonly<Record<string, unknown>> {
	readonly takeGroups?: readonly TakeGroupSourceReference[];
}

/** Collect source identities owned by take groups without depending on a project schema module. */
export function collectTakeGroupSourceIds(
	project: unknown,
	target: Set<string> = new Set<string>(),
): Set<string> {
	for (const take of takeSourceReferences(project)) {
		if (typeof take.sourceId === 'string' && take.sourceId) target.add(take.sourceId);
	}
	return target;
}

/** Apply a Scape copy-import source collision map to take-owned source references. */
export function remapTakeGroupSourceIds(
	project: unknown,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	for (const take of takeSourceReferences(project)) {
		if (typeof take.sourceId !== 'string') continue;
		const nextSourceId = sourceIdMap.get(take.sourceId);
		if (nextSourceId !== undefined) take.sourceId = nextSourceId;
	}
}

function takeSourceReferences(project: unknown): Record<string, unknown>[] {
	if (!isRecord(project) || !Array.isArray(project.takeGroups)) return [];
	const references: Record<string, unknown>[] = [];
	for (const group of project.takeGroups) {
		if (!isRecord(group) || !Array.isArray(group.takes)) continue;
		for (const take of group.takes) {
			if (isRecord(take)) references.push(take);
		}
	}
	return references;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
