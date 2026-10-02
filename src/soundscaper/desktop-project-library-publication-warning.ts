/* SPDX-License-Identifier: AGPL-3.0-only */

import { confirmFileSizeWarning, type FileSizeWarningOptions } from '../common/editor/controller/shared/file-size-warning.ts';
import { MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES } from '../common/editor/project-publication-admission.ts';
import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import type { SoundscaperProject } from './editor-project-validation.ts';
import { snapshotSoundscaperDesktopProject } from './desktop-project-library-renderer-contract.ts';
import { allowedRecord, abortSignal } from './desktop-project-library-renderer-validation.ts';

export interface SoundscaperDesktopRendererPublication extends FileSizeWarningOptions {
	readonly project: SoundscaperProject;
	readonly document: string;
	readonly documentByteLength: number;
	readonly documentSha256: string;
	readonly signal?: AbortSignal;
	readonly writeFence?: string;
	readonly expectedDocument?: SoundscaperProject;
}

const WARNING_FIELDS = ['signal', 'confirmFileSizeWarning', 'assertCurrent'] as const;
const DOCUMENT_APPROVALS = new WeakMap<NonNullable<FileSizeWarningOptions['confirmFileSizeWarning']>, Readonly<{
	profile: EditorProjectRuntimeProfile; sha256: string; byteLength: number; options: FileSizeWarningOptions;
}>>();

export function soundscaperDesktopPublicationWarningOptions(value: unknown = {}): FileSizeWarningOptions {
	const raw = allowedRecord(value, [], WARNING_FIELDS, 'Soundscaper desktop publication options');
	return validatedOptions(raw);
}

/** Snapshot one closed request before the serialized renderer publication queue. */
export function rendererPublicationRequest(
	profile: EditorProjectRuntimeProfile,
	value: unknown,
): Readonly<SoundscaperDesktopRendererPublication> {
	const raw = allowedRecord(value, ['project'], WARNING_FIELDS, 'Soundscaper desktop publication');
	const options = validatedOptions(raw);
	const snapshot = snapshotSoundscaperDesktopProject(profile, raw.project);
	const approval = options.confirmFileSizeWarning && DOCUMENT_APPROVALS.get(options.confirmFileSizeWarning);
	if (approval && (approval.profile !== profile || approval.sha256 !== snapshot.sha256
		|| approval.byteLength !== snapshot.byteLength)) {
		throw new Error('The desktop document changed its exact store publication approval.');
	}
	return Object.freeze({ project: snapshot.project, document: snapshot.document,
		documentByteLength: snapshot.byteLength, documentSha256: snapshot.sha256, ...options });
}

/** A successful store admission authorizes only its matching renderer snapshot. */
export function createSoundscaperDesktopDocumentApproval(
	profile: EditorProjectRuntimeProfile,
	snapshot: Readonly<{ byteLength: number; sha256: string }>,
	options: FileSizeWarningOptions,
): Readonly<FileSizeWarningOptions> {
	const confirmation: NonNullable<FileSizeWarningOptions['confirmFileSizeWarning']> = async (warning) => {
		options.signal?.throwIfAborted(); options.assertCurrent?.();
		return warning.label === 'Project document'
			&& warning.thresholdBytes === MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES
			&& warning.byteLength === snapshot.byteLength;
	};
	DOCUMENT_APPROVALS.set(confirmation, Object.freeze({ profile, sha256: snapshot.sha256, byteLength: snapshot.byteLength, options: Object.freeze({ ...options }) }));
	return Object.freeze({ signal: options.signal, assertCurrent: options.assertCurrent, confirmFileSizeWarning: confirmation });
}

/** Media admission uses the caller's presentation port, never document-only consent. */
export function soundscaperDesktopMediaWarningOptions(options: FileSizeWarningOptions): FileSizeWarningOptions {
	return options.confirmFileSizeWarning && DOCUMENT_APPROVALS.get(options.confirmFileSizeWarning)?.options || options;
}

/** Await the exact document decision before bridge admission or media reads. */
export async function admitSoundscaperDesktopPublication(request: SoundscaperDesktopRendererPublication): Promise<void> {
	await confirmFileSizeWarning(request.documentByteLength, MAXIMUM_PROJECT_PUBLICATION_DOCUMENT_BYTES,
		'Project document', request);
}

function validatedOptions(raw: Record<string, unknown>): Readonly<Omit<FileSizeWarningOptions, 'signal'> & { signal?: AbortSignal }> {
	for (const field of ['confirmFileSizeWarning', 'assertCurrent'] as const) {
		if (raw[field] !== undefined && typeof raw[field] !== 'function') {
			throw new TypeError(`Soundscaper desktop publication ${field} must be a function.`);
		}
	}
	const signal = raw.signal == null ? undefined : abortSignal(raw.signal);
	return Object.freeze({ ...(signal ? { signal } : {}),
		...(raw.confirmFileSizeWarning === undefined ? {} : { confirmFileSizeWarning: raw.confirmFileSizeWarning as FileSizeWarningOptions['confirmFileSizeWarning'] }),
		...(raw.assertCurrent === undefined ? {} : { assertCurrent: raw.assertCurrent as () => void }) });
}
