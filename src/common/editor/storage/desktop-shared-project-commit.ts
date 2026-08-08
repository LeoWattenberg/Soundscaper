/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDocument } from './project-repository.ts';

export interface DesktopSharedProjectCommitRequest {
	readonly document: string;
	readonly expectedRevision: number | null;
}

export type DesktopSharedProjectCommitResult =
	| Readonly<{ status: 'committed'; document: string }>
	| Readonly<{ status: 'conflict'; currentRevision: number }>;

export interface DesktopSharedProjectCommitBridge {
	commitSharedProject(request: DesktopSharedProjectCommitRequest): Promise<DesktopSharedProjectCommitResult>;
}

/** Renderer-private authoritative revision witness; it never carries main-owned digests. */
export class DesktopSharedProjectRevisionWitness {
	readonly #revisions = new Map<string, number>();

	expectedRevision(projectId: string): number | null {
		return this.#revisions.get(projectId) ?? null;
	}

	observe(project: Pick<ProjectDocument, 'id' | 'revision'>): void {
		if (typeof project.id !== 'string' || !Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
			throw new TypeError('Desktop shared project revision witness is invalid.');
		}
		this.#revisions.set(project.id, Number(project.revision));
	}

	forget(projectId: string): void {
		this.#revisions.delete(projectId);
	}
}

export class DesktopSharedProjectConflictError extends Error {
	readonly currentRevision: number;

	constructor(currentRevision: number) {
		super(`Desktop shared project changed at revision ${currentRevision}; reload before saving again.`);
		this.name = 'DesktopSharedProjectConflictError';
		this.currentRevision = currentRevision;
	}
}

export function committedDocument(
	value: DesktopSharedProjectCommitResult,
): string {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Desktop shared project commit result is invalid.');
	}
	if (value.status === 'conflict') {
		if (!Number.isSafeInteger(value.currentRevision) || value.currentRevision < 0) {
			throw new TypeError('Desktop shared project conflict revision is invalid.');
		}
		throw new DesktopSharedProjectConflictError(value.currentRevision);
	}
	if (value.status !== 'committed' || typeof value.document !== 'string') {
		throw new TypeError('Desktop shared project commit result is invalid.');
	}
	return value.document;
}
