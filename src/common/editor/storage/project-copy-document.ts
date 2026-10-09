/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectDocument } from './project-repository.ts';
import { duplicatedAdmRevision } from './project-duplication-adm.ts';

/** Give a copied document its own project identity while retaining its authored media identities. */
export function createProjectCopyDocument(
	source: ProjectDocument,
	request: Readonly<{ id: string; title?: unknown; timestamp: string }>,
): ProjectDocument {
	return {
		...source,
		...copiedMulticameraOwnership(source, request.id),
		id: request.id,
		title: request.title || `${String(source.title || 'Untitled')} copy`,
		...duplicatedAdmRevision(source),
		createdAt: request.timestamp,
		updatedAt: request.timestamp,
	};
}

function copiedMulticameraOwnership(source: ProjectDocument, projectId: string): Readonly<Record<string, unknown>> {
	const groups = source.multicameraGroups;
	if (source.schemaFamily !== 'framescaper' || !Array.isArray(groups) || !groups.length) return {};
	return { multicameraGroups: groups.map((group: unknown) => (
		isRecord(group) && group.projectId === source.id ? { ...group, projectId } : group
	)) };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
