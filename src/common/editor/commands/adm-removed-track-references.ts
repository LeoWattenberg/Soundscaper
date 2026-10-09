/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAdmProjectMetadata, type AdmProjectMetadata } from '../adm-project-metadata.ts';
import type { AudioEditorCommand } from './protocol.ts';

interface AdmStripProject {
	readonly tracks: readonly Readonly<{ id: unknown }>[];
	readonly mixer?: Readonly<{
		groups?: readonly Readonly<{ id: unknown }>[];
		sends?: readonly Readonly<{ id: unknown }>[];
	}>;
	readonly metadata: Readonly<{ adm?: AdmProjectMetadata | null }>;
}

/** Products that elevate batch leaves defer dependency retirement to the complete tree. */
export function applyCommandTreeWithAdmCleanup<Project extends AdmStripProject, Options, Transaction>(
	project: Project,
	command: AudioEditorCommand,
	options: Options,
	transaction: Transaction,
	apply: (project: Project, command: AudioEditorCommand, options: Options, transaction: Transaction, validateResult: boolean) => Project,
): Project {
	const applied = apply(project, command, options, transaction, true);
	const adm = applied.metadata.adm;
	const survivingAdm = removeDeletedAdmStripReferences(adm, project, applied);
	return survivingAdm === adm ? applied : apply(applied, {
		type: 'metadata/update', changes: { adm: survivingAdm },
	}, options, transaction, true);
}

/** Atomic replacements retain their strip identity throughout the completed edit. */
export function removeDeletedAdmStripReferences(
	metadata: AdmProjectMetadata | null | undefined,
	before: AdmStripProject,
	after: AdmStripProject,
): AdmProjectMetadata | null | undefined {
	if (metadata?.mode !== 'authored') return metadata;
	const removed = {
		track: removedIds(before.tracks, after.tracks),
		group: removedIds(before.mixer?.groups ?? [], after.mixer?.groups ?? []),
		send: removedIds(before.mixer?.sends ?? [], after.mixer?.sends ?? []),
	};
	const survives = (reference: Readonly<{ stripKind: keyof typeof removed; stripId: string }>) => (
		!removed[reference.stripKind].has(reference.stripId)
	);
	const assignments = metadata.bed.assignments.filter(survives);
	const objects = (metadata.objects ?? []).filter(survives);
	if (assignments.length === metadata.bed.assignments.length
		&& objects.length === (metadata.objects?.length ?? 0)) return metadata;
	return normalizeAdmProjectMetadata({
		...metadata,
		bed: { ...metadata.bed, assignments },
		objects,
	});
}

function removedIds(before: readonly Readonly<{ id: unknown }>[], after: readonly Readonly<{ id: unknown }>[]): ReadonlySet<string> {
	const survivingIds = new Set(after.map(strip => String(strip.id)));
	return new Set(before.map(strip => String(strip.id)).filter(id => !survivingIds.has(id)));
}
