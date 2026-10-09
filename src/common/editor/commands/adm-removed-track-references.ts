/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeAdmProjectMetadata, type AdmProjectMetadata } from '../adm-project-metadata.ts';
import type { AudioEditorCommand } from './protocol.ts';

interface AdmTrackProject {
	readonly tracks: readonly Readonly<{ id: unknown }>[];
	readonly metadata: Readonly<{ adm?: AdmProjectMetadata | null }>;
}

/** Products that elevate batch leaves defer dependency retirement to the complete tree. */
export function applyCommandTreeWithAdmCleanup<Project extends AdmTrackProject, Options, Transaction>(
	project: Project,
	command: AudioEditorCommand,
	options: Options,
	transaction: Transaction,
	apply: (project: Project, command: AudioEditorCommand, options: Options, transaction: Transaction, validateResult: boolean) => Project,
): Project {
	const applied = apply(project, command, options, transaction, true);
	const adm = applied.metadata.adm;
	const survivingAdm = removeDeletedAdmTrackReferences(adm, project.tracks.map(track => track.id), applied.tracks.map(track => track.id));
	return survivingAdm === adm ? applied : apply(applied, {
		type: 'metadata/update', changes: { adm: survivingAdm },
	}, options, transaction, true);
}

/** Atomic replacements retain their track identity throughout the completed edit. */
export function removeDeletedAdmTrackReferences(
	metadata: AdmProjectMetadata | null | undefined,
	beforeTrackIds: readonly unknown[],
	afterTrackIds: readonly unknown[],
): AdmProjectMetadata | null | undefined {
	if (metadata?.mode !== 'authored') return metadata;
	const survivingIds = new Set(afterTrackIds.map(String));
	return removeAdmTrackReferences(metadata, new Set(beforeTrackIds.map(String)
		.filter(trackId => !survivingIds.has(trackId))));
}

/** Retire only signal references whose owning tracks are removed by this edit. */
function removeAdmTrackReferences(
	metadata: AdmProjectMetadata | null | undefined,
	removedTrackIds: ReadonlySet<string>,
): AdmProjectMetadata | null | undefined {
	if (metadata?.mode !== 'authored') return metadata;
	const survives = (reference: Readonly<{ stripKind: string; stripId: string }>) => (
		reference.stripKind !== 'track' || !removedTrackIds.has(reference.stripId)
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
