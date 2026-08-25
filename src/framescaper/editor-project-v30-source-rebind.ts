/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeFramescaperImageClipV1,
	normalizeFramescaperImageSourceV1,
} from '../common/editor/timeline-image-model-v30.ts';
import { rebindFramescaperSourceIdentitiesV27 } from './editor-project-v27-source-rebind.ts';

/** Follow one Scape source collision map through V27 state and exact V30 image authority. */
export function rebindFramescaperSourceIdentitiesV30(
	project: Record<string, unknown>,
	sourceIdMap: ReadonlyMap<string, string>,
): void {
	assertSourceIdMap(sourceIdMap);
	rebindFramescaperSourceIdentitiesV27(project, sourceIdMap);
	const sources = records(project.sources, 'V30 rebound sources').map((source) => {
		if (source.kind !== 'image') return source;
		const before = stableId(source.id, 'V30 image source ID');
		const after = sourceIdMap.get(before) ?? before;
		return normalizeFramescaperImageSourceV1({
			...source,
			id: after,
			storageKey: after,
		});
	});
	assertUniqueIds(sources, 'V30 rebound sources');
	project.sources = sources;
	project.clips = rebindImageClips(project.clips, sourceIdMap, 'V30 rebound clips');
	const bin = record(project.projectBin, 'V30 rebound Project Bin');
	bin.clips = rebindImageClips(bin.clips, sourceIdMap, 'V30 rebound Project Bin clips');
	const imageSourceIds = new Set(sources.filter(({ kind }) => kind === 'image').map(({ id }) => String(id)));
	for (const clip of [
		...records(project.clips, 'V30 rebound clips'),
		...records(bin.clips, 'V30 rebound Project Bin clips'),
	]) {
		if (clip.kind === 'image' && !imageSourceIds.has(String(clip.sourceId))) {
			throw new ReferenceError(`V30 rebound image clip ${String(clip.id)} lost its source.`);
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
		throw new TypeError('V30 source rebind requires an exact source identity map.');
	}
	const targets = new Set<string>();
	for (const [beforeValue, afterValue] of value) {
		stableId(beforeValue, 'V30 source rebind origin');
		const after = stableId(afterValue, 'V30 source rebind target');
		if (targets.has(after)) throw new RangeError(`V30 source rebind target ${after} is duplicated.`);
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
