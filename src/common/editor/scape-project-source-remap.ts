/* SPDX-License-Identifier: AGPL-3.0-only */

import { remapTakeGroupSourceIds } from './take-group-source-references.ts';

/** Remap every source identity owned by a copied Scape project. */
export function remapScapeProjectSourceReferences(
	project: unknown,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	if (!isRecord(project)) return;
	const projectBin = isRecord(project.projectBin) ? project.projectBin : null;
	for (const clip of [...records(project.clips), ...records(projectBin?.clips)]) {
		remapSourceId(clip, sourceIdMap);
	}
	for (const track of records(project.tracks)) {
		if (isRecord(track.audioFreeze)) remapSourceId(track.audioFreeze, sourceIdMap, 'derivedSourceId');
	}
	const metadata = isRecord(project.metadata) ? project.metadata : null;
	const adm = isRecord(metadata?.adm) ? metadata.adm : null;
	if (adm?.mode === 'passthrough' && isRecord(adm.source)) {
		const sourceReference = adm.source;
		remapSourceId(sourceReference, sourceIdMap, 'id');
		const source = records(project.sources).find(candidate => candidate.id === sourceReference.id);
		if (source) sourceReference.storageKey = source.storageKey;
	}
	remapTakeGroupSourceIds(project, sourceIdMap);
}

function remapSourceId(
	record: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
	key = 'sourceId',
): void {
	const sourceId = record[key];
	if (typeof sourceId !== 'string') return;
	const replacement = sourceIdMap.get(sourceId);
	if (replacement !== undefined) record[key] = replacement;
}

function records(value: unknown): Record<string, unknown>[] {
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
