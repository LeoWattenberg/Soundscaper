/* SPDX-License-Identifier: AGPL-3.0-only */

import { ProjectDuplicationIndeterminateError } from './project-duplication.ts';
import type { ProjectDocument, ProjectRepositoryPort } from './project-repository.ts';

interface ExactProjectShadow extends ProjectRepositoryPort {
	createIfAbsent?(project: ProjectDocument): Promise<ProjectDocument | null>;
	deleteIfCurrent?(project: ProjectDocument): Promise<boolean>;
}

interface DesktopProjectDuplicationBridge {
	readSharedProject(projectId: string): Promise<string | null>;
	commitSharedProject(canonicalDocument: string): Promise<string>;
}

interface DesktopSharedProjectDuplicationOptions {
	readonly bridge: DesktopProjectDuplicationBridge;
	readonly shadow: ExactProjectShadow;
	readonly parseDocument: (document: string, label: string) => ProjectDocument;
	readonly serializeDocument: (project: ProjectDocument) => string;
}

/** Owns exact local compensation around a remote shared-project create. */
export class DesktopSharedProjectDuplication {
	readonly #bridge: DesktopProjectDuplicationBridge;
	readonly #parseDocument: DesktopSharedProjectDuplicationOptions['parseDocument'];
	readonly #serializeDocument: DesktopSharedProjectDuplicationOptions['serializeDocument'];
	readonly #shadow: ExactProjectShadow;

	constructor(options: DesktopSharedProjectDuplicationOptions) {
		this.#bridge = options.bridge;
		this.#shadow = options.shadow;
		this.#parseDocument = options.parseDocument;
		this.#serializeDocument = options.serializeDocument;
	}

	async loadProject(projectId: string): Promise<ProjectDocument | null> {
		const document = await this.#readCanonicalDocument(projectId, 'duplication source');
		return document === null ? null : this.#parseDocument(document, 'duplication source');
	}

	async createIfAbsent(project: ProjectDocument): Promise<ProjectDocument | null> {
		const expectedDocument = this.#serializeDocument(project);
		if (await this.#readCanonicalDocument(String(project.id), 'duplication destination') !== null) return null;
		const create = this.#shadow.createIfAbsent;
		if (typeof create !== 'function') {
			throw new Error('Desktop shared project duplication storage is unavailable.');
		}
		const snapshot = await create.call(this.#shadow, project);
		if (!snapshot) return null;
		if (snapshot.id !== project.id || snapshot.revision !== project.revision) {
			return this.#rollbackLocal(snapshot, new Error(
				'Desktop shared project duplication shadow changed the project identity or revision.',
			));
		}
		let document: string;
		try { document = this.#serializeDocument(snapshot); }
		catch (error) { return this.#rollbackLocal(snapshot, error); }
		if (document !== expectedDocument) {
			return this.#rollbackLocal(snapshot, new Error(
				'Desktop shared project duplication shadow changed the exact document.',
			));
		}
		let primary: unknown;
		try {
			const acknowledgement = await this.#bridge.commitSharedProject(document);
			this.#parseDocument(acknowledgement, 'duplication acknowledgement');
			if (acknowledgement !== document) {
				throw new Error('Desktop shared project duplication acknowledgement does not match the local snapshot.');
			}
			return snapshot;
		} catch (error) { primary = error; }
		return this.#recoverCreate(snapshot, document, primary);
	}

	async #recoverCreate(
		snapshot: ProjectDocument,
		document: string,
		primary: unknown,
	): Promise<ProjectDocument> {
		const projectId = String(snapshot.id);
		let remote: string | null;
		try { remote = await this.#readCanonicalDocument(projectId, 'duplication recovery'); }
		catch (recoveryError) {
			throw indeterminate(projectId, primary, recoveryError);
		}
		if (remote === document) return snapshot;
		if (remote !== null) {
			throw indeterminate(projectId, primary, new Error(
				'The desktop shared project changed before duplication recovery completed.',
			));
		}
		return this.#rollbackLocal(snapshot, primary);
	}

	async #rollbackLocal(snapshot: ProjectDocument, primary: unknown): Promise<never> {
		try {
			const remove = this.#shadow.deleteIfCurrent;
			if (typeof remove !== 'function' || !await remove.call(this.#shadow, snapshot)) {
				throw new Error('The exact desktop shared project shadow changed before rollback.');
			}
		} catch (cleanupError) {
			throw indeterminate(String(snapshot.id), primary, cleanupError);
		}
		throw primary;
	}

	async #readCanonicalDocument(projectId: string, label: string): Promise<string | null> {
		const document = await this.#bridge.readSharedProject(projectId);
		if (document === null) return null;
		const project = this.#parseDocument(document, label);
		if (project.id !== projectId) {
			throw new Error(`Desktop shared project ${label} identity does not match its catalog key.`);
		}
		return document;
	}
}

function indeterminate(projectId: string, primary: unknown, recovery: unknown): ProjectDuplicationIndeterminateError {
	return new ProjectDuplicationIndeterminateError(projectId, new AggregateError(
		[primary, recovery],
		'Desktop shared project duplication outcome could not be recovered exactly.',
	));
}
