/* SPDX-License-Identifier: AGPL-3.0-only */
import { digestScapeBytes } from '../common/editor/scape-archive-media.ts';
import { freezeMotionValue, motionDigest, motionId, motionRecord } from '../common/editor/motion-values.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { createFramescaperSuccessorHistory, normalizeFramescaperSuccessorHistory, type FramescaperSuccessorHistory } from './editor-project-successor-history.ts';

export interface FramescaperCompositionLinkOwnerRecord {
	readonly id: string; readonly project: FramescaperSuccessorProject;
	readonly history: FramescaperSuccessorHistory; readonly ownerDigest: string;
}
export function createFramescaperLinkOwnerRecord(projectValue: unknown, historyValue?: unknown): FramescaperCompositionLinkOwnerRecord {
	const project = normalizeFramescaperSuccessorProject(projectValue);
	const history = historyValue === undefined ? createFramescaperSuccessorHistory(project) : normalizeFramescaperSuccessorHistory(historyValue);
	if (JSON.stringify(history.present) !== JSON.stringify(project)) throw new RangeError('Owner project differs from its validated history present.');
	if ([...history.undoStack, ...history.redoStack].some(({ project: entry }) => entry.id !== project.id)) throw new RangeError('Owner history crosses project identities.');
	const text = JSON.stringify({ project, history });
	// Refuse before allocating the additional UTF-8 digest buffer.
	let length = 0;
	for (const character of text) {
		const code = character.codePointAt(0)!; length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
		if (length > 64 * 1024 * 1024) throw new RangeError('Owner intent exceeds its 64 MiB metadata budget.');
	}
	const bytes = new TextEncoder().encode(text);
	if (bytes.length > 64 * 1024 * 1024) throw new RangeError('Owner intent exceeds its 64 MiB metadata budget.');
	return freezeMotionValue({ id: project.id, project, history, ownerDigest: digestScapeBytes(bytes) });
}
export function normalizeFramescaperLinkOwnerRecord(value: unknown): FramescaperCompositionLinkOwnerRecord {
	const record = motionRecord(value, ['id', 'project', 'history', 'ownerDigest'], 'Framescaper linked owner');
	if (record.history === undefined) throw new RangeError('Stored owner must retain its exact history.');
	const expected = createFramescaperLinkOwnerRecord(record.project, record.history);
	if (motionId(record.id) !== expected.id || motionDigest(record.ownerDigest) !== expected.ownerDigest) throw new RangeError('Owner identity or digest differs from its exact intent.'); return expected;
}
