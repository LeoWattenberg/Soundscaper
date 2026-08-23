/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';
import {
	cloneFramescaperProjectV27,
	loadFramescaperProjectV27,
	type FramescaperProjectV27,
} from './editor-project-v27.ts';
import { assertFramescaperProjectV27Profile } from './editor-project-runtime-profile-v27.ts';

const REQUIRED_METHODS = Object.freeze([
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'delete',
] as const);

/** Exact-write V27 repository with opaque V25/V26/future custody and proxy fencing. */
export class FramescaperProjectRepositoryV27 implements ProjectRepositoryPort {
	readonly #profile: unknown;
	readonly #delegate: ProjectRepositoryPort;

	constructor(profile: unknown, delegateValue: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV27Profile(profile);
		assertDelegate(delegateValue);
		this.#profile = profile;
		this.#delegate = delegateValue;
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		assertNoAttachments(project, 'create');
		return this.#optionalExact(await this.#delegate.createIfAbsent!(project));
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		assertNoAttachments(project, 'Scape import');
		return this.#optionalExact(await this.#delegate.createForScapeImportIfAbsent!(project));
	}

	async save(
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		const project = this.#exact(projectValue);
		const currentValue = await this.#delegate.load(project.id);
		if (currentValue === null) throw new Error('Ordinary V27 save cannot create a project.');
		const current = this.#exact(currentValue);
		assertSameAttachments(current, project);
		const saved = await this.#delegate.saveIfCurrent!(current, project, postCommit);
		if (saved === null) throw new Error('The V27 project changed before save.');
		return this.#exact(saved);
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		const expected = this.#exact(expectedValue);
		const project = this.#exact(projectValue);
		if (expected.id !== project.id) throw new Error('V27 compare-and-swap cannot change project identity.');
		assertSameAttachments(expected, project);
		return this.#optionalExact(await this.#delegate.saveIfCurrent!(expected, project, postCommit));
	}

	async maintainCurrentProject(
		projectId: string,
		maintenance: ProjectPostCommitMaintenance,
	): Promise<void> {
		if (typeof this.#delegate.maintainCurrentProject === 'function') {
			await this.#delegate.maintainCurrentProject(projectId, maintenance);
		} else await maintenance();
	}

	async load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		const value = await this.#delegate.load(projectId, options);
		return value === null ? null : this.#custody(value);
	}

	async list(): Promise<ProjectDocument[]> {
		return (await this.#delegate.list()).map((project) => this.#custody(project));
	}

	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return (await this.#delegate.listRevisions(projectId)).map((entry) => ({
			revision: entry.revision,
			project: this.#custody(entry.project),
		}));
	}

	async deleteIfCurrent(projectValue: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteIfCurrent !== 'function') return false;
		return this.#delegate.deleteIfCurrent(this.#exact(projectValue));
	}

	async deleteExact(projectValue: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteExact !== 'function') return false;
		return this.#delegate.deleteExact(this.#exact(projectValue));
	}

	async delete(projectId: string): Promise<void> { await this.#delegate.delete(projectId); }

	#exact(value: unknown): FramescaperProjectV27 & ProjectDocument {
		return cloneFramescaperProjectV27(this.#profile, value) as FramescaperProjectV27 & ProjectDocument;
	}

	#optionalExact(value: ProjectDocument | null): ProjectDocument | null {
		return value === null ? null : this.#exact(value);
	}

	#custody(value: unknown): ProjectDocument {
		return loadFramescaperProjectV27(this.#profile, value).project as ProjectDocument;
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (!value || typeof value !== 'object') throw new TypeError('A V27 repository delegate is required.');
	for (const method of REQUIRED_METHODS) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The V27 repository delegate requires ${method}.`);
		}
	}
}

function assertNoAttachments(project: FramescaperProjectV27, operation: string): void {
	if (attachmentAuthority(project).size !== 0) {
		throw new Error(`A proxy-attached V27 ${operation} requires atomic preservation publication.`);
	}
}

function assertSameAttachments(expected: FramescaperProjectV27, project: FramescaperProjectV27): void {
	const before = attachmentAuthority(expected);
	const after = attachmentAuthority(project);
	if (before.size !== after.size || [...before].some(([id, value]) => after.get(id) !== value)) {
		throw new Error('Ordinary V27 save cannot introduce or change a proxy attachment.');
	}
}

function attachmentAuthority(project: FramescaperProjectV27): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			result.set(String(source.id), JSON.stringify(source.proxyAttachment));
		}
	}
	return result;
}
