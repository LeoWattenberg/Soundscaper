/* SPDX-License-Identifier: AGPL-3.0-only */

import { beginMotionscaperDesktopSave, motionscaperDesktopFiles, selectMotionscaperDesktopArchive, type MotionDesktopArchiveInput } from './desktop-file-adapter.ts';
import type { MotionDesktopFiles } from './desktop-file-contract.ts';
import type { MotionscaperDocumentSession } from './editor-document-session.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { motionDocumentFileName } from './editor-document-file-name.ts';
import { aggregateScapeErrors } from '../common/editor/scape-abort.ts';
import { MotionProjectConflictError } from './editor-project-store.ts';
import { prepareMotionscaperDocumentOpen, type MotionscaperDocumentOpen } from './editor-document-open.ts';
import { exportMotionscaperArchive } from './editor-scape.ts';
import { inspectMotionscaperOpaqueArchive, type MotionscaperOpaqueArchive } from './editor-opaque-archive.ts';

/** False cancels publication. The local saved pointer advances only after native atomic commit. */
export async function writeMotionscaperDesktopProject(project: MotionscaperProject, store: Pick<MotionscaperProjectStore, 'readAsset'>,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(), saveCopy = false, assertCurrent?: () => Promise<void>): Promise<boolean> {
	if (!files) return true;
	await assertCurrent?.();
	const output = await beginMotionscaperDesktopSave(files, { projectId: project.id, suggestedName: motionDocumentFileName(project.title),
		...(saveCopy ? { saveAs: true, saveCopy: true } : {}) });
	if (!output) return false;
	try {
		await exportMotionscaperArchive(project, (asset) => store.readAsset(asset), { writable: output.writable });
		await assertCurrent?.();
		await output.commit(); return true;
	} catch (error) {
		try { await output.abort(); } catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Motion archive save and cleanup failed.'); }
		throw error;
	}
}

/** The open capability remains private and is bound only after a complete verified archive import. */
export async function openMotionscaperDesktopProject(session: MotionscaperDocumentSession,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(),
	onOpaque?: (archive: MotionscaperOpaqueArchive) => void | Promise<void>,
	onReview?: (pending: MotionscaperDocumentOpen) => void | Promise<void>): Promise<'browser' | 'cancelled' | 'opened' | 'opaque' | 'review'> {
	if (!files) return 'browser';
	const selected = await selectMotionscaperDesktopArchive(files);
	if (!selected) return 'cancelled';
	return openMotionscaperDesktopArchiveSelection(session, selected, onOpaque, onReview);
}

export async function openMotionscaperDesktopArchiveSelection(session: MotionscaperDocumentSession, selected: MotionDesktopArchiveInput,
	onOpaque?: (archive: MotionscaperOpaqueArchive) => void | Promise<void>,
	onReview?: (pending: MotionscaperDocumentOpen) => void | Promise<void>): Promise<'opened' | 'opaque' | 'review'> {
	let retained = false, failed = false; let failure: unknown; let result: 'opened' | 'opaque' | 'review' | undefined;
	const inspect = async (): Promise<'opened' | 'opaque' | 'review'> => {
		if (onOpaque) {
			const archive = await inspectMotionscaperOpaqueArchive(selected.input, selected.name, { release: selected.release });
			if (archive) { await onOpaque(archive); retained = true; return 'opaque'; }
		}
		const pending = await prepareMotionscaperDocumentOpen(session, selected.input, selected.name, { bindOriginal: selected.bind, release: selected.release });
		if (onReview) { retained = true; await onReview(pending); return 'review'; }
		if (pending.review.existing) { await pending.close(); throw new MotionProjectConflictError(); }
		await pending.open('import'); return 'opened';
	};
	try { result = await inspect(); } catch (error) { failed = true; failure = error; }
	if (!retained) {
		try { await selected.release(); } catch (cleanup) { throw failed ? aggregateScapeErrors(failure, [cleanup], 'Motion archive open and capability release failed.') : cleanup; }
	}
	if (failed) throw failure; return result!;
}
