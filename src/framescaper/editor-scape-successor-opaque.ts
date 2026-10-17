/* SPDX-License-Identifier: AGPL-3.0-only */
import { withScapeProjectInput, type ScapeProjectInput } from '../common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../common/editor/scape-archive-media.ts';
import { parseOpaqueScapeProjectDocument } from '../common/editor/scape-project-document.ts';
import { classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import { isDesktopScapeArchiveByteSource } from '../common/editor/desktop-scape-archive-byte-source.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { MOTION_LINKED_ARCHIVE_ASSET_KIND } from './editor-project-successor-link-assets.ts';
import { framescaperSuccessorOpaqueProject } from './editor-project-successor-opaque.ts';

/** Envelope custody never asks a media store, asset decoder or canonical owner to act. */
export async function inspectFramescaperSuccessorOpaqueArchive(input: ScapeProjectInput, signal: AbortSignal) {
	return withScapeProjectInput(input, signal, async entries => {
		const extension = createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE);
		const envelope = await readScapeArchiveEnvelope(entries, {}, signal, [...extension.assetKinds, MOTION_LINKED_ARCHIVE_ASSET_KIND], isDesktopScapeArchiveByteSource(input), {}, { family: 'framescaper', line: 'successor' });
		verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'project document');
		const value = parseOpaqueScapeProjectDocument(envelope.projectText);
		const identity = classifyProjectSchemaIdentity(value, 'framescaper', 'successor');
		const project = framescaperSuccessorOpaqueProject(value);
		return project ? { project, manifest: envelope.manifest, readOnly: true as const, reason: identity.disposition === 'foreign' ? 'foreign-family' : 'newer-schema', collision: null } : null;
	});
}
