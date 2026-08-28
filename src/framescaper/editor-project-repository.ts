/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';
import {
	cloneFramescaperProject,
	loadFramescaperProject,
	type FramescaperProject,
} from './editor-project.ts';
import { assertFramescaperProjectRuntimeProfile } from './editor-project-runtime-profile.ts';

const REQUIRED_METHODS = Object.freeze([
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'restore', 'delete',
] as const);

/** Exact-write Framescaper v1 repository with opaque foreign/future custody. */
export class FramescaperProjectRepository implements ProjectRepositoryPort {
	readonly #profile: unknown;
	readonly #delegate: ProjectRepositoryPort;

	constructor(profile: unknown, delegateValue: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectRuntimeProfile(profile);
		assertDelegate(delegateValue);
		this.#profile = profile;
		this.#delegate = delegateValue;
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		assertNoBodyAttachments(project, 'create');
		return this.#optionalExact(await this.#delegate.createIfAbsent!(project));
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#exact(projectValue);
		assertNoBodyAttachments(project, 'Scape import');
		return this.#optionalExact(await this.#delegate.createForScapeImportIfAbsent!(project));
	}

	async save(
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		const project = this.#exact(projectValue);
		const currentValue = await this.#delegate.load(project.id);
		if (currentValue === null) throw new Error('Ordinary Framescaper save cannot create a project.');
		const current = this.#exact(currentValue);
		assertSameBodyAttachments(current, project);
		const saved = await this.#delegate.saveIfCurrent!(current, project, postCommit);
		if (saved === null) throw new Error('The Framescaper project changed before save.');
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
			throw new Error('Framescaper compare-and-swap cannot change project identity.');
		}
		assertSameBodyAttachments(expected, project);
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

	async restore(projectId: string, snapshot: Readonly<{
		readonly current: ProjectDocument | null;
		readonly revisions: readonly Readonly<{
			readonly revision: number;
			readonly project: ProjectDocument;
		}>[];
	}>): Promise<void> {
		if (typeof projectId !== 'string' || !projectId || !snapshot || typeof snapshot !== 'object'
			|| !Array.isArray(snapshot.revisions)) {
			throw new TypeError('An exact Framescaper project snapshot is required.');
		}
		const current = snapshot.current === null ? null : this.#exact(snapshot.current);
		if (current && current.id !== projectId) {
			throw new Error('The Framescaper restore current document changed project identity.');
		}
		const seen = new Set<number>();
		const revisions = snapshot.revisions.map((entry) => {
			if (!entry || !Number.isSafeInteger(entry.revision) || entry.revision < 0
				|| seen.has(entry.revision)) {
				throw new TypeError('The Framescaper restore revision inventory is invalid.');
			}
			seen.add(entry.revision);
			const project = this.#exact(entry.project);
			if (project.id !== projectId || project.revision !== entry.revision) {
				throw new Error('The Framescaper restore revision changed its document identity.');
			}
			return Object.freeze({ revision: entry.revision, project: project as ProjectDocument });
		});
		await this.#delegate.restore!(projectId, Object.freeze({
			current: current as ProjectDocument | null,
			revisions: Object.freeze(revisions),
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

	#exact(value: unknown): FramescaperProject & ProjectDocument {
		return cloneFramescaperProject(this.#profile, value) as FramescaperProject & ProjectDocument;
	}

	#optionalExact(value: ProjectDocument | null): ProjectDocument | null {
		return value === null ? null : this.#exact(value);
	}

	#custody(value: unknown): ProjectDocument {
		return loadFramescaperProject(this.#profile, value).project as ProjectDocument;
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A Framescaper repository delegate is required.');
	}
	for (const method of REQUIRED_METHODS) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The Framescaper repository delegate requires ${method}.`);
		}
	}
}

function assertNoBodyAttachments(project: FramescaperProject, operation: string): void {
	if (proxyAuthority(project).size !== 0) {
		throw new Error(`A proxy-attached Framescaper ${operation} requires atomic preservation publication.`);
	}
	if (imageAuthority(project).size !== 0) {
		throw new Error(`A timeline-image Framescaper ${operation} requires atomic timeline-image publication.`);
	}
}

function assertSameBodyAttachments(expected: FramescaperProject, project: FramescaperProject): void {
	const before = proxyAuthority(expected);
	const after = proxyAuthority(project);
	if (before.size !== after.size || [...before].some(([id, value]) => after.get(id) !== value)) {
		throw new Error('Ordinary Framescaper save cannot introduce or change a proxy attachment.');
	}
	const beforeImages = imageAuthority(expected);
	for (const [id, value] of imageAuthority(project)) {
		if (!beforeImages.has(id)) {
			throw new Error('A new Framescaper image body requires atomic timeline-image publication.');
		}
		if (beforeImages.get(id) !== value) {
			throw new Error('Ordinary Framescaper save cannot change immutable image-body authority.');
		}
	}
}

function proxyAuthority(project: FramescaperProject): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			result.set(String(source.id), JSON.stringify(source.proxyAttachment));
		}
	}
	return result;
}

function imageAuthority(project: FramescaperProject): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind !== 'image') continue;
		const { name: _name, ...authority } = source;
		result.set(String(source.id), JSON.stringify(authority));
	}
	return result;
}
