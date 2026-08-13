/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectRevision } from '../common/editor/storage/project-repository.ts';
import {
	assertFramescaperEditorProjectEnvironmentV18,
	type FramescaperEditorProjectEnvironmentV18,
} from './editor-project-environment-v18.ts';
import {
	type FramescaperProjectV18ClaimCleanupOperation,
	type FramescaperProjectV18ClaimCleanupResult,
} from './editor-project-v18-claim-cleanup-repository.ts';
import { normalizeCleanupOperation } from './editor-project-v18-claim-cleanup-support.ts';
import {
	cloneFramescaperProjectHistoryV18,
	type FramescaperProjectHistoryV18,
} from './editor-project-v18-history.ts';
import {
	createFramescaperProjectMaintenanceCoordinatorV18,
	type FramescaperProjectMaintenanceResultV18,
} from './editor-project-v18-maintenance.ts';
import {
	framescaperProjectFingerprintV18,
} from './editor-project-v18-preservation-repository.ts';
import {
	cloneFramescaperProjectV18,
	type FramescaperProjectV18,
} from './editor-project-v18.ts';

const RETENTION_REQUEST_FIELDS = ['currentProject', 'pendingSaveSnapshots'] as const;
const CLEANUP_REQUEST_FIELDS = ['operation', 'pendingSaveSnapshots'] as const;

type FramescaperSessionControllerV18 = ReturnType<
	FramescaperEditorProjectEnvironmentV18['runtime']['createSessionController']
>;

export interface FramescaperProjectMaintenanceRetentionRequestV18 {
	readonly currentProject: unknown;
	readonly pendingSaveSnapshots: readonly unknown[] | ReadonlySet<unknown>;
}

export interface FramescaperProjectMaintenanceCleanupRequestV18 {
	readonly operation: FramescaperProjectV18ClaimCleanupOperation | unknown;
	readonly pendingSaveSnapshots: readonly unknown[] | ReadonlySet<unknown>;
}

export interface FramescaperProjectMaintenanceRuntimeV18 {
	readonly sessionController: FramescaperSessionControllerV18;
	readonly reconcileAndCollectStorageRoots: (
		request: FramescaperProjectMaintenanceRetentionRequestV18 | unknown,
	) => Promise<Readonly<FramescaperProjectMaintenanceResultV18>>;
	readonly cleanupDeterminatePrepublicationFailure: (
		request: FramescaperProjectMaintenanceCleanupRequestV18 | unknown,
	) => Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>>;
}

interface SessionScopeSnapshot {
	readonly token: unknown;
	readonly activeProject: FramescaperProjectV18 | null;
	readonly sessionProjects: readonly FramescaperProjectV18[];
	readonly histories: readonly FramescaperProjectHistoryV18[];
}

interface PendingScopeSnapshot {
	readonly input: readonly unknown[] | ReadonlySet<unknown>;
	readonly identities: readonly unknown[];
	readonly fingerprints: readonly string[];
	readonly projects: readonly FramescaperProjectV18[];
}

/**
 * Product-owned adapter for the common controller boundary. It owns the exact
 * V18 session and derives every tab current/history plus every durable current
 * and retained revision; the caller supplies only its live pending-save set.
 */
export function createFramescaperProjectMaintenanceRuntimeV18(
	environmentValue: FramescaperEditorProjectEnvironmentV18 | unknown,
): Readonly<FramescaperProjectMaintenanceRuntimeV18> {
	const environment = assertFramescaperEditorProjectEnvironmentV18(environmentValue);
	const profile = environment.runtime.profile;
	const coordinator = createFramescaperProjectMaintenanceCoordinatorV18(environment);
	const sessionController = environment.runtime.createSessionController();

	return Object.freeze({
		sessionController,
		reconcileAndCollectStorageRoots,
		cleanupDeterminatePrepublicationFailure,
	});

	async function reconcileAndCollectStorageRoots(
		requestValue: FramescaperProjectMaintenanceRetentionRequestV18 | unknown,
	): Promise<Readonly<FramescaperProjectMaintenanceResultV18>> {
		const request = closedRecord(
			requestValue,
			RETENTION_REQUEST_FIELDS,
			'Framescaper V18 maintenance retention request',
		);
		const currentProject = cloneFramescaperProjectV18(profile, request.currentProject);
		const session = snapshotSessionScope(profile, sessionController);
		assertActiveProject(profile, session.activeProject, currentProject);
		const pending = snapshotPendingScope(profile, request.pendingSaveSnapshots);
		const retainedRevisions = await durableRevisionInventory(environment);
		assertRuntimeScopeCurrent(profile, sessionController, session, pending);
		const result = await coordinator.reconcileAndCollectStorageRoots({
			currentProject,
			retainedRevisions,
			sessionProjects: session.sessionProjects,
			histories: session.histories,
			pendingSaveSnapshots: pending.projects,
			claims: [],
		});
		assertRuntimeScopeCurrent(profile, sessionController, session, pending);
		return result;
	}

	function cleanupDeterminatePrepublicationFailure(
		requestValue: FramescaperProjectMaintenanceCleanupRequestV18 | unknown,
	): Promise<Readonly<FramescaperProjectV18ClaimCleanupResult>> {
		const request = closedRecord(
			requestValue,
			CLEANUP_REQUEST_FIELDS,
			'Framescaper V18 maintenance cleanup request',
		);
		const operation = normalizeCleanupOperation(request.operation);
		const session = snapshotSessionScope(profile, sessionController);
		const pending = snapshotPendingScope(profile, request.pendingSaveSnapshots);
		return coordinator.cleanupDeterminatePrepublicationFailure(operation, {
			sessionProjects: session.sessionProjects,
			histories: session.histories,
			pendingSaveSnapshots: pending.projects,
		}).then((result) => {
			assertRuntimeScopeCurrent(profile, sessionController, session, pending);
			return result;
		});
	}
}

function snapshotSessionScope(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	sessionController: FramescaperSessionControllerV18,
): SessionScopeSnapshot {
	const token: unknown = sessionController.getSnapshot();
	const raw = plainRecord(token, 'Framescaper V18 session snapshot');
	const activeProjectId = optionalIdentifier(
		dataProperty(raw, 'activeProjectId', 'Framescaper V18 session snapshot'),
	);
	const histories: FramescaperProjectHistoryV18[] = [];
	const sessionProjects: FramescaperProjectV18[] = [];
	let activeProject: FramescaperProjectV18 | null = null;
	for (const [index, tabValue] of denseArray(
		dataProperty(raw, 'tabs', 'Framescaper V18 session snapshot'),
		'Framescaper V18 session tabs',
	).entries()) {
		const tab = plainRecord(tabValue, `Framescaper V18 session tab ${String(index)}`);
		const projectId = identifier(
			dataProperty(tab, 'projectId', `Framescaper V18 session tab ${String(index)}`),
			'Framescaper V18 session project ID',
		);
		const history = cloneFramescaperProjectHistoryV18(
			profile,
			dataProperty(tab, 'history', `Framescaper V18 session tab ${String(index)}`),
		);
		if (history.present.id !== projectId) {
			throw new Error('A Framescaper V18 session tab does not match its history project.');
		}
		if (sessionProjects.some((project) => project.id === projectId)) {
			throw new Error('A Framescaper V18 session project appears more than once.');
		}
		histories.push(history);
		sessionProjects.push(history.present);
		if (projectId === activeProjectId) activeProject = history.present;
	}
	if ((activeProjectId === null) !== (activeProject === null)) {
		throw new Error('The Framescaper V18 active session project is inconsistent.');
	}
	return Object.freeze({
		token,
		activeProject,
		sessionProjects: Object.freeze(sessionProjects),
		histories: Object.freeze(histories),
	});
}

function snapshotPendingScope(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	inputValue: unknown,
): PendingScopeSnapshot {
	const input = pendingInput(inputValue);
	const identities = collectionValues(input);
	const projects = identities.map((project) => cloneFramescaperProjectV18(profile, project));
	return Object.freeze({
		input,
		identities: Object.freeze(identities),
		fingerprints: Object.freeze(projects.map((project) => (
			framescaperProjectFingerprintV18(profile, project)
		))),
		projects: Object.freeze(projects),
	});
}

async function durableRevisionInventory(
	environment: Readonly<FramescaperEditorProjectEnvironmentV18>,
): Promise<readonly ProjectRevision[]> {
	const projects = await environment.store.listProjects();
	const inventory: ProjectRevision[] = [];
	for (const project of projects) {
		inventory.push({ revision: Number(project.revision), project });
		inventory.push(...await environment.store.listProjectRevisions(project.id));
	}
	const unique = new Map<string, ProjectRevision>();
	for (const value of inventory) {
		const project = cloneFramescaperProjectV18(environment.runtime.profile, value.project);
		if (!Number.isSafeInteger(value.revision) || value.revision < 0
			|| project.revision !== value.revision) {
			throw new Error('The Framescaper V18 durable revision inventory is inconsistent.');
		}
		const fingerprint = framescaperProjectFingerprintV18(environment.runtime.profile, project);
		unique.set(`${project.id}:${String(value.revision)}:${fingerprint}`, Object.freeze({
			revision: value.revision,
			project,
		}));
	}
	return Object.freeze([...unique.values()]);
}

function assertActiveProject(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	active: FramescaperProjectV18 | null,
	current: FramescaperProjectV18,
): void {
	if (!active || active.id !== current.id
		|| framescaperProjectFingerprintV18(profile, active)
			!== framescaperProjectFingerprintV18(profile, current)) {
		throw new Error('The Framescaper V18 active session project must match the maintenance project.');
	}
}

function assertRuntimeScopeCurrent(
	profile: FramescaperEditorProjectEnvironmentV18['runtime']['profile'],
	sessionController: FramescaperSessionControllerV18,
	session: SessionScopeSnapshot,
	pending: PendingScopeSnapshot,
): void {
	if (sessionController.getSnapshot() !== session.token) throwRuntimeScopeChanged();
	const values = collectionValues(pending.input);
	if (values.length !== pending.identities.length) throwRuntimeScopeChanged();
	for (let index = 0; index < values.length; index += 1) {
		if (values[index] !== pending.identities[index]) throwRuntimeScopeChanged();
		let fingerprint: string;
		try {
			fingerprint = framescaperProjectFingerprintV18(profile, values[index]);
		} catch {
			throwRuntimeScopeChanged();
		}
		if (fingerprint !== pending.fingerprints[index]) throwRuntimeScopeChanged();
	}
}

function throwRuntimeScopeChanged(): never {
	throw new Error('The Framescaper V18 runtime scope changed during maintenance.');
}

function pendingInput(value: unknown): readonly unknown[] | ReadonlySet<unknown> {
	if (Array.isArray(value)) {
		denseArray(value, 'Framescaper V18 pending-save snapshots');
		return value;
	}
	if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Set.prototype) {
		throw new TypeError('Framescaper V18 pending-save snapshots must be a plain Set or dense array.');
	}
	return value as ReadonlySet<unknown>;
}

function collectionValues(input: readonly unknown[] | ReadonlySet<unknown>): unknown[] {
	return Array.isArray(input)
		? denseArray(input, 'Framescaper V18 pending-save snapshots')
		: [...Set.prototype.values.call(input as Set<unknown>)];
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

function optionalIdentifier(value: unknown): string | null {
	return value === null ? null : identifier(value, 'Framescaper V18 active project ID');
}

function identifier(value: unknown, name: string): string {
	if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${name} is required.`);
	return value;
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
