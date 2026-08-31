/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectDocument,
	ProjectLoadOptions,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
	ProjectRevision,
} from '../common/editor/storage/project-repository.ts'
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts'
import {
	cloneSoundscaperProject,
	loadSoundscaperProject,
	type SoundscaperProject,
} from './editor-project.ts'

const REQUIRED_DELEGATE_METHODS = [
	'createIfAbsent', 'createForScapeImportIfAbsent', 'save', 'saveIfCurrent',
	'load', 'list', 'listRevisions', 'delete', 'restore', 'restoreIfCurrent',
] as const

type ProjectRestorationSnapshot = Readonly<{
	readonly current: ProjectDocument | null
	readonly revisions: readonly ProjectRevision[]
}>

/** Validate and detach every document crossing the baseline persistence boundary. */
export class SoundscaperProjectRepository implements ProjectRepositoryPort {
	readonly #delegate: ProjectRepositoryPort
	readonly #creationCapabilities = new WeakMap<object, ProjectDocument>()

	constructor(delegateValue: ProjectRepositoryPort | unknown) {
		assertDelegate(delegateValue)
		this.#delegate = delegateValue
	}

	async createIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		return this.#creationSnapshot(await this.#delegate.createIfAbsent!(this.#snapshot(projectValue)))
	}

	async createForScapeImportIfAbsent(projectValue: ProjectDocument): Promise<ProjectDocument | null> {
		return this.#creationSnapshot(
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

	async restore(projectId: string, snapshot: ProjectRestorationSnapshot): Promise<void> {
		await this.#delegate.restore!(projectId, this.#restorationSnapshot(snapshot))
	}

	restoreIfCurrent(
		projectId: string,
		expectedValue: ProjectDocument,
		snapshot: ProjectRestorationSnapshot,
	): Promise<boolean> {
		return this.#delegate.restoreIfCurrent!(
			projectId,
			this.#snapshot(expectedValue),
			this.#restorationSnapshot(snapshot),
		)
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
		const project = await this.#delegate.load(projectId, options)
		return project === null ? null : this.#custody(project)
	}

	async list(): Promise<ProjectDocument[]> {
		return (await this.#delegate.list()).map((project) => this.#custody(project))
	}

	async listRevisions(projectId: string): Promise<ProjectRevision[]> {
		return (await this.#delegate.listRevisions(projectId)).map((revision) => ({
			revision: revision.revision,
			project: this.#custody(revision.project),
		}))
	}

	async deleteIfCurrent(projectValue: ProjectDocument): Promise<boolean> {
		if (typeof this.#delegate.deleteIfCurrent !== 'function') return false
		const snapshot = this.#snapshot(projectValue)
		const capability = this.#creationCapabilities.get(projectValue)
		if (!capability || !sameProjectSnapshot(snapshot, capability)) return false
		const deleted = await this.#delegate.deleteIfCurrent(capability)
		if (deleted) this.#creationCapabilities.delete(projectValue)
		return deleted
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

	#creationSnapshot(project: ProjectDocument | null): ProjectDocument | null {
		if (project === null) return null
		const snapshot = this.#snapshot(project)
		this.#creationCapabilities.set(snapshot, project)
		return snapshot
	}

	#restorationSnapshot(snapshot: ProjectRestorationSnapshot): ProjectRestorationSnapshot {
		return {
			current: this.#optionalSnapshot(snapshot.current),
			revisions: snapshot.revisions.map(({ revision, project }) => ({
				revision,
				project: this.#snapshot(project),
			})),
		}
	}

	#snapshot(project: ProjectDocument | unknown): SoundscaperProject & ProjectDocument {
		return cloneSoundscaperProject(project) as SoundscaperProject & ProjectDocument
	}

	#custody(project: ProjectDocument | unknown): ProjectDocument {
		return loadSoundscaperProject(project).project as ProjectDocument
	}
}
function assertDelegate(value: unknown): asserts value is ProjectRepositoryPort {
	if (!value || typeof value !== 'object') {
		throw new TypeError('A Soundscaper baseline project repository delegate is required.')
	}
	const delegate = value as Record<string, unknown>
	for (const method of REQUIRED_DELEGATE_METHODS) {
		if (typeof delegate[method] !== 'function') {
			throw new TypeError(`The Soundscaper baseline project repository delegate requires ${method}.`)
		}
	}
}
