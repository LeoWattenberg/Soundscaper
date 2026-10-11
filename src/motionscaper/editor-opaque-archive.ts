/* SPDX-License-Identifier: AGPL-3.0-only */
import { MOTION_ARCHIVE_ASSET_KINDS } from '../common/editor/motion-archive-contract.ts';
import { classifyProjectSchemaIdentity, type ProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { copyFutureScapeArchive, type ScapeArchiveCopyResult } from '../common/editor/scape-archive-copy.ts';
import { readScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { parseOpaqueScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { beginMotionscaperDesktopSave, motionscaperDesktopFiles } from './desktop-file-adapter.ts';
import type { MotionDesktopFiles } from './desktop-file-contract.ts';

export interface MotionscaperOpaqueArchive {
	readonly identity: Readonly<ProjectSchemaIdentity>;
	readonly fileName: string;
	browserBlob(): Blob | null;
	copy(write: (bytes: Uint8Array) => void | PromiseLike<void>, signal?: AbortSignal): Promise<ScapeArchiveCopyResult>;
	close(): Promise<void>;
}

/** Admit only scalar envelope identity. Unknown authored fields and asset bodies stay inert. */
export async function inspectMotionscaperOpaqueArchive(input: ScapeProjectInput, fileName: string,
	options: { readonly signal?: AbortSignal; readonly release?: () => Promise<void> } = {}): Promise<MotionscaperOpaqueArchive | null> {
	const identity = await withScapeProjectInput(input, options.signal, async entries => {
		const { manifest, projectText } = await readScapeArchiveEnvelope(entries, {}, options.signal, MOTION_ARCHIVE_ASSET_KINDS,
			false, {}, { family: 'motionscaper', line: 'baseline' });
		verifyScapeAssetBytes(new TextEncoder().encode(projectText), manifest.project, 'project document');
		const classification = classifyProjectSchemaIdentity(parseOpaqueScapeProjectDocument(projectText), 'motionscaper');
		return classification.disposition === 'future' || classification.disposition === 'foreign' ? classification.identity : null;
	});
	if (!identity) return null;
	let closed = false; let released = false;
	let active: Promise<ScapeArchiveCopyResult> | null = null; let closing: Promise<void> | null = null;
	const assertOpen = () => { if (closed) throw new Error('The opaque Motionscaper archive is closed.'); };
	return Object.freeze({ identity, fileName: safeCopyName(fileName, identity),
		browserBlob() { assertOpen(); return input instanceof Blob ? input : null; },
		async copy(write: (bytes: Uint8Array) => void | PromiseLike<void>, signal?: AbortSignal) {
			assertOpen(); if (active) throw new Error('An opaque archive copy is already running.');
			const operation = copyFutureScapeArchive(input, write, { currentProjectSchemaFamily: 'motionscaper', allowOpaqueAssetKinds: true, signal });
			active = operation;
			try { return await operation; } finally { if (active === operation) active = null; }
		},
		async close() {
			closed = true;
			if (released) return;
			if (!closing) closing = (async () => { await active?.catch(() => undefined); await options.release?.(); released = true; })();
			try { await closing; } finally { closing = null; }
		},
	});
}

/** Always asks for a new destination; never binds a foreign identity to the authored document. */
export async function saveMotionscaperOpaqueCopy(archive: MotionscaperOpaqueArchive,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(), signal?: AbortSignal): Promise<boolean> {
	signal?.throwIfAborted();
	if (!files) {
		const blob = archive.browserBlob();
		if (!blob) throw new Error('This opaque archive requires its native file capability.');
		const url = URL.createObjectURL(blob); const link = document.createElement('a');
		try { link.href = url; link.download = archive.fileName; document.body.append(link); link.click(); }
		finally { link.remove(); globalThis.setTimeout(() => URL.revokeObjectURL(url), 1000); }
		return true;
	}
	const output = await beginMotionscaperDesktopSave(files, { projectId: `opaque-${crypto.randomUUID()}`,
		suggestedName: archive.fileName, saveAs: true, saveCopy: true, signal });
	if (!output) return false;
	const writer = output.writable.getWriter();
	try { await archive.copy(bytes => writer.write(bytes), signal); await writer.close(); await output.commit(); return true; }
	catch (error) { await output.abort(); throw error; }
	finally { writer.releaseLock(); }
}

function safeCopyName(value: string, identity: ProjectSchemaIdentity): string {
	const name = value.replace(/[\\/\p{Cc}<>:"|?*]/gu, '_').slice(0, 180);
	if (/\.(?:m|f|s)scape$/iu.test(name)) return name;
	const extension = identity.schemaFamily === 'motionscaper' ? '.mscape' : identity.schemaFamily === 'framescaper' ? '.fscape' : '.sscape';
	return `${name || 'Scape project'}${extension}`;
}
