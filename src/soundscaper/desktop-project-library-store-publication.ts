/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import { MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES } from '../common/editor/project-publication-admission.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import { serializeScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { admitProjectPublication, projectPublicationWarningOptions, type ProjectPublicationStore } from '../common/editor/storage/project-publication-options.ts';
import { snapshotSoundscaperDesktopProject } from './desktop-project-library-renderer-contract.ts';
import { createSoundscaperDesktopDocumentApproval } from './desktop-project-library-publication-warning.ts';

/** Transfer a successful store decision only to this operation's exact desktop document. */
export async function admitSoundscaperDesktopStorePublication(
	store: ProjectPublicationStore,
	profile: EditorProjectRuntimeProfile,
	project: unknown,
	optionsValue: unknown = {},
): Promise<Readonly<FileSizeWarningOptions>> {
	const options = projectPublicationWarningOptions(optionsValue);
	const snapshot = snapshotSoundscaperDesktopProject(profile, project);
	const storeDocument = serializeScapeProjectDocument(snapshot.project);
	const storeBytes = storeDocument === snapshot.document ? snapshot.byteLength : new TextEncoder().encode(storeDocument).byteLength;
	await admitProjectPublication(store, snapshot.project, optionsValue);
	if (snapshot.byteLength > storeBytes) {
		await confirmFileSizeWarning(snapshot.byteLength, MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES, 'Project document', options);
	}
	options.signal?.throwIfAborted(); options.assertCurrent?.();
	return createSoundscaperDesktopDocumentApproval(profile, snapshot, options);
}
