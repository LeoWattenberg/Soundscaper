/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	normalizeVideoProxyCleanupTombstoneRecord,
} from '../common/editor/storage/video-proxy-cleanup-tombstone.ts';
import {
	normalizeVideoProxyClaimRecord,
} from '../common/editor/storage/video-proxy-claim-repository.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	type FramescaperProjectV18ClaimCleanupOperation,
	type FramescaperProjectV18ClaimCleanupResult,
	type FramescaperProjectV18ClaimCleanupScope,
} from './editor-project-v18-claim-cleanup-repository.ts';
import {
	normalizeCleanupOperation,
} from './editor-project-v18-claim-cleanup-support.ts';
import {
	cloneFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import { assertFramescaperProjectV18Profile } from './editor-project-v18-profile.ts';
import {
	type FramescaperProjectRetainedRevisionV18,
	type FramescaperProjectRetentionLimitsV18,
} from './editor-project-v18-retention.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

const MAINTENANCE_SCOPE_FIELDS = [
	'currentProject', 'retainedRevisions', 'sessionProjects', 'histories',
	'pendingSaveSnapshots', 'claims',
] as const;
const CLEANUP_SCOPE_FIELDS = ['sessionProjects', 'histories', 'pendingSaveSnapshots'] as const;
const RETAINED_REVISION_FIELDS = ['revision', 'project'] as const;
const RETENTION_LIMIT_FIELDS = ['maximumInputs', 'maximumRoots'] as const;

export interface FramescaperProjectMaintenanceScopeV18 {
	readonly currentProject: unknown;
	readonly retainedRevisions: readonly FramescaperProjectRetainedRevisionV18[];
	readonly sessionProjects: readonly unknown[];
	readonly histories: readonly unknown[];
	readonly pendingSaveSnapshots: readonly unknown[] | ReadonlySet<unknown>;
	readonly claims: readonly unknown[];
}

export interface FramescaperProjectMaintenanceResultV18 {
	readonly cleanup: Readonly<FramescaperProjectV18ClaimCleanupResult>;
	readonly storageRoots: readonly string[];
}

export interface FramescaperProjectMaintenanceCoordinatorV18 {
	reconcileAndCollectStorageRoots(
		scope: FramescaperProjectMaintenanceScopeV18 | unknown,
		limits?: FramescaperProjectRetentionLimitsV18 | unknown,
	): Promise<Readonly<FramescaperProjectMaintenanceResultV18>>;
	cleanupDeterminatePrepublicationFailure(
		operation: FramescaperProjectV18ClaimCleanupOperation | unknown,
		scope: FramescaperProjectV18ClaimCleanupScope | unknown,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>>;
}

interface MaintenanceSnapshot {
	readonly currentProject: FramescaperProjectV18;
	readonly retainedRevisions: readonly FramescaperProjectRetainedRevisionV18[];
	readonly sessionProjects: readonly FramescaperProjectV18[];
	readonly histories: readonly FramescaperProjectHistoryV18[];
	readonly pendingSaveSnapshots: readonly FramescaperProjectV18[];
	readonly claims: readonly unknown[];
}

/**
 * Derive the only V18 cleanup/retention authority from a product-created
 * environment. Runtime roots are detached before the first durable await, and
 * no retention result is collected until the complete cleanup pass settles.
 */
export function createFramescaperProjectMaintenanceCoordinatorV18(
	environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
): Readonly<FramescaperProjectMaintenanceCoordinatorV18> {
	const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
	const profile = environment.runtime.profile;
	assertFramescaperProjectV18Profile(profile);

	return Object.freeze({
		reconcileAndCollectStorageRoots,
		cleanupDeterminatePrepublicationFailure,
	});

	async function reconcileAndCollectStorageRoots(
		scopeValue: FramescaperProjectMaintenanceScopeV18 | unknown,
		limitsValue: FramescaperProjectRetentionLimitsV18 | unknown = {},
	): Promise<Readonly<FramescaperProjectMaintenanceResultV18>> {
		const scope = snapshotMaintenanceScope(profile, scopeValue);
		const limits = snapshotRetentionLimits(limitsValue);
		const cleanup = await environment.claimCleanup.reconcile(cleanupScope(scope));
		assertSettledCleanup(cleanup, 'maintenance');
		const storageRoots = environment.collectStorageRoots({
			currentProject: scope.currentProject,
			retainedRevisions: scope.retainedRevisions,
			histories: scope.histories,
			pendingSaveSnapshots: scope.pendingSaveSnapshots,
			claims: scope.claims,
		}, limits);
		return Object.freeze({ cleanup, storageRoots });
	}

	function cleanupDeterminatePrepublicationFailure(
		operationValue: FramescaperProjectV18ClaimCleanupOperation | unknown,
		scopeValue: FramescaperProjectV18ClaimCleanupScope | unknown,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>> {
		const operation = normalizeCleanupOperation(operationValue);
		const scope = snapshotCleanupScope(profile, scopeValue);
		return environment.claimCleanup.cleanupOperation(operation, scope).then((cleanup) => {
			assertSettledCleanup(cleanup, 'prepublication');
			return cleanup;
		});
	}
}

function snapshotMaintenanceScope(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	value: unknown,
): MaintenanceSnapshot {
	const raw = closedRecord(value, MAINTENANCE_SCOPE_FIELDS, 'Framescaper V18 maintenance scope');
	return Object.freeze({
		currentProject: cloneFramescaperProjectV18(profile, raw.currentProject),
		retainedRevisions: Object.freeze(denseArray(
			raw.retainedRevisions,
			'Framescaper V18 maintenance retained revisions',
		).map((revision) => snapshotRetainedRevision(profile, revision))),
		sessionProjects: snapshotProjects(profile, raw.sessionProjects, 'Framescaper V18 maintenance session projects'),
		histories: Object.freeze(denseArray(
			raw.histories,
			'Framescaper V18 maintenance histories',
		).map((history) => cloneFramescaperProjectHistoryV18(profile, history))),
		pendingSaveSnapshots: snapshotProjects(
			profile,
			collection(raw.pendingSaveSnapshots, 'Framescaper V18 maintenance pending saves'),
			'Framescaper V18 maintenance pending saves',
		),
		claims: Object.freeze(denseArray(
			raw.claims,
			'Framescaper V18 maintenance claims',
		).map(snapshotClaim)),
	});
}

function snapshotCleanupScope(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	value: unknown,
): Readonly<FramescaperProjectV18ClaimCleanupScope> {
	const raw = closedRecord(value, CLEANUP_SCOPE_FIELDS, 'Framescaper V18 maintenance cleanup scope');
	return Object.freeze({
		sessionProjects: snapshotProjects(
			profile,
			raw.sessionProjects,
			'Framescaper V18 maintenance cleanup session projects',
		),
		histories: Object.freeze(denseArray(
			raw.histories,
			'Framescaper V18 maintenance cleanup histories',
		).map((history) => cloneFramescaperProjectHistoryV18(profile, history))),
		pendingSaveSnapshots: snapshotProjects(
			profile,
			collection(raw.pendingSaveSnapshots, 'Framescaper V18 maintenance cleanup pending saves'),
			'Framescaper V18 maintenance cleanup pending saves',
		),
	});
}

function cleanupScope(scope: MaintenanceSnapshot): Readonly<FramescaperProjectV18ClaimCleanupScope> {
	return Object.freeze({
		sessionProjects: scope.sessionProjects,
		histories: scope.histories,
		pendingSaveSnapshots: scope.pendingSaveSnapshots,
	});
}

function snapshotProjects(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	value: unknown,
	name: string,
): readonly FramescaperProjectV18[] {
	return Object.freeze(denseArray(value, name).map((project) => (
		cloneFramescaperProjectV18(profile, project)
	)));
}

function snapshotRetainedRevision(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	value: unknown,
): Readonly<FramescaperProjectRetainedRevisionV18> {
	const raw = closedRecord(
		value,
		RETAINED_REVISION_FIELDS,
		'Framescaper V18 maintenance retained revision',
	);
	const project = cloneFramescaperProjectV18(profile, raw.project);
	if (!Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0
		|| project.revision !== raw.revision) {
		throw new RangeError('A Framescaper V18 maintenance retained revision must match its project snapshot.');
	}
	return Object.freeze({ revision: Number(raw.revision), project });
}

function snapshotClaim(value: unknown): unknown {
	try {
		return normalizeVideoProxyClaimRecord(value);
	} catch (claimError) {
		try {
			return normalizeVideoProxyCleanupTombstoneRecord(value);
		} catch {
			throw claimError;
		}
	}
}

function snapshotRetentionLimits(value: unknown): FramescaperProjectRetentionLimitsV18 {
	const raw = closedOptionalRecord(value, RETENTION_LIMIT_FIELDS, 'Framescaper V18 maintenance retention limits');
	return Object.freeze({
		...(raw.maximumInputs === undefined ? {} : { maximumInputs: raw.maximumInputs as number }),
		...(raw.maximumRoots === undefined ? {} : { maximumRoots: raw.maximumRoots as number }),
	});
}

function assertSettledCleanup(
	result: Readonly<FramescaperProjectV18ClaimCleanupResult>,
	phase: 'maintenance' | 'prepublication',
): void {
	if (result.status !== 'settled') {
		const codes = result.issues.map(({ code }) => code).join(', ');
		throw new Error(
			`Framescaper V18 ${phase} claim cleanup is indeterminate${codes ? `: ${codes}` : ''}.`,
		);
	}
}

function collection(value: unknown, name: string): readonly unknown[] {
	if (Array.isArray(value)) return denseArray(value, name);
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Set.prototype) {
		throw new TypeError(`${name} must be a plain Set or dense array.`);
	}
	return [...Set.prototype.values.call(value as Set<unknown>)];
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

function closedOptionalRecord<const Fields extends readonly string[]>(
	value: unknown,
	fields: Fields,
	name: string,
): Partial<Record<Fields[number], unknown>> {
	const raw = plainRecord(value, name);
	const keys = Reflect.ownKeys(raw);
	if (keys.some((key) => typeof key !== 'string' || !fields.includes(key))) {
		throw new TypeError(`${name} has unsupported fields.`);
	}
	return Object.fromEntries(keys.map((key) => [
		key,
		dataProperty(raw, String(key), name),
	])) as Partial<Record<Fields[number], unknown>>;
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
	return Object.fromEntries(fields.map((field) => [field, dataProperty(raw, field, name)])) as Record<
		Fields[number], unknown
	>;
}

function dataProperty(value: Record<string, unknown>, key: string, name: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw new TypeError(`${name}.${key} must be an own enumerable data property.`);
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
