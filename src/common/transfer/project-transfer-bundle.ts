/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Bulk movement of a set of projects between two first-party stores, carried
 * as ordinary .scape archives.
 *
 * The module is deliberately transport-agnostic: it knows nothing about
 * postMessage, files, the DOM, downloads, or origins, and it never imports the
 * archive implementation. Both the archive functions and the stores are
 * injected, so the same code serves the manual bulk export/import and the
 * automatic popup handshake.
 *
 * Two failure classes are kept apart on purpose:
 *   - Admission refusals (bounds, shapes, shared memory) are structural: the
 *     transport handed over something outside the admitted domain, so the run
 *     stops fail-closed at that entry and admits nothing after it.
 *   - Archive failures (an unreadable or rejected .scape) concern one entry
 *     only. They are recorded and the run continues to the next entry.
 *
 * Stopping never destroys the evidence of what already happened. A request
 * whose own shape is inadmissible still throws, because nothing has been
 * written when that is decided; a run that has already written projects
 * returns its records with the stop named on the result instead, so the page
 * can always tell the visitor which projects landed.
 */

import { throwIfScapeAborted } from '../editor/scape-abort.ts';
import {
	isAcceptedProjectFileExtension,
	withProjectFileExtension,
} from '../project-file-extensions.ts';
import {
	boundCrossProductHandoffArchiveFileName,
	createCrossProductHandoffReportSidecar,
} from './cross-product-handoff-report-sidecar.ts';
import {
	crossProductHandoffProvenanceMatchesReport,
	readCrossProductHandoffProvenance,
} from './cross-product-handoff-provenance.ts';
import {
	admitProjectTransferBytes,
	admitProjectTransferEntry,
	admitProjectTransferExportRequest,
	admitProjectTransferImportRequest,
	admittedProjectTransferId,
	admittedProjectTransferTitle,
	asProjectTransferRecord,
	describeProjectTransferError,
	projectTransferEntryLimitRefusal,
	projectTransferFileName,
	projectTransferImportResult,
	projectTransferImportStop,
	ProjectTransferRefusalError,
	PROJECT_TRANSFER_ENTRY_MIME_TYPE,
	selectProjectTransferProjects,
	witnessProjectTransferWrites,
	type AdmittedProjectTransferEntry,
	type AdmittedProjectTransferExportRequest,
	type AdmittedProjectTransferImportRequest,
	type ProjectTransferEntry,
	type ProjectTransferArchiveExportResult,
	type ProjectTransferExportEvent,
	type ProjectTransferExportRequest,
	type ProjectTransferImportRecord,
	type ProjectTransferImportRequest,
	type ProjectTransferImportResult,
	type ProjectTransferImportStore,
	type ProjectTransferProject,
} from './project-transfer-bundle-admission.ts';

export {
	PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRIES,
	PROJECT_TRANSFER_DEFAULT_MAXIMUM_ENTRY_BYTES,
	PROJECT_TRANSFER_ENTRY_EXTENSION,
	PROJECT_TRANSFER_ENTRY_MIME_TYPE,
	ProjectTransferRefusalError,
} from './project-transfer-bundle-admission.ts';
export type {
	ProjectTransferArchiveExport,
	ProjectTransferArchiveImport,
	ProjectTransferArchiveInspect,
	ProjectTransferEntry,
	ProjectTransferExportEvent,
	ProjectTransferExportRequest,
	ProjectTransferExportStore,
	ProjectTransferFailureCode,
	ProjectTransferImportRecord,
	ProjectTransferImportRequest,
	ProjectTransferImportResult,
	ProjectTransferImportStop,
	ProjectTransferImportStore,
	ProjectTransferProgress,
	ProjectTransferProject,
	ProjectTransferRefusalCode,
	ProjectTransferSkipReasonCode,
	ProjectTransferStopCode,
	ProjectTransferWriteWitness,
} from './project-transfer-bundle-admission.ts';

/**
 * Export the selected projects one at a time, yielding each finished archive
 * before the next export begins so a large library never materializes at once.
 */
export async function* exportProjectTransferBundle(
	request: ProjectTransferExportRequest,
): AsyncGenerator<ProjectTransferExportEvent, void> {
	const admitted = admitProjectTransferExportRequest(request);
	const { onProgress, signal, store } = admitted;
	throwIfScapeAborted(signal);
	const listed = await store.listProjects();
	if (!Array.isArray(listed)) {
		throw new ProjectTransferRefusalError('store-contract', 'A project store must list projects as an array.');
	}
	const selected = selectProjectTransferProjects(listed, admitted.select, admitted.maximumEntries);
	const total = selected.length;
	let exported = 0;
	let failed = 0;
	for (let index = 0; index < total; index += 1) {
		const project = selected[index];
		throwIfScapeAborted(signal);
		const title = admittedProjectTransferTitle(project.title);
		onProgress?.(Object.freeze({
			stage: 'export' as const, completed: index, total, projectId: project.id, title,
		}));
		let entry: ProjectTransferEntry;
		try {
			entry = await exportOneProject(project, admitted);
		} catch (error) {
			throwIfScapeAborted(signal);
			failed += 1;
			yield Object.freeze({
				kind: 'failed' as const,
				index,
				total,
				projectId: project.id,
				title,
				code: error instanceof ProjectTransferRefusalError ? error.code : null,
				reason: describeProjectTransferError(error),
			});
			continue;
		}
		exported += 1;
		yield Object.freeze({ kind: 'entry' as const, index, total, entry });
	}
	throwIfScapeAborted(signal);
	onProgress?.(Object.freeze({
		stage: 'export' as const, completed: total, total, projectId: null, title: null,
	}));
	yield Object.freeze({ kind: 'summary' as const, total, exported, failed });
}

async function exportOneProject(
	project: ProjectTransferProject,
	admitted: AdmittedProjectTransferExportRequest,
): Promise<ProjectTransferEntry> {
	const { maximumEntryBytes, signal } = admitted;
	const result = await admitted.exportProject(project, admitted.store, {
		...(signal ? { signal } : {}),
		maximumBlobBytes: maximumEntryBytes,
	});
	const blob = result?.blob;
	if (!(blob instanceof Blob)) {
		throw new TypeError('The .scape export did not produce an archive blob.');
	}
	if (blob.size > maximumEntryBytes) {
		throw new ProjectTransferRefusalError('entry-too-large',
			`The .scape archive for ${project.id} is ${blob.size} bytes, over the ${maximumEntryBytes} byte entry limit.`);
	}
	const bytes = new Uint8Array(await blob.arrayBuffer());
	admitProjectTransferBytes(bytes, maximumEntryBytes, `The .scape archive for ${project.id}`);
	const exportedIdentity = result as ProjectTransferArchiveExportResult;
	const projectId = exportedIdentity.projectId === undefined
		? project.id : admittedProjectTransferId(exportedIdentity.projectId);
	if (!projectId) {
		throw new ProjectTransferRefusalError('store-contract',
			'The archive exporter returned an invalid converted project identity.');
	}
	const title = exportedIdentity.title === undefined
		? admittedProjectTransferTitle(project.title) ?? projectId
		: admittedProjectTransferTitle(exportedIdentity.title) ?? projectId;
	const defaultFileName = projectTransferFileName(title, projectId);
	let fileName = exportedIdentity.fileExtension === undefined
		? defaultFileName
		: isAcceptedProjectFileExtension(exportedIdentity.fileExtension)
			? withProjectFileExtension(defaultFileName, exportedIdentity.fileExtension)
			: (() => { throw new ProjectTransferRefusalError('store-contract',
				'The archive exporter returned an invalid product project-file extension.'); })();
	let conversionReportSidecar = null;
	if (exportedIdentity.conversionReport !== undefined) {
		try {
			fileName = boundCrossProductHandoffArchiveFileName(fileName);
			conversionReportSidecar = createCrossProductHandoffReportSidecar({
				entryId: projectId,
				archive: bytes,
				report: exportedIdentity.conversionReport,
			});
		} catch (error) {
			throw new ProjectTransferRefusalError('store-contract',
				`The archive exporter returned an invalid conversion report: ${describeProjectTransferError(error)}`);
		}
	}
	return Object.freeze({
		projectId,
		title,
		fileName,
		mimeType: PROJECT_TRANSFER_ENTRY_MIME_TYPE,
		byteLength: bytes.byteLength,
		bytes,
		conversionReportSidecar,
	});
}

/**
 * Import a stream of admitted entries. Each entry is inspected before it is
 * imported, so a project already present is skipped rather than duplicated,
 * and a failing entry is contained: a project this entry is proven to have
 * written is removed before the run moves on.
 *
 * The result comes back whether the run finished or stopped early. Entries
 * imported before a stop are already in the receiving store, so their records
 * are owed to the caller either way: `stopped` names the refusal or the abort
 * that ended the run, and `completed` separates that from a run that consumed
 * every entry it was offered.
 */
export async function importProjectTransferBundle(
	request: ProjectTransferImportRequest,
): Promise<ProjectTransferImportResult> {
	const admitted = admitProjectTransferImportRequest(request);
	const { maximumEntries, onProgress, signal } = admitted;
	const records: ProjectTransferImportRecord[] = [];
	let index = 0;
	try {
		for await (const raw of admitted.entries) {
			throwIfScapeAborted(signal);
			if (index >= maximumEntries) throw projectTransferEntryLimitRefusal(maximumEntries);
			const entry = admitProjectTransferEntry(raw, admitted.maximumEntryBytes, index);
			onProgress?.(Object.freeze({
				stage: 'import' as const,
				completed: index,
				total: null,
				projectId: entry.projectId,
				title: entry.title,
			}));
			records.push(await importOneEntry(entry, index, admitted));
			index += 1;
		}
		throwIfScapeAborted(signal);
	} catch (error) {
		// Only an admission refusal or an abort stops a run. Anything else is a
		// broken seam rather than a decision, and is not this module's to absorb.
		const stopped = projectTransferImportStop(error, index, signal);
		if (!stopped) throw error;
		return projectTransferImportResult(records, stopped);
	}
	onProgress?.(Object.freeze({
		stage: 'import' as const, completed: index, total: index, projectId: null, title: null,
	}));
	return projectTransferImportResult(records, null);
}

async function importOneEntry(
	entry: AdmittedProjectTransferEntry,
	index: number,
	admitted: AdmittedProjectTransferImportRequest,
): Promise<ProjectTransferImportRecord> {
	const { signal, store } = admitted;
	const byteLength = entry.bytes.byteLength;
	let inspected: Record<string, unknown>;
	try {
		inspected = asProjectTransferRecord(await admitted.inspectProject(
			admitted.toArchiveInput(entry.bytes), store, {
				...(signal ? { signal } : {}),
				...(entry.conversionReportSidecar === null ? {} : { canonicalProjectDigest: true }),
			},
		));
	} catch (error) {
		throwIfScapeAborted(signal);
		return transferRecord({
			index, outcome: 'failed', projectId: entry.projectId, title: entry.title, byteLength,
			reasonCode: 'archive-unreadable', reason: describeProjectTransferError(error), residue: 'none',
		});
	}
	// Identity is the archive's own project document id, as reported by
	// inspectScapeProject().id — exactly the id importScapeProject() would
	// persist and collide on. `exists` is inspect's own store.loadProject(id)
	// probe against the receiving store, so the skip decision is taken on the
	// same identity the import itself would use.
	const projectId = admittedProjectTransferId(inspected.id);
	const title = admittedProjectTransferTitle(inspected.title) ?? entry.title;
	if (!projectId) {
		return transferRecord({
			index, outcome: 'failed', projectId: entry.projectId, title, byteLength,
			reasonCode: 'archive-identity',
			reason: 'The .scape archive did not report a project identity.',
			residue: 'none',
		});
	}
	if (entry.conversionReportSidecar !== null
		&& entry.conversionReportSidecar.entryId !== projectId) {
		return transferRecord({
			index, outcome: 'failed', projectId, title, byteLength,
			reasonCode: 'archive-identity',
			reason: 'The conversion report sidecar names a different project than the archive.',
			residue: 'none',
		});
	}
	if (entry.conversionReportSidecar !== null
		&& (!inspected.featureRequirementsCompatibility
			|| typeof inspected.featureRequirementsCompatibility !== 'object'
			|| (inspected.featureRequirementsCompatibility as Record<string, unknown>).compatible !== true)) {
		return transferRecord({
			index, outcome: 'failed', projectId, title, byteLength,
			reasonCode: 'archive-identity',
			reason: 'The conversion destination is not independently feature-compatible and editable.',
			residue: 'none',
		});
	}
	if (entry.conversionReportSidecar !== null
		&& inspected.projectCanonicalSha256 !== entry.conversionReportSidecar.report.destination?.sha256) {
		return transferRecord({
			index, outcome: 'failed', projectId, title, byteLength,
			reasonCode: 'archive-identity',
			reason: 'The conversion report does not describe the exact project document in its archive.',
			residue: 'none',
		});
	}
	if (entry.conversionReportSidecar !== null
		&& (inspected.schemaFamily !== entry.conversionReportSidecar.report.destination?.schemaFamily
			|| inspected.schemaVersion !== entry.conversionReportSidecar.report.destination?.schemaVersion
			|| !crossProductHandoffProvenanceMatchesReport(
				inspected.projectCrossProductHandoffProvenance,
				entry.conversionReportSidecar.report,
			)
			|| !conversionDestinationRootsMatch(
				entry.conversionReportSidecar.report,
				inspected.projectCanonicalRootSha256,
			))) {
		return transferRecord({
			index, outcome: 'failed', projectId, title, byteLength,
			reasonCode: 'archive-identity',
			reason: 'The conversion report destination identity or root digests do not match its archive.',
			residue: 'none',
		});
	}
	if (inspected.exists === true) {
		if (entry.conversionReportSidecar !== null
			&& !crossProductHandoffProvenanceMatchesReport(
				inspected.existingProjectCrossProductHandoffProvenance,
				entry.conversionReportSidecar.report,
			)) {
			return transferRecord({
				index, outcome: 'failed', projectId, title, byteLength,
				reasonCode: 'archive-identity',
				reason: 'The existing project does not match this conversion retry.',
				residue: 'none',
			});
		}
		return transferRecord({
			index, outcome: 'skipped', projectId, title, byteLength,
			reasonCode: 'already-present',
			reason: 'A project with this identity is already present in the receiving store.',
			residue: 'none',
			...recognizedConversionReport(entry),
		});
	}
	if (inspected.readOnly === true) {
		return transferRecord({
			index, outcome: 'skipped', projectId, title, byteLength,
			reasonCode: 'archive-read-only',
			reason: admittedProjectTransferTitle(inspected.reason)
				?? 'The .scape archive opens read-only in this build.',
			residue: 'none',
		});
	}
	return importAdmittedArchive(entry, index, admitted, { projectId, title, byteLength });
}

function recognizedConversionReport(
	entry: AdmittedProjectTransferEntry,
): Readonly<{ conversionReport: ProjectTransferImportRecord['conversionReport'] }> {
	return Object.freeze({ conversionReport: entry.conversionReportSidecar?.report ?? null });
}

function conversionDestinationRootsMatch(
	report: NonNullable<AdmittedProjectTransferEntry['conversionReportSidecar']>['report'],
	value: unknown,
): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const digests = value as Readonly<Record<string, unknown>>;
	return report.roots.every(({ root, destinationSha256 }) => {
		const destinationOwnsRoot = Object.hasOwn(digests, root);
		return destinationSha256 === null
			? !destinationOwnsRoot
			: destinationOwnsRoot && digests[root] === destinationSha256;
	});
}

async function importAdmittedArchive(
	entry: AdmittedProjectTransferEntry,
	index: number,
	admitted: AdmittedProjectTransferImportRequest,
	identity: Readonly<{ projectId: string; title: string | null; byteLength: number }>,
): Promise<ProjectTransferImportRecord> {
	const { signal, store } = admitted;
	const { byteLength, projectId, title } = identity;
	// The import writes through this facade, so whatever the receiving store
	// publishes for this identity is observed as it is published. That
	// observation is the only authorship evidence the residue guard can act on.
	const witness = witnessProjectTransferWrites(store, projectId);
	try {
		// `collision: 'cancel'` keeps the run idempotent under a race: a project
		// that appears between inspect and import refuses instead of landing a copy.
		const result = asProjectTransferRecord(await admitted.importProject(
			admitted.toArchiveInput(entry.bytes), witness.store,
			{ ...(signal ? { signal } : {}), collision: 'cancel' },
		));
		if (result.readOnly === true) {
			return transferRecord({
				index, outcome: 'skipped', projectId, title, byteLength,
				reasonCode: 'archive-read-only',
				reason: admittedProjectTransferTitle(result.reason)
					?? 'The .scape archive opens read-only in this build.',
				residue: 'none',
			});
		}
		const imported = asProjectTransferRecord(result.project);
		if (entry.conversionReportSidecar !== null
			&& !crossProductHandoffProvenanceMatchesReport(
				readCrossProductHandoffProvenance(imported),
				entry.conversionReportSidecar.report,
			)) {
			throw new Error('The imported editable copy did not retain its closed invocation provenance.');
		}
		return transferRecord({
			index,
			outcome: 'imported',
			projectId: admittedProjectTransferId(imported.id) ?? projectId,
			title: admittedProjectTransferTitle(imported.title) ?? title,
			byteLength,
			reasonCode: null,
			reason: null,
			residue: 'none',
			...recognizedConversionReport(entry),
		});
	} catch (error) {
		throwIfScapeAborted(signal);
		const cleanup = await clearTransferResidue(store, projectId, witness.created(), signal);
		return transferRecord({
			index, outcome: 'failed', projectId, title, byteLength,
			reasonCode: 'import-failed',
			reason: `${describeProjectTransferError(error)}${cleanup.note}`,
			residue: cleanup.residue,
		});
	}
}

/**
 * A failed import must leave the receiving store as it was for that entry, and
 * it must do so without ever removing a project this entry did not write.
 *
 * A probe cannot establish authorship. Finding the id absent before the import
 * and occupied after it proves only that something wrote there in between, and
 * the receiving origin has other writers: another tab autosaving, a second
 * receive popup, a file import the visitor started by hand. Deleting on that
 * reasoning destroys their work, and the case is not hypothetical — it is
 * exactly what `collision: 'cancel'` exists to detect, so the very race that
 * makes the import fail is the race that makes a blind delete wrong.
 *
 * The proof used instead is the store's own. A create-only publication hands
 * back the exact document it stored; witnessProjectTransferWrites() retains
 * that document as the import produces it; deleteProjectIfCurrent() removes it
 * only while the store still holds that same value. Both halves are needed:
 * the witness attributes the write to this entry, and the compare-and-delete
 * keeps the removal exact against anything that replaced the row afterwards —
 * it reports false and removes nothing instead. A store offering neither
 * cannot attribute the project to anybody, so the project stays and the record
 * says so. An unproven project is worth more than a tidy store.
 */
async function clearTransferResidue(
	store: ProjectTransferImportStore,
	projectId: string,
	created: unknown,
	signal: AbortSignal | undefined,
): Promise<{ residue: 'none' | 'cleared' | 'retained'; note: string }> {
	let present: unknown;
	try {
		present = await store.loadProject(projectId, { ...(signal ? { signal } : {}) });
	} catch (error) {
		return {
			residue: 'retained',
			note: ` The receiving store could not be checked for residue: ${describeProjectTransferError(error)}`,
		};
	}
	if (!present) return { residue: 'none', note: '' };
	if (!created) {
		return {
			residue: 'retained',
			note: ' A project is present at this identity, but this transfer cannot prove it wrote it, so it was kept.',
		};
	}
	if (typeof store.deleteProjectIfCurrent !== 'function') {
		return {
			residue: 'retained',
			note: ' The project this transfer created was kept: the receiving store cannot delete an exact document.',
		};
	}
	let removed: unknown;
	try {
		removed = await store.deleteProjectIfCurrent(created);
	} catch (error) {
		return {
			residue: 'retained',
			note: ` The project this transfer created could not be removed: ${describeProjectTransferError(error)}`,
		};
	}
	if (removed !== true) {
		return {
			residue: 'retained',
			note: ' The project at this identity is no longer the project this transfer created, so it was kept.',
		};
	}
	return { residue: 'cleared', note: ' The project this transfer created was removed.' };
}

function transferRecord(
	record: Omit<ProjectTransferImportRecord, 'conversionReport'>
		& Partial<Pick<ProjectTransferImportRecord, 'conversionReport'>>,
): ProjectTransferImportRecord {
	return Object.freeze({ ...record, conversionReport: record.conversionReport ?? null });
}
