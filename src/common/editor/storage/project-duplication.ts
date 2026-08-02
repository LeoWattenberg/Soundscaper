/* SPDX-License-Identifier: AGPL-3.0-only */

import { collectProjectSourceIds } from '../retention.js';
import { SCAPE_ARCHIVE_LIMITS } from '../scape-archive-envelope.ts';
import type { LinkedOriginalBinding } from './linked-original-binding.ts';
import type { LinkedVideoOriginalProjectAliasRepository } from './linked-video-original-project-alias-repository.ts';
import type { LinkedOriginalSource } from './linked-original-resolver.ts';
import type { LinkedVideoOriginalSource } from './linked-video-original-resolver.ts';
import type { ProjectDocument } from './project-repository.ts';

const MAXIMUM_REACHABLE_SOURCE_COUNT = SCAPE_ARCHIVE_LIMITS.maximumEntryCount - 2;

export interface ProjectDuplicationPort {
	readonly aliases: LinkedVideoOriginalProjectAliasRepository | null;
	loadProject(projectId: string): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
	listProjects(): PromiseLike<readonly ProjectDocument[]> | readonly ProjectDocument[];
	createProjectIfAbsent(project: ProjectDocument): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
}

export interface LinkedOriginalProjectAliasPort<Alias> {
	copyReachableAliases(
		sourceProjectId: string,
		destinationProjectId: string,
		sources: readonly LinkedOriginalSource[],
	): PromiseLike<readonly Alias[]> | readonly Alias[];
	rollbackAliases(aliases: readonly Alias[]): PromiseLike<void> | void;
}

export interface LinkedOriginalProjectDuplicationPort<Alias = LinkedOriginalBinding> {
	readonly aliases: LinkedOriginalProjectAliasPort<Alias> | null;
	loadProject(projectId: string): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
	listProjects(): PromiseLike<readonly ProjectDocument[]> | readonly ProjectDocument[];
	createProjectIfAbsent(project: ProjectDocument): PromiseLike<ProjectDocument | null> | ProjectDocument | null;
}

export interface ProjectDuplicationRequest {
	readonly sourceProjectId: string;
	readonly copyProjectId: string;
	readonly title?: unknown;
	readonly timestamp: string;
}

/** A duplicate may exist locally or remotely, so exact aliases must be retained for recovery. */
export class ProjectDuplicationIndeterminateError extends Error {
	readonly committed = true;
	readonly projectId: string;

	constructor(projectId: string, cause: unknown) {
		super(`Project duplication ${projectId} has an indeterminate committed state.`, { cause });
		this.name = 'ProjectDuplicationIndeterminateError';
		this.projectId = projectId;
	}
}

/** Duplicate one document together with pathless exact aliases to its reachable linked originals. */
export async function duplicateProjectWithLinkedVideoOriginals(
	port: ProjectDuplicationPort,
	request: ProjectDuplicationRequest,
): Promise<ProjectDocument> {
	const source = await port.loadProject(request.sourceProjectId);
	if (!source) throw new Error('The project to duplicate could not be found.');
	const projects = await port.listProjects();
	if (!projects.some(({ id }) => id === request.sourceProjectId)) {
		throw new Error('The project to duplicate is no longer in the current catalog.');
	}
	if (projects.some(({ id }) => id === request.copyProjectId)) {
		throw new Error('The project duplication destination already exists.');
	}
	const copy = duplicateDocument(source, request);
	const sources = reachableVideoSources(source);
	const aliases = port.aliases
		? await port.aliases.copyReachableAliases(request.sourceProjectId, request.copyProjectId, sources)
		: Object.freeze([]);
	try {
		const created = await port.createProjectIfAbsent(copy);
		if (!created) throw new Error('The project duplication destination already exists.');
		return created;
	} catch (error) {
		if (error instanceof ProjectDuplicationIndeterminateError) throw error;
		try { await port.aliases?.rollbackAliases(aliases); }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Project duplication and exact linked-video alias rollback both failed.',
			);
		}
		throw error;
	}
}

/** Duplicate one document together with exact aliases for every reachable linked original. */
export async function duplicateProjectWithLinkedOriginals<Alias>(
	port: LinkedOriginalProjectDuplicationPort<Alias>,
	request: ProjectDuplicationRequest,
): Promise<ProjectDocument> {
	const source = await duplicationSource(port, request);
	const copy = duplicateDocument(source, request);
	const sources = reachableOriginalSources(source);
	const aliases = port.aliases
		? await port.aliases.copyReachableAliases(request.sourceProjectId, request.copyProjectId, sources)
		: Object.freeze([] as Alias[]);
	try {
		const created = await port.createProjectIfAbsent(copy);
		if (!created) throw new Error('The project duplication destination already exists.');
		return created;
	} catch (error) {
		if (error instanceof ProjectDuplicationIndeterminateError) throw error;
		try { await port.aliases?.rollbackAliases(aliases); }
		catch (cleanupError) {
			throw new AggregateError(
				[error, cleanupError],
				'Project duplication and exact linked-original alias rollback both failed.',
			);
		}
		throw error;
	}
}

async function duplicationSource(
	port: Pick<LinkedOriginalProjectDuplicationPort<unknown>, 'loadProject' | 'listProjects'>,
	request: ProjectDuplicationRequest,
): Promise<ProjectDocument> {
	const source = await port.loadProject(request.sourceProjectId);
	if (!source) throw new Error('The project to duplicate could not be found.');
	const projects = await port.listProjects();
	if (!projects.some(({ id }) => id === request.sourceProjectId)) {
		throw new Error('The project to duplicate is no longer in the current catalog.');
	}
	if (projects.some(({ id }) => id === request.copyProjectId)) {
		throw new Error('The project duplication destination already exists.');
	}
	return source;
}

function duplicateDocument(
	source: ProjectDocument,
	request: ProjectDuplicationRequest,
): ProjectDocument {
	return {
		...source,
		id: request.copyProjectId,
		title: request.title || `${String(source.title || 'Untitled')} copy`,
		revision: 0,
		createdAt: request.timestamp,
		updatedAt: request.timestamp,
	};
}

function reachableVideoSources(project: ProjectDocument): readonly LinkedVideoOriginalSource[] {
	return reachableSources(project).filter(
		(source): source is LinkedVideoOriginalSource => source.kind === 'video',
	);
}

function reachableOriginalSources(project: ProjectDocument): readonly LinkedOriginalSource[] {
	return reachableSources(project);
}

function reachableSources(project: ProjectDocument): readonly LinkedOriginalSource[] {
	const sourceIds = collectProjectSourceIds(project) as Set<string>;
	if (sourceIds.size > MAXIMUM_REACHABLE_SOURCE_COUNT) {
		throw new RangeError('Project duplication source references exceed their limit.');
	}
	const sourceById = new Map<string, Readonly<Record<string, unknown>>>();
	for (const value of Array.isArray(project.sources) ? project.sources : []) {
		if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
		const source = value as Readonly<Record<string, unknown>>;
		if (typeof source.id !== 'string' || !source.id) continue;
		if (sourceById.has(source.id)) throw new Error('Project duplication source identities must be unique.');
		sourceById.set(source.id, source);
	}
	const sources: LinkedOriginalSource[] = [];
	for (const sourceId of sourceIds) {
		const source = sourceById.get(sourceId);
		if (!source) throw new ReferenceError(`Project duplication source ${sourceId} is missing.`);
		if (source.kind === 'audio' || source.kind === 'video') {
			sources.push(source as unknown as LinkedOriginalSource);
		}
	}
	return Object.freeze(sources);
}
