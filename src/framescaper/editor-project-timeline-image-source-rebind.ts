/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
} from '../common/editor/timeline-image-model.ts';
import { rebindFramescaperSourceIdentitiesFinishing } from './editor-project-finishing-source-rebind.ts';

/** Follow one Scape source collision map through finishing state and exact timelineImage image authority. */
export function rebindFramescaperSourceIdentitiesTimelineImage(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	assertSourceIdMap(sourceIdMap);
	rebindFramescaperSourceIdentitiesFinishing(project, sourceIdMap);
	const sources = records(project.sources, 'timelineImage rebound sources').map((source) => {
		if (source.kind !== 'image') return source;
		const before = stableId(source.id, 'timelineImage image source ID');
		const after = sourceIdMap.get(before) ?? before;
		return normalizeFramescaperImageSourceV1({
			...source,
			id: after,
			storageKey: after,
		}) as unknown as Record<string, unknown>;
	});
	assertUniqueIds(sources, 'timelineImage rebound sources');
	project.sources = sources;
	project.clips = rebindImageClips(project.clips, sourceIdMap, 'timelineImage rebound clips');
	const bin = record(project.projectBin, 'timelineImage rebound Project Bin');
	bin.clips = rebindImageClips(bin.clips, sourceIdMap, 'timelineImage rebound Project Bin clips');
	const imageSourceIds = new Set(sources.filter(({ kind }) => kind === 'image').map(({ id }) => String(id)));
	for (const clip of [
		...records(project.clips, 'timelineImage rebound clips'),
		...records(bin.clips, 'timelineImage rebound Project Bin clips'),
	]) {
		if (clip.kind === 'image' && !imageSourceIds.has(String(clip.sourceId))) {
			throw new ReferenceError(`timelineImage rebound image clip ${String(clip.id)} lost its source.`);
		}
	}
}

function rebindImageClips(
	value: unknown,
	sourceIdMap: ReadonlyMap<string, string>,
	name: string,
): Record<string, unknown>[] {
	const clips = records(value, name).map((clip) => {
		if (clip.kind !== 'image') return clip;
		const sourceId = stableId(clip.sourceId, `${name} source ID`);
		return normalizeFramescaperImageClipV1({
			...clip,
			sourceId: sourceIdMap.get(sourceId) ?? sourceId,
		}) as unknown as Record<string, unknown>;
	});
	assertUniqueIds(clips, name);
	return clips;
}

function assertSourceIdMap(value: ReadonlyMap<string, string>): void {
	if (!value || typeof value !== 'object' || typeof value.get !== 'function'
		|| typeof value[Symbol.iterator] !== 'function') {
		throw new TypeError('timelineImage source rebind requires an exact source identity map.');
	}
	const targets = new Set<string>();
	for (const [beforeValue, afterValue] of value) {
		stableId(beforeValue, 'timelineImage source rebind origin');
		const after = stableId(afterValue, 'timelineImage source rebind target');
		if (targets.has(after)) throw new RangeError(`timelineImage source rebind target ${after} is duplicated.`);
		targets.add(after);
	}
}

function assertUniqueIds(values: readonly Record<string, unknown>[], name: string): void {
	const ids = values.map(({ id }) => stableId(id, `${name} ID`));
	if (new Set(ids).size !== ids.length) throw new RangeError(`${name} must retain unique identities.`);
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
		throw new TypeError(`${name} must be a stable ID.`);
	}
	return value;
}

function record(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} must be a record.`);
	return value as Record<string, unknown>;
}

function records(value: unknown, name: string): Record<string, unknown>[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be an array.`);
	return value.map((item, index) => record(item, `${name}[${String(index)}]`));
}
