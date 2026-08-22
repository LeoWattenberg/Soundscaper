/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';

const REQUIRED_DELEGATE_METHODS = Object.freeze([
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'delete',
] as const);

export interface FramescaperCandidateProjectRepositoryDefinition {
	readonly label: string;
	readonly profile: unknown;
	readonly authenticate: (profile: unknown) => void;
	readonly cloneExact: (profile: unknown, project: unknown) => ProjectDocument;
	readonly load: (profile: unknown, project: unknown) => Readonly<{
		readonly project: ProjectDocument | Readonly<Record<string, unknown>>;
		readonly readOnly: boolean;
	}>;
}

/** Exact-write, future-opaque repository shared by dormant candidate generations. */
export class FramescaperCandidateProjectRepository implements ProjectRepositoryPort {
	readonly generation: string;
	readonly #profile: unknown;
	readonly #delegate: ProjectRepositoryPort;
	readonly #definition: FramescaperCandidateProjectRepositoryDefinition;

	constructor(
		definition: FramescaperCandidateProjectRepositoryDefinition,
		delegateValue: ProjectRepositoryPort | unknown,
	) {
		definition.authenticate(definition.profile);
		assertDelegate(delegateValue);
		this.generation = definition.label;
		this.#profile = definition.profile;
		this.#delegate = delegateValue;
		this.#definition = definition;
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		return this.#optionalExact(await this.#delegate.createIfAbsent!(project));
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		return this.#optionalExact(await this.#delegate.createForScapeImportIfAbsent!(project));
	}

	async save(
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		const project = this.#exact(projectValue);
		const currentValue = await this.#delegate.load(project.id);
		if (currentValue === null) {
			throw new Error(`Ordinary ${this.generation} save cannot create a project.`);
		}
		const current = this.#exact(currentValue);
		const saved = await this.#delegate.saveIfCurrent!(current, project, postCommit);
		if (saved === null) throw new Error(`The ${this.generation} project changed before save.`);
		return this.#exact(saved);
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		const expected = this.#exact(expectedValue);
		const project = this.#exact(projectValue);
		if (expected.id !== project.id) {
			throw new Error(`${this.generation} compare-and-swap cannot change project identity.`);
		}
		return this.#optionalExact(
			await this.#delegate.saveIfCurrent!(expected, project, postCommit),
		);
	}

	async maintainCurrentProject(
		projectId: string,
		maintenance: ProjectPostCommitMaintenance,
	): Promise<void> {
		if (typeof this.#delegate.maintainCurrentProject === 'function') {
			await this.#delegate.maintainCurrentProject(projectId, maintenance);
			return;
		}
		await maintenance();
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

	#exact(value: unknown): ProjectDocument {
		return this.#definition.cloneExact(this.#profile, value);
	}

	#custody(value: unknown): ProjectDocument {
		const loaded = this.#definition.load(this.#profile, value);
		return loaded.project as ProjectDocument;
	}

	#optionalExact(value: ProjectDocument | null): ProjectDocument | null {
		return value === null ? null : this.#exact(value);
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (value === null || typeof value !== 'object') {
		throw new TypeError('A candidate project repository delegate is required.');
	}
	const delegate = value as Readonly<Record<string, unknown>>;
	for (const method of REQUIRED_DELEGATE_METHODS) {
		if (typeof delegate[method] !== 'function') {
			throw new TypeError(`The candidate project repository delegate requires ${method}.`);
		}
	}
}
