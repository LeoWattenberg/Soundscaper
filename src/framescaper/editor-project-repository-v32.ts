/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';
import { assertFramescaperProjectV32Profile } from './editor-project-runtime-profile-v32.ts';
import {
	cloneFramescaperProjectV32,
	loadFramescaperProjectV32,
	type FramescaperProjectV32,
} from './editor-project-v32.ts';

const REQUIRED_METHODS = Object.freeze([
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'delete',
] as const);

/** Exact-write V32 custody with proxy fencing and immutable image-body authority. */
export class FramescaperProjectRepositoryV32 implements ProjectRepositoryPort {
	readonly #profile: unknown;
	readonly #delegate: ProjectRepositoryPort;

	constructor(profile: unknown, delegateValue: ProjectRepositoryPort | unknown) {
		assertFramescaperProjectV32Profile(profile);
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
		if (currentValue === null) throw new Error('Ordinary V32 save cannot create a project.');
		const current = this.#exact(currentValue);
		await this.#assertPermittedAttachments(current, project);
		const saved = await this.#delegate.saveIfCurrent!(current, project, postCommit);
		if (saved === null) throw new Error('The V32 project changed before save.');
		return this.#exact(saved);
	}


	/**
	 * An image body is published atomically with the revision that introduces it,
	 * so a source the stored project no longer carries may still be one this
	 * project published earlier and an undo removed. Redoing that import
	 * re-references the same committed body rather than attaching a new one, and
	 * refusing it would wedge every later autosave. Only a body no stored
	 * revision ever carried is a genuinely new attachment.
	 */
	async #assertPermittedAttachments(
		expected: FramescaperProjectV32,
		project: FramescaperProjectV32,
	): Promise<void> {
		const introduced = unpublishedImageAttachments(expected, project);
		if (introduced.size === 0) return;
		const published = new Map<string, string>();
		for (const revision of await this.#delegate.listRevisions(project.id)) {
			let stored: FramescaperProjectV32;
			try { stored = this.#exact(revision.project); } catch { continue; }
			for (const [id, value] of imageAuthority(stored)) published.set(id, value);
		}
		for (const [id, value] of introduced) {
			if (published.get(id) !== value) {
				throw new Error('A new V32 image body requires atomic timeline-image publication.');
			}
		}
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		const expected = this.#exact(expectedValue);
		const project = this.#exact(projectValue);
		if (expected.id !== project.id) throw new Error('V32 compare-and-swap cannot change project identity.');
		await this.#assertPermittedAttachments(expected, project);
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

	#exact(value: unknown): FramescaperProjectV32 & ProjectDocument {
		return cloneFramescaperProjectV32(this.#profile, value) as FramescaperProjectV32 & ProjectDocument;
	}

	#optionalExact(value: ProjectDocument | null): ProjectDocument | null {
		return value === null ? null : this.#exact(value);
	}

	#custody(value: unknown): ProjectDocument {
		return loadFramescaperProjectV32(this.#profile, value).project as ProjectDocument;
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (!value || typeof value !== 'object') throw new TypeError('A V32 repository delegate is required.');
	for (const method of REQUIRED_METHODS) {
		if (typeof (value as Record<string, unknown>)[method] !== 'function') {
			throw new TypeError(`The V32 repository delegate requires ${method}.`);
		}
	}
}

function assertNoAttachments(project: FramescaperProjectV32, operation: string): void {
	if (proxyAuthority(project).size !== 0) {
		throw new Error(`A proxy-attached V32 ${operation} requires atomic preservation publication.`);
	}
	if (imageAuthority(project).size !== 0) {
		throw new Error(`A timeline-image V32 ${operation} requires atomic timeline-image publication.`);
	}
}

/**
 * The image sources a save introduces that the stored project does not carry.
 *
 * Changing the authority of a source that is already stored is always refused;
 * an unknown one is left for the caller to resolve against what this project
 * has published before.
 */
function unpublishedImageAttachments(
	expected: FramescaperProjectV32,
	project: FramescaperProjectV32,
): ReadonlyMap<string, string> {
	const beforeProxies = proxyAuthority(expected);
	const afterProxies = proxyAuthority(project);
	if (beforeProxies.size !== afterProxies.size
		|| [...beforeProxies].some(([id, value]) => afterProxies.get(id) !== value)) {
		throw new Error('Ordinary V32 save cannot introduce or change a proxy attachment.');
	}
	const beforeImages = imageAuthority(expected);
	const introduced = new Map<string, string>();
	for (const [id, value] of imageAuthority(project)) {
		if (!beforeImages.has(id)) {
			introduced.set(id, value);
			continue;
		}
		if (beforeImages.get(id) !== value) {
			throw new Error('Ordinary V32 save cannot change immutable image-body authority.');
		}
	}
	return introduced;
}

function proxyAuthority(project: FramescaperProjectV32): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind === 'video' && source.proxyAttachment !== null) {
			result.set(String(source.id), JSON.stringify(source.proxyAttachment));
		}
	}
	return result;
}

function imageAuthority(project: FramescaperProjectV32): ReadonlyMap<string, string> {
	const result = new Map<string, string>();
	for (const source of project.sources as readonly Readonly<Record<string, unknown>>[]) {
		if (source.kind !== 'image') continue;
		const { name: _name, ...authority } = source;
		result.set(String(source.id), JSON.stringify(authority));
	}
	return result;
}
