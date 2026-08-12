/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	committedDocument,
	DesktopSharedProjectConflictError,
	type DesktopSharedProjectCommitBridge,
} from './desktop-shared-project-commit.ts';
import { serializeScapeProjectDocument } from '../scape-project-document.ts';
import type {
	ProjectDocument,
	ProjectPostCommitMaintenance,
	ProjectRepositoryPort,
} from './project-repository.ts';

export interface DesktopSharedProjectCompareAndSwapDependencies {
	readonly bridge: DesktopSharedProjectCommitBridge;
	readonly shadow: ProjectRepositoryPort;
	readonly expected: ProjectDocument;
	readonly project: ProjectDocument;
	readonly expectedDocument: string;
	readonly projectDocument: string;
	readonly postCommit?: ProjectPostCommitMaintenance;
	readAuthoritativeDocument(): Promise<string | null>;
	observe(project: ProjectDocument): void;
}

/** Publish remotely first, then advance the local shadow only after exact acknowledgement. */
export async function publishDesktopSharedProjectIfCurrent(
	dependencies: DesktopSharedProjectCompareAndSwapDependencies,
): Promise<ProjectDocument | null> {
	const authoritative = await dependencies.readAuthoritativeDocument();
	if (authoritative === null || authoritative !== dependencies.expectedDocument) return null;
	let acknowledgement: string;
	try {
		acknowledgement = committedDocument(await dependencies.bridge.commitSharedProject({
			document: dependencies.projectDocument,
			expectedRevision: revision(dependencies.expected),
		}));
	} catch (error) {
		if (error instanceof DesktopSharedProjectConflictError) return null;
		throw error;
	}
	if (acknowledgement !== dependencies.projectDocument) {
		throw new Error('Desktop shared project acknowledgement does not match the compare-and-swap target.');
	}
	const snapshot = await saveShadowIfCurrent(dependencies);
	if (!snapshot || document(snapshot) !== dependencies.projectDocument) {
		throw new Error('Desktop shared project shadow rejected the acknowledged compare-and-swap target.');
	}
	dependencies.observe(snapshot);
	await dependencies.postCommit?.();
	return snapshot;
}

async function saveShadowIfCurrent(
	dependencies: DesktopSharedProjectCompareAndSwapDependencies,
): Promise<ProjectDocument | null> {
	const saveIfCurrent = dependencies.shadow.saveIfCurrent;
	if (!saveIfCurrent) throw new Error('Exact desktop shared project shadow compare-and-swap is unavailable.');
	return saveIfCurrent.call(dependencies.shadow, dependencies.expected, dependencies.project);
}

function revision(project: ProjectDocument): number {
	if (!Number.isSafeInteger(project.revision) || Number(project.revision) < 0) {
		throw new TypeError('Desktop shared project compare-and-swap revision is invalid.');
	}
	return Number(project.revision);
}

function document(project: ProjectDocument): string {
	return serializeScapeProjectDocument(project);
}
