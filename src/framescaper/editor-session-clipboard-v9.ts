/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainField, readClosedDomainRecord } from '../common/editor/closed-domain-value.ts';
import { assertFramescaperProjectProfessionalMediaCandidateProfile } from './editor-domain-runtime-profile.ts';
import {
	normalizeFramescaperProfessionalVideoSourceProfessionalMedia,
	validateFramescaperProjectProfessionalMedia,
	type FramescaperProfessionalVideoSourceProfessionalMedia,
	type FramescaperProjectProfessionalMedia,
} from './editor-project-professional-media.ts';

export interface FramescaperProfessionalMediaClipboardV9 {
	readonly schemaVersion: 9;
	readonly kind: 'framescaper-professional-media-fragment';
	readonly originProjectId: string;
	readonly originRevision: number;
	readonly sources: readonly FramescaperProfessionalVideoSourceProfessionalMedia[];
}

export interface FramescaperProfessionalMediaClipboardPasteV9 {
	readonly sources: readonly FramescaperProfessionalVideoSourceProfessionalMedia[];
}

const FIELDS = Object.freeze([
	'schemaVersion', 'kind', 'originProjectId', 'originRevision', 'sources',
]);
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function createFramescaperProfessionalMediaClipboardV9(
	profile: unknown,
	project: unknown,
	sourceIdsValue: readonly string[],
): FramescaperProfessionalMediaClipboardV9 {
	assertFramescaperProjectProfessionalMediaCandidateProfile(profile);
	validateFramescaperProjectProfessionalMedia(profile, project);
	if (!Array.isArray(sourceIdsValue) || sourceIdsValue.length < 1) {
		throw new RangeError('A professional-media clipboard selection cannot be empty.');
	}
	const sourceIds = sourceIdsValue.map((value) => stableId(value, 'clipboard source ID'));
	if (new Set(sourceIds).size !== sourceIds.length) throw new RangeError('Clipboard source IDs must be unique.');
	const selected = new Set(sourceIds);
	const candidate = project as FramescaperProjectProfessionalMedia;
	const sources = candidate.sources.filter((source) => selected.has(String(source.id)));
	if (sources.length !== selected.size || sources.some(({ kind }) => kind !== 'video')) {
		throw new ReferenceError('The professional-media clipboard selection names a missing video source.');
	}
	return normalizeFramescaperProfessionalMediaClipboardV9({
		schemaVersion: 9,
		kind: 'framescaper-professional-media-fragment',
		originProjectId: candidate.id,
		originRevision: candidate.revision,
		sources,
	});
}

export function normalizeFramescaperProfessionalMediaClipboardV9(
	value: unknown,
): FramescaperProfessionalMediaClipboardV9 {
	const input = readClosedDomainRecord(value, 'Framescaper professional-media clipboard V9', FIELDS);
	if (field(input, 'schemaVersion') !== 9) throw new RangeError('Framescaper professional media requires V9 re-copy.');
	if (field(input, 'kind') !== 'framescaper-professional-media-fragment') {
		throw new RangeError('Framescaper professional-media clipboard kind is unsupported.');
	}
	const sources = readClosedDomainArray(
		field(input, 'sources'), 'V9 clipboard sources', 1, 100_000,
	).map(normalizeFramescaperProfessionalVideoSourceProfessionalMedia);
	const ids = new Set<string>();
	for (const source of sources) {
		if (ids.has(source.id)) throw new RangeError(`Duplicate V9 clipboard source ID ${source.id}.`);
		ids.add(source.id);
	}
	return deepFreeze({
		schemaVersion: 9 as const,
		kind: 'framescaper-professional-media-fragment' as const,
		originProjectId: stableId(field(input, 'originProjectId'), 'originProjectId'),
		originRevision: nonNegativeInteger(field(input, 'originRevision')),
		sources,
	});
}

/** Prepare detached source rows using caller-owned fresh project identities. */
export function prepareFramescaperProfessionalMediaClipboardPasteV9(
	clipboardValue: unknown,
	options: Readonly<{ sourceIdMap: ReadonlyMap<string, string> }>,
): readonly FramescaperProfessionalVideoSourceProfessionalMedia[] {
	const clipboard = normalizeFramescaperProfessionalMediaClipboardV9(clipboardValue);
	const allocations = allocationMap(options?.sourceIdMap, 'sourceIdMap');
	const used = new Set<string>();
	const oldIds = new Set(allocations.keys());
	const fresh = new Set<string>();
	const sources = clipboard.sources.map((source) => {
		const id = allocated(allocations, source.id, 'professional source');
		if (oldIds.has(id)) throw new RangeError('A V9 paste source allocation must be fresh.');
		if (fresh.has(id)) throw new RangeError('V9 paste source allocations must be unique.');
		fresh.add(id);
		used.add(source.id);
		const candidate = structuredClone(source) as unknown as Record<string, unknown>;
		candidate.id = id;
		if (candidate.imageSequence !== null) {
			(candidate.imageSequence as Record<string, unknown>).id = id;
		}
		return normalizeFramescaperProfessionalVideoSourceProfessionalMedia(candidate);
	});
	assertNoUnusedAllocations(allocations, used, 'V9 source');
	return Object.freeze(sources);
}

function field(record: Readonly<Record<string, unknown>>, key: string): unknown {
	return readClosedDomainField(record, key, 'Framescaper professional-media clipboard V9');
}

function stableId(value: unknown, name: string): string {
	if (typeof value !== 'string' || !ID.test(value)) throw new TypeError(`${name} must be a stable ID.`);
	return value;
}

function allocationMap(
	value: unknown,
	name: string,
): ReadonlyMap<string, string> {
	if (!value || typeof value !== 'object'
		|| typeof (value as ReadonlyMap<unknown, unknown>).get !== 'function'
		|| typeof (value as ReadonlyMap<unknown, unknown>).entries !== 'function'
		|| !Number.isSafeInteger((value as ReadonlyMap<unknown, unknown>).size)
		|| (value as ReadonlyMap<unknown, unknown>).size > 100_000) {
		throw new TypeError(`V9 paste ${name} must be a bounded map.`);
	}
	return value as ReadonlyMap<string, string>;
}

function allocated(map: ReadonlyMap<string, string>, source: string, name: string): string {
	const value = map.get(source);
	if (value === undefined) throw new ReferenceError(`V9 paste has no mapping for ${name} ${source}.`);
	return stableId(value, `mapped ${name}`);
}

function assertNoUnusedAllocations(
	map: ReadonlyMap<string, string>,
	used: ReadonlySet<string>,
	name: string,
): void {
	for (const [source, target] of map) {
		stableId(source, `${name} allocation source`);
		stableId(target, `${name} allocation target`);
		if (!used.has(source)) throw new RangeError(`${name} paste contains an unused allocation ${source}.`);
	}
}

function nonNegativeInteger(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0) throw new RangeError('originRevision is invalid.');
	return Number(value);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
		Object.freeze(value);
	}
	return value;
}
