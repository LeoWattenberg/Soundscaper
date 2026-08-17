/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts'
import {
	cloneSoundscaperProjectV23,
	type SoundscaperProjectV23,
} from './editor-project-v23.ts'

const REQUIRED_DELEGATE_METHODS = [
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'delete',
] as const

/** Validate and detach every document crossing the selected V23 persistence boundary. */
export class SoundscaperProjectRepositoryV23 implements ProjectRepositoryPort {
	readonly #delegate: ProjectRepositoryPort

	constructor(delegateValue: ProjectRepositoryPort | unknown) {
		assertDelegate(delegateValue)
		this.#delegate = delegateValue
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		return this.#optionalSnapshot(await this.#delegate.createIfAbsent!(this.#snapshot(projectValue)))
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		return this.#optionalSnapshot(
			await this.#delegate.createForScapeImportIfAbsent!(this.#snapshot(projectValue)),
		)
	}

	async save(
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument> {
		return this.#snapshot(await this.#delegate.save(this.#snapshot(projectValue), postCommit))
	}

	async saveIfCurrent(
		expectedValue: ProjectDocument,
		projectValue: ProjectDocument,
		postCommit?: ProjectPostCommitMaintenance,
	): Promise<ProjectDocument | null> {
		return this.#optionalSnapshot(await this.#delegate.saveIfCurrent!(
			this.#snapshot(expectedValue),
			this.#snapshot(projectValue),
			postCommit,
		))
	}

	async maintainCurrentProject(
		projectId: string,
		maintenance: ProjectPostCommitMaintenance,
	): Promise<void> {
		if (typeof this.#delegate.maintainCurrentProject === 'function') {
			await this.#delegate.maintainCurrentProject(projectId, maintenance)
			return
		}
		await maintenance()
	}

	async load(projectId: string, options?: ProjectLoadOptions): Promise<ProjectDocument | null> {
		return this.#optionalSnapshot(await this.#delegate.load(projectId, options))
	}

	async list(): Promise<ProjectDocument[]> {
		return (await this.#delegate.list()).map((project) => this.#snapshot(project))
	}

	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return (await this.#delegate.listRevisions(projectId)).map((revision) => ({
			revision: revision.revision,
			project: this.#snapshot(revision.project),
		}))
	}

	async deleteIfCurrent(projectValue: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteIfCurrent !== 'function') return false
		return this.#delegate.deleteIfCurrent(this.#snapshot(projectValue))
	}

	async deleteExact(projectValue: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteExact !== 'function') return false
		return this.#delegate.deleteExact(this.#snapshot(projectValue))
	}

	async delete(projectId: string): Promise<void> {
		await this.#delegate.delete(projectId)
	}

	#optionalSnapshot(project: ProjectDocument | null): ProjectDocument | null {
		return project === null ? null : this.#snapshot(project)
	}

	#snapshot(project: ProjectDocument | unknown): SoundscaperProjectV23 & ProjectDocument {
		return cloneSoundscaperProjectV23(project) as SoundscaperProjectV23 & ProjectDocument
	}
}

function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A Soundscaper V23 project repository delegate is required.')
	}
	const delegate = value as Record<string, unknown>
	for (const method of REQUIRED_DELEGATE_METHODS) {
		if (typeof delegate[method] !== 'function') {
			throw new TypeError(`The Soundscaper V23 project repository delegate requires ${method}.`)
		}
	}
}
