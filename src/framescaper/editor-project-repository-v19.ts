/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts';
import { assertFramescaperProjectV19Profile } from './editor-project-v19-profile.ts';
import {
	cloneFramescaperProjectV19,
	type FramescaperProjectV19,
} from './editor-project-v19.ts';

const REQUIRED_DELEGATE_METHODS = [
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent', 'load', 'list', 'listRevisions', 'delete',
] as const;

/**
 * Preserve existing V18 proxy attachment authority during ordinary V19
 * persistence. Only the atomic preservation path may introduce or change it.
 */
export class FramescaperProjectRepositoryV19 implements ProjectRepositoryPort {
	readonly #profile: EditorProjectRuntimeProfile;
	readonly #delegate: ProjectRepositoryPort;

	constructor(
		profile: EditorProjectRuntimeProfile | unknown,
		delegateValue: ProjectRepositoryPort | unknown,
	) {
		assertFramescaperProjectV19Profile(profile);
		assertDelegate(delegateValue);
		this.#profile = profile;
		this.#delegate = delegateValue;
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#snapshot(projectValue);
		if (attachmentAuthority(project).size !== 0) {
			throw new Error(
				'An attached V19 project requires an atomic preservation plan; '
				+ 'ordinary create cannot introduce a proxy attachment.',
			);
		}
		return this.#delegate.createIfAbsent!(project);
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		const project = this.#snapshot(projectValue);
		if (attachmentAuthority(project).size !== 0) {
			throw new Error('An attached V19 Scape import requires an atomic preservation plan.');
		}
		return this.#delegate.createForScapeImportIfAbsent!(project);
	}

	async save(
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		const project = this.#snapshot(projectValue);
		const currentValue = await this.#delegate.load(project.id);
		if (currentValue === null) {
			throw new Error('Ordinary V19 save cannot create a project; use create-only publication.');
		}
		const current = this.#snapshot(currentValue);
		assertSameAttachmentAuthority(current, project);
		const saved = await this.#delegate.saveIfCurrent!(current, project, postCommit);
		if (saved === null) {
			throw new Error('The V19 project changed before its ordinary save could be published.');
		}
		return saved;
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		const expected = this.#snapshot(expectedValue);
		const project = this.#snapshot(projectValue);
		if (expected.id !== project.id) throw new Error('V19 compare-and-swap cannot change project identity.');
		assertSameAttachmentAuthority(expected, project);
		return this.#delegate.saveIfCurrent!(expected, project, postCommit);
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
		return this.#delegate.load(projectId, options);
	}

	async list(): Promise<ProjectDocument[]> { return this.#delegate.list(); }

	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return this.#delegate.listRevisions(projectId);
	}

	async deleteIfCurrent(project: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteIfCurrent !== 'function') return false;
		return this.#delegate.deleteIfCurrent(project);
	}

	async deleteExact(project: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteExact !== 'function') return false;
		return this.#delegate.deleteExact(this.#snapshot(project));
	}

	async delete(projectId: string): Promise<void> { await this.#delegate.delete(projectId); }

	#snapshot(project: ProjectDocument | unknown): FramescaperProjectV19 & ProjectDocument {
		return cloneFramescaperProjectV19(
			this.#profile,
			project,
		) as FramescaperProjectV19 & ProjectDocument;
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (value === null || typeof value !== 'object') {
		throw new TypeError('A project repository delegate is required.');
	}
	const delegate = value as Record<string, unknown>;
	for (const method of REQUIRED_DELEGATE_METHODS) {
		if (typeof delegate[method] !== 'function') {
			throw new TypeError(`The project repository delegate requires ${method}.`);
		}
	}
}

function assertSameAttachmentAuthority(
	expected: FramescaperProjectV19,
	project: FramescaperProjectV19,
): void {
	const before = attachmentAuthority(expected);
	const after = attachmentAuthority(project);
	if (before.size !== after.size) throwAttachmentMutation();
	for (const [sourceId, identity] of before) {
		if (after.get(sourceId) !== identity) throwAttachmentMutation();
	}
}

function attachmentAuthority(project: FramescaperProjectV19): ReadonlyMap<string, string> {
	const authority = new Map<string, string>();
	for (const source of project.sources) {
		if (source.kind !== 'video' || source.proxyAttachment === null) continue;
		authority.set(String(source.id), JSON.stringify(source.proxyAttachment));
	}
	return authority;
}

function throwAttachmentMutation(): never {
	throw new Error(
		'Ordinary V19 save cannot introduce or change a proxy attachment; use an atomic preservation plan.',
	);
}
