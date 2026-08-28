/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectStorageKeys } from '../common/editor/retention.js';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { normalizeVideoProxyCleanupTombstoneRecord } from '../common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	MAX_VIDEO_PROXY_CLAIMS,
	normalizeVideoProxyClaimRecord,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import {
	validateFramescaperProjectHistorySequence,
	type FramescaperProjectHistoryEntrySequence,
	type FramescaperProjectHistorySequence,
} from './editor-project-sequence-history.ts';
import { assertFramescaperProjectSequenceProfile } from './editor-project-sequence-profile.ts';
import {
	cloneFramescaperProjectSequence,
	type FramescaperProjectSequence,
} from './editor-project-sequence.ts';

export const FRAMESCAPER_SEQUENCE_RETENTION_LIMITS = Object.freeze({
	maximumInputs: MAX_VIDEO_PROXY_CLAIMS,
	maximumRoots: MAX_VIDEO_PROXY_CLAIMS,
});

const SCOPE_FIELDS = [
	'currentProject', 'retainedRevisions', 'histories', 'pendingSaveSnapshots', 'claims',
] as const;
const REVISION_FIELDS = ['revision', 'project'] as const;

export interface FramescaperProjectRetainedRevisionSequence {
	readonly revision: number;
	readonly project: unknown;
}

export interface FramescaperProjectRetentionScopeSequence {
	readonly currentProject: unknown;
	readonly retainedRevisions: readonly FramescaperProjectRetainedRevisionSequence[];
	readonly histories: readonly unknown[];
	readonly pendingSaveSnapshots: readonly unknown[] | ReadonlySet<unknown>;
	readonly claims: readonly unknown[];
}

export interface FramescaperProjectRetentionLimitsSequence {
	readonly maximumInputs?: number;
	readonly maximumRoots?: number;
}

interface NormalizedScope {
	readonly currentProject: unknown;
	readonly retainedRevisions: readonly unknown[];
	readonly histories: readonly NormalizedHistory[];
	readonly pendingSaveSnapshots: readonly unknown[];
	readonly claims: readonly unknown[];
}

interface NormalizedHistory {
	readonly history: FramescaperProjectHistorySequence;
	readonly projects: readonly unknown[];
}

/**
 * Collect the complete dormant sequence local-media root graph. No caller-owned
 * target is accepted, so any validation or budget failure exposes no partial
 * reachability result.
 */
export function collectFramescaperProjectStorageRootsSequence(
	profile: EditorProjectRuntimeProfile | unknown,
	scopeValue: FramescaperProjectRetentionScopeSequence | unknown,
	limitValue: FramescaperProjectRetentionLimitsSequence = {},
): readonly string[] {
	assertFramescaperProjectSequenceProfile(profile);
	const limits = normalizeLimits(limitValue);
	const scope = normalizeScope(scopeValue);
	assertAggregateInputLimit(scope, limits.maximumInputs);

	const projects: FramescaperProjectSequence[] = [snapshotProject(profile, scope.currentProject)];
	for (const value of scope.retainedRevisions) {
		projects.push(snapshotRetainedRevision(profile, value));
	}
	for (const normalized of scope.histories) {
		validateFramescaperProjectHistorySequence(profile, normalized.history);
		for (const project of normalized.projects) projects.push(snapshotProject(profile, project));
	}
	for (const project of scope.pendingSaveSnapshots) projects.push(snapshotProject(profile, project));
	const claimRoots = scope.claims.map(retentionClaimBodyKey);

	const roots = new Set<string>();
	for (const project of projects) {
		collectProjectStorageKeys(project, roots);
		assertRootLimit(roots, limits.maximumRoots);
		for (const source of project.sources) {
			if (source.kind !== 'video' || source.proxyAttachment === null) continue;
			roots.add(source.proxyAttachment.storageKey);
			roots.add(source.proxyAttachment.timingAsset.storageKey);
			assertRootLimit(roots, limits.maximumRoots);
		}
	}
	for (const bodyKey of claimRoots) {
		roots.add(bodyKey);
		assertRootLimit(roots, limits.maximumRoots);
	}
	return Object.freeze([...roots].sort());
}

function retentionClaimBodyKey(value: unknown): string {
	try {
		return normalizeVideoProxyClaimRecord(value).bodyKey;
	} catch (claimError) {
		try {
			return normalizeVideoProxyCleanupTombstoneRecord(value).claim.bodyKey;
		} catch {
			throw claimError;
		}
	}
}

function normalizeScope(value: unknown): NormalizedScope {
	const raw = closedRecord(value, SCOPE_FIELDS, 'Framescaper sequence retention scope');
	return {
		currentProject: raw.currentProject,
		retainedRevisions: denseArray(raw.retainedRevisions, 'retained revisions'),
		histories: denseArray(raw.histories, 'project histories').map(normalizeHistory),
		pendingSaveSnapshots: snapshotCollection(raw.pendingSaveSnapshots),
		claims: denseArray(raw.claims, 'video proxy claims'),
	};
}

function normalizeHistory(value: unknown, index: number): NormalizedHistory {
	const name = `project histories[${String(index)}]`;
	const raw = plainRecord(value, name);
	const limit = dataProperty(raw, 'limit', name);
	const present = dataProperty(raw, 'present', name);
	const undoStack = normalizeHistoryStack(dataProperty(raw, 'undoStack', name), `${name}.undoStack`);
	const redoStack = normalizeHistoryStack(dataProperty(raw, 'redoStack', name), `${name}.redoStack`);
	const history = { limit, present, undoStack, redoStack } as FramescaperProjectHistorySequence;
	return {
		history,
		projects: [present, ...undoStack.map(({ project }) => project), ...redoStack.map(({ project }) => project)],
	};
}

function normalizeHistoryStack(value: unknown, name: string): FramescaperProjectHistoryEntrySequence[] {
	return denseArray(value, name).map((entry, index) => {
		const entryName = `${name}[${String(index)}]`;
		const raw = plainRecord(entry, entryName);
		return {
			project: dataProperty(raw, 'project', entryName) as FramescaperProjectSequence,
			command: dataProperty(raw, 'command', entryName) as FramescaperProjectHistoryEntrySequence['command'],
		};
	});
}

function snapshotCollection(value: unknown): readonly unknown[] {
	if (Array.isArray(value)) return denseArray(value, 'pending-save snapshots');
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Set.prototype) {
		throw new TypeError('Framescaper sequence pending-save snapshots must be a plain Set or dense array.');
	}
	return [...Set.prototype.values.call(value as Set<unknown>)];
}

function assertAggregateInputLimit(scope: NormalizedScope, maximumInputs: number): void {
	let count = 1 + scope.retainedRevisions.length
		+ scope.pendingSaveSnapshots.length + scope.claims.length;
	for (const { projects } of scope.histories) {
		count += projects.length;
		if (count > maximumInputs) break;
	}
	if (count > maximumInputs) {
		throw new RangeError('The Framescaper sequence aggregate retention input limit was exceeded.');
	}
}

function snapshotRetainedRevision(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
): FramescaperProjectSequence {
	const raw = closedRecord(value, REVISION_FIELDS, 'Framescaper sequence retained revision');
	if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0) {
		throw new RangeError('A retained sequence revision requires a non-negative safe integer revision.');
	}
	const project = snapshotProject(profile, raw.project);
	if (project.revision !== raw.revision) {
		throw new RangeError('A retained sequence revision must match its project snapshot revision.');
	}
	return project;
}

function snapshotProject(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
): FramescaperProjectSequence {
	return cloneFramescaperProjectSequence(profile, value);
}

function normalizeLimits(value: FramescaperProjectRetentionLimitsSequence): Required<FramescaperProjectRetentionLimitsSequence> {
	const raw = plainRecord(value, 'Framescaper sequence retention limits');
	return {
		maximumInputs: boundedLimit(
			optionalDataProperty(raw, 'maximumInputs') ?? FRAMESCAPER_SEQUENCE_RETENTION_LIMITS.maximumInputs,
			FRAMESCAPER_SEQUENCE_RETENTION_LIMITS.maximumInputs,
			'aggregate inputs',
		),
		maximumRoots: boundedLimit(
			optionalDataProperty(raw, 'maximumRoots') ?? FRAMESCAPER_SEQUENCE_RETENTION_LIMITS.maximumRoots,
			FRAMESCAPER_SEQUENCE_RETENTION_LIMITS.maximumRoots,
			'storage roots',
		),
	};
}

function boundedLimit(value: unknown, ceiling: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > ceiling) {
		throw new RangeError(`The Framescaper sequence ${name} limit must be a positive bounded safe integer.`);
	}
	return Number(value);
}

function assertRootLimit(roots: ReadonlySet<string>, maximumRoots: number): void {
	if (roots.size > maximumRoots) {
		throw new RangeError('The Framescaper sequence storage root limit was exceeded.');
	}
}

function denseArray(value: unknown, name: string): unknown[] {
	if (!Array.isArray(value)) throw new TypeError(`${name} must be a dense array.`);
	const result: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
			throw new TypeError(`${name}[${String(index)}] must be an own enumerable data property.`);
		}
		result.push(descriptor.value);
	}
	if (Reflect.ownKeys(value).some((key) => key !== 'length'
		&& (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key)))) {
		throw new TypeError(`${name} must not carry non-index properties.`);
	}
	return result;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function optionalDataProperty(value: Record<string, unknown>, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor) return undefined;
	if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`Framescaper sequence retention limits.${key} must be an own enumerable data property.`);
	}
	return descriptor.value;
}

function plainRecord(value: unknown, name: string): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError(`${name} must be a plain record.`);
	}
	return value as Record<string, unknown>;
}

function closedRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Record<Fields[number], unknown> {
	const raw = plainRecord(value, name);
	const keys = Reflect.ownKeys(raw);
	if (keys.length !== fields.length
		|| keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has unsupported, missing, or extra fields.`);
	}
	return Object.fromEntries(fields.map((field) => [field, dataProperty(raw, field, name)])) as Record<Fields[number], unknown>;
}
