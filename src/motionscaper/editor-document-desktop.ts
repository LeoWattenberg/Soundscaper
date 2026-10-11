/* SPDX-License-Identifier: AGPL-3.0-only */

import { beginMotionscaperDesktopSave, motionscaperDesktopFiles, selectMotionscaperDesktopArchive } from './desktop-file-adapter.ts';
import type { MotionDesktopFiles } from './desktop-file-contract.ts';
import type { MotionscaperDocumentSession } from './editor-document-session.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { motionDocumentFileName } from './editor-document-file-name.ts';
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
	} catch (error) { await output.abort(); throw error; }
}

/** The open capability remains private and is bound only after a complete verified archive import. */
export async function openMotionscaperDesktopProject(session: MotionscaperDocumentSession,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(),
	onOpaque?: (archive: MotionscaperOpaqueArchive) => void | Promise<void>): Promise<'browser' | 'cancelled' | 'opened' | 'opaque'> {
	if (!files) return 'browser';
	const selected = await selectMotionscaperDesktopArchive(files);
	if (!selected) return 'cancelled';
	let retained = false;
	try {
		if (onOpaque) {
			const archive = await inspectMotionscaperOpaqueArchive(selected.input, selected.name, { release: selected.release });
			if (archive) { await onOpaque(archive); retained = true; return 'opaque'; }
		}
		await session.importArchive(selected.input);
		const project = session.getSnapshot().project;
		if (!project) throw new Error('The imported motion document is unavailable.');
		await selected.bind(project.id); return 'opened';
	} finally { if (!retained) await selected.release(); }
}
