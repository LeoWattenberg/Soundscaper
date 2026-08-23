/* SPDX-License-Identifier: AGPL-3.0-only */

/** Record shapes and all-or-nothing memory mutation helpers shared by the project repositories. */

import type { ProjectDocument } from './project-repository.ts';

export interface ProjectRevisionRecord {
	readonly key: string;
	readonly projectId: string;
	readonly revision: number;
	readonly project: ProjectDocument;
	readonly creationFence?: string;
}

export interface MemoryMutation {
	readonly map: Map<string, unknown>;
	readonly key: string;
	readonly operation: 'set' | 'delete';
	readonly value?: unknown;
	readonly prior: unknown;
	readonly hadPrior: boolean;
}

export function setMemoryMutation(
	map: Map<string, unknown>,
	key: string,
	value: unknown,
): MemoryMutation {
	return { map, key, operation: 'set', value, prior: map.get(key), hadPrior: map.has(key) };
}

export function deleteMemoryMutation(map: Map<string, unknown>, key: string): MemoryMutation {
	return { map, key, operation: 'delete', prior: map.get(key), hadPrior: map.has(key) };
}

export function applyMemoryMutations(mutations: readonly MemoryMutation[]): void {
	const attempted: MemoryMutation[] = [];
	try {
		for (const mutation of mutations) {
			attempted.push(mutation);
			if (mutation.operation === 'set') mutation.map.set(mutation.key, mutation.value);
			else mutation.map.delete(mutation.key);
		}
	} catch (primary) {
		const rollbackErrors: unknown[] = [];
		for (const mutation of attempted.reverse()) {
			try {
				if (mutation.hadPrior) mutation.map.set(mutation.key, mutation.prior);
				else mutation.map.delete(mutation.key);
			} catch (error) { rollbackErrors.push(error); }
		}
		if (rollbackErrors.length) {
			throw new AggregateError(
				[primary, ...rollbackErrors],
				'Memory project mutation and rollback both failed.',
			);
		}
		throw primary;
	}
}

export function memoryHasProjectRevision(revisions: ReadonlyMap<string, unknown>, projectId: string): boolean {
	for (const value of revisions.values()) {
		if (storedProjectId(value) === projectId) return true;
	}
	return false;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

export function storedProjectId(value: unknown): unknown {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'projectId');
	return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
}

export function storedCreationFence(value: unknown): string | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const descriptor = Object.getOwnPropertyDescriptor(value, 'creationFence');
	return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string'
		? descriptor.value
		: null;
}

export function asRevision(value: unknown): ProjectRevisionRecord | null {
	const record = asRecord(value);
	if (!record || typeof record.key !== 'string' || typeof record.projectId !== 'string') return null;
	if (typeof record.revision !== 'number' || !record.project || typeof record.project !== 'object') return null;
	return record as unknown as ProjectRevisionRecord;
}

export function isRevisionFor(projectId: string): (record: ProjectRevisionRecord | null) => record is ProjectRevisionRecord {
	return (record): record is ProjectRevisionRecord => record?.projectId === projectId;
}

export function clone<Value>(value: Value): Value {
	if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
	return JSON.parse(JSON.stringify(value)) as Value;
}

export function createProjectCreationFence(): string {
	const uuid = globalThis.crypto?.randomUUID?.();
	if (!uuid) throw new Error('Secure random generation is required for create-only project storage.');
	return `project_creation_${uuid.replaceAll('-', '')}`;
}

export function revisionKey(projectId: string, revision: number): string {
	return `${projectId}:${String(nonNegativeInteger(revision, 0)).padStart(12, '0')}`;
}

export function nonNegativeInteger(value: unknown, fallback: number): number {
	return Number.isFinite(value) && Number(value) >= 0 ? Math.floor(Number(value)) : fallback;
}

export function sortProjects(left: ProjectDocument, right: ProjectDocument): number {
	return String(right.updatedAt || '').localeCompare(String(left.updatedAt || ''));
}
