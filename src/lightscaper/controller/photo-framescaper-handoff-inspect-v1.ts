/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { withScapeProjectInput } from '../../common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../common/editor/scape-archive-media.ts';
import { loadScapeProjectDocument } from '../../common/editor/scape-project-admission.ts';
import { restoreNormalizedScapeAbortReason } from '../../common/editor/scape-abort.ts';
import { framescaperImageSourceResourceReferencesV2, normalizeFramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { loadFramescaperProject, cloneFramescaperProject } from '../../framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../framescaper/editor-project-runtime-profile.ts';
import { createFramescaperScapeProjectAssetExtension } from '../../framescaper/editor-scape-assets.ts';
import { validateTimelineImageCurrentArchiveAssets } from '../../framescaper/editor-scape-asset-plan-timeline-image-current.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../../framescaper/editor-project-assistance-foundation.ts';
import { readPhotoDevelopSignalOptionsV2 } from '../storage/photo-develop-preset-read-v2.ts';
import { PhotoLibrarySessionLifetime } from './photo-library-session-lifetime.ts';

export interface PhotoFramescaperHandoffSourceChoiceV1 {
	readonly sourceId: string; readonly name: string; readonly originalName: string;
	readonly processVersion: 1 | 2; readonly width: number; readonly height: number;
	readonly versionKind?: 'master' | 'virtual-copy';
}
export interface PhotoFramescaperHandoffInspectionV1 {
	readonly schemaVersion: 1; readonly projectId: string; readonly projectRevision: number; readonly title: string;
	readonly sources: readonly Readonly<PhotoFramescaperHandoffSourceChoiceV1>[]; readonly unsupportedImageCount: number;
}
const MAXIMUM_ARCHIVE = 256 * 1024 * 1024, MAXIMUM_BODIES = 128 * 1024 * 1024, MAXIMUM_ORIGINAL = 64 * 1024 * 1024;
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!, SLICE = Blob.prototype.slice;
const CHECK = AbortSignal.prototype.throwIfAborted;
function check(signal: AbortSignal): void { Reflect.apply(CHECK, signal, []); }

/** Authenticate current project facts and its declared asset inventory, then
 * close the ZIP before returning scalar choices. No original, LUT or pixel
 * bodies are read or granted here; receive must authenticate the selection.
 * The archive and expanded envelope share the reader's fixed 256MiB bound.
 * Ordinary Source1 and currently unsupported editable images are counted,
 * never silently selected or flattened. */
export async function inspectPhotoFramescaperHandoffSourcesV1(value: Readonly<{ archive: Blob; signal?: AbortSignal }>): Promise<Readonly<PhotoFramescaperHandoffInspectionV1>> {
	const label = 'Photo editable archive inspection', input = record(value, label, ['archive', 'signal'], ['archive']);
	const { signal: caller } = readPhotoDevelopSignalOptionsV2(Object.hasOwn(input, 'signal') ? { signal: field(input, 'signal', label) } : {});
	const candidate = field(input, 'archive', label), size = Number(Reflect.apply(SIZE, candidate, []));
	if (size < 1 || size > MAXIMUM_ARCHIVE) throw new RangeError('Photo editable archive exceeds its fixed input byte bound.');
	const archive = Reflect.apply(SLICE, candidate, [0, size]) as Blob, lifetime = new PhotoLibrarySessionLifetime();
	try { return await lifetime.operation(async signal => {
		try { return await withScapeProjectInput(archive, signal, async entries => {
			const extension = createFramescaperScapeProjectAssetExtension(PROFILE);
			const envelope = await readScapeArchiveEnvelope(entries, { maximumExpandedBytes: MAXIMUM_ARCHIVE }, signal, extension.assetKinds);
			check(signal); verifyScapeAssetBytes(new TextEncoder().encode(envelope.projectText), envelope.manifest.project, 'Frame project document');
			const admitted = loadScapeProjectDocument(envelope.projectText, envelope.manifest.project, {
				currentProjectSchemaFamily: 'framescaper', currentProjectSchemaVersion: 1, loadProject: project => loadFramescaperProject(PROFILE, project),
			});
			if (admitted.readOnly) throw new RangeError('Photo editable archive requires a current Frame project.');
			const project = cloneFramescaperProject(PROFILE, admitted.project);
			validateTimelineImageCurrentArchiveAssets(framescaperProjectTimelineImageFoundationShapeAssistance(project), envelope.manifest);
			const sources: Readonly<PhotoFramescaperHandoffSourceChoiceV1>[] = []; let unsupportedImageCount = 0;
			for (const candidate of project.sources) {
				check(signal); if (candidate.kind !== 'image') continue;
				if (candidate.schemaVersion === 1) { unsupportedImageCount++; continue; }
				const source = normalizeFramescaperImageSourceV2(candidate), origin = source.provenance.origin;
				const lutBytes = framescaperImageSourceResourceReferencesV2(source).reduce((sum, reference) => sum + reference.byteLength, 0);
				if (source.develop.masks.length || source.develop.maskBindings.length || source.original.byteLength > MAXIMUM_ORIGINAL
					|| source.assetByteLength + lutBytes > MAXIMUM_BODIES) { unsupportedImageCount++; continue; }
				sources.push(Object.freeze({ sourceId: source.id, name: source.name, originalName: source.provenance.original.exactName,
					processVersion: source.develop.processVersion, width: source.canonical.width, height: source.canonical.height,
					...(origin.schemaFamily === 'lightscaper' ? { versionKind: origin.versionKind } : {}) }));
			}
			check(signal); return Object.freeze({ schemaVersion: 1, projectId: project.id, projectRevision: project.revision, title: project.title,
				sources: Object.freeze(sources), unsupportedImageCount });
		}); } catch (error) { check(signal); throw restoreNormalizedScapeAbortReason(error); }
	}, caller); } finally { await lifetime.close(async () => undefined); }
}
