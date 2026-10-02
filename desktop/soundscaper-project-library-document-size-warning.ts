/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { confirmDesktopFileSizeWarning, type DesktopSaveSizeWarning } from './save-size-warning-dialog.ts';
import { assertSoundscaperDesktopProjectLibraryPublicationLease, readSoundscaperDesktopProjectLibraryMetadataSnapshot } from './soundscaper-project-library-publication-persistence.ts';
import { SoundscaperDesktopProjectLibraryPublicationRefusal, type SoundscaperDesktopProjectLibraryPublicationPlan } from './soundscaper-project-library-publication-contract.ts';
import { assertSoundscaperDesktopFencedPublication, assertSoundscaperDesktopPublicationPreflight } from './soundscaper-project-library-write-fence.ts';
import type { DesktopProjectWriteFences } from './project-library-write-fence.ts';

const DOCUMENT_SIZE_WARNING_BYTES = 256 * 1024 * 1024;
export type SoundscaperDesktopDocumentSizeConfirmation = (warning: Readonly<DesktopSaveSizeWarning>) => Promise<boolean>;
interface ProjectDocument { readonly projectId: string; readonly name: string; readonly byteLength: number }
type ConditionalPublication = Readonly<{ fences: DesktopProjectWriteFences; token: string; expectedDocument: unknown }>;

/** Main remembers accepted byte bounds only for the lifetime of this library owner. */
export class SoundscaperDesktopDocumentSizeAdmission {
	readonly #admitted = new Map<string, number>();
	constructor(readonly confirm?: SoundscaperDesktopDocumentSizeConfirmation) {
		if (confirm !== undefined && typeof confirm !== 'function') throw new TypeError('Native document size confirmation must be a function.');
	}
	async admit(project: Readonly<ProjectDocument>, previous: readonly Readonly<ProjectDocument>[], assertCurrent: () => void): Promise<void> {
		assertCurrent();
		if (!Number.isSafeInteger(project.byteLength) || project.byteLength < 1) throw new RangeError('Project document bytes must be a positive safe integer.');
		const prior = previous.find((row) => row.projectId === project.projectId)?.byteLength ?? 0;
		if (project.byteLength <= Math.max(DOCUMENT_SIZE_WARNING_BYTES, prior, this.#admitted.get(project.projectId) ?? 0)) return;
		await confirmDesktopFileSizeWarning({ fileName: project.name, byteLength: project.byteLength,
			thresholdBytes: DOCUMENT_SIZE_WARNING_BYTES }, this.confirm, assertCurrent);
		this.#admitted.set(project.projectId, project.byteLength);
	}
}

/** Revalidate lease, exact predecessor, cancellation and fence around the native dialog. */
export function soundscaperDocumentPublicationGuard(database: DatabaseSync, plan: Readonly<SoundscaperDesktopProjectLibraryPublicationPlan>,
	now: () => number, signal?: AbortSignal, conditional?: ConditionalPublication): () => void {
	return () => {
		signal?.throwIfAborted();
		assertSoundscaperDesktopProjectLibraryPublicationLease(database, plan.lease, now());
		const project = plan.bundle.project;
		assertSoundscaperDesktopPublicationPreflight(database, project.projectId, project.projectRevision);
		if (readSoundscaperDesktopProjectLibraryMetadataSnapshot(database).metadata.revision !== plan.expectedMetadataRevision) {
			throw new SoundscaperDesktopProjectLibraryPublicationRefusal('compare-and-swap', 'Project metadata changed during document size admission.');
		}
		if (conditional) {
			if (!plan.expectedProject) throw new TypeError('Fenced publication requires an exact predecessor.');
			assertSoundscaperDesktopFencedPublication(database, conditional.fences, project.projectId,
				conditional.token, conditional.expectedDocument, plan.expectedProject.projectRevision);
		}
	};
}
