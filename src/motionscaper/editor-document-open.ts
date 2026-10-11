/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { aggregateScapeErrors } from '../common/editor/scape-abort.ts';
import type { MotionscaperDocumentSession } from './editor-document-session.ts';
import type { MotionArchiveOpenAction, MotionArchiveOpenReceipt, MotionArchiveReview } from './editor-document-import.ts';
export interface MotionscaperDocumentOpen {
	readonly review: MotionArchiveReview; readonly fileName: string;
	accepted(): MotionArchiveOpenReceipt | null;
	open(action: MotionArchiveOpenAction): Promise<MotionArchiveOpenReceipt>;
	close(): Promise<void>;
}
export class MotionArchiveAdoptionError extends Error {
	readonly receipt: MotionArchiveOpenReceipt;
	constructor(receipt: MotionArchiveOpenReceipt, cause: unknown) {
		super('The project was opened, but native file binding or cleanup failed. Retry completion or close this review; do not import it again.', { cause });
		this.name = 'MotionArchiveAdoptionError'; this.receipt = receipt;
	}
}
/** Retains the selected capability across review; successful adoption is never repeated to retry cleanup. */
export async function prepareMotionscaperDocumentOpen(session: MotionscaperDocumentSession, input: ScapeProjectInput, fileName: string,
	options: Readonly<{ bindOriginal?: (projectId: string) => Promise<void>; release?: () => Promise<void> }> = {}): Promise<MotionscaperDocumentOpen> {
	let review: MotionArchiveReview;
	try { review = await session.inspectArchive(input); }
	catch (error) {
		try { await options.release?.(); } catch (cleanup) { throw aggregateScapeErrors(error, [cleanup], 'Motion archive inspection and capability release failed.'); }
		throw error;
	}
	let accepted: MotionArchiveOpenReceipt | null = null, bound = false, released = false, closed = false;
	let active: Promise<MotionArchiveOpenReceipt> | null = null, closing: Promise<void> | null = null;
	const release = async () => { if (!released) { await options.release?.(); released = true; } };
	return Object.freeze({ review, fileName, accepted: () => accepted,
		open(action: MotionArchiveOpenAction) {
			if (closed) return Promise.reject(new Error('The archive review is closed.'));
			if (active) return Promise.reject(new Error('The archive review is still opening.'));
			if (accepted && action !== accepted.action) return Promise.reject(new Error('This archive action was already accepted; retry its completion.'));
			active = (async () => {
				try { accepted ??= await session.openArchive(review, action); }
				catch (error) { accepted = session.acceptedArchive(review); if (accepted) throw new MotionArchiveAdoptionError(accepted, error); throw error; }
				try {
					await session.completeArchiveOpen(review);
					if (accepted.bindOriginal && !bound) { await options.bindOriginal?.(accepted.projectId); bound = true; }
					await release(); closed = true; return accepted;
				} catch (error) { throw new MotionArchiveAdoptionError(accepted, error); }
			})().finally(() => { active = null; }); return active;
		},
		close() {
			if (closing) return closing; closed = true; session.closeArchiveReview(review);
			closing = (async () => { await active?.catch(() => undefined); await session.completeArchiveOpen(review); await release(); })().finally(() => { closing = null; }); return closing;
		},
	});
}
