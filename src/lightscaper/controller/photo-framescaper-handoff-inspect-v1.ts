/* SPDX-License-Identifier: AGPL-3.0-only */

import { assertPhotoDevelopHandoffMasksV1 } from './photo-develop-handoff-masks-v1.ts';

import { readClosedDomainField as field, readClosedDomainRecord as record } from '../../common/editor/closed-domain-value.ts';
import { withScapeProjectInput } from '../../common/editor/scape-project-input.ts';
import { readScapeArchiveEnvelope } from '../../common/editor/scape-archive-envelope.ts';
import { verifyScapeAssetBytes } from '../../common/editor/scape-archive-media.ts';
import { loadScapeProjectDocument } from '../../common/editor/scape-project-admission.ts';
import { restoreNormalizedScapeAbortReason } from '../../common/editor/scape-abort.ts';
import { framescaperImageSourceResourceReferencesV2, normalizeFramescaperImageSourceV2 } from '../../common/editor/timeline-image-model-v2.ts';
import { normalizeFramescaperImageSourceV1 } from '../../common/editor/timeline-image-model.ts';
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
	/** Ordinary Source1 choices retain only Frame's stored NFC original name. */
	readonly imageClips?: readonly Readonly<{ clipId: string; sequenceId: string; sequenceName: string; scope: 'timeline' | 'bin' }>[];
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
 * Eligible ordinary Source1 additionally lists genuine timeline/bin contexts;
 * zero placements and unsupported images are counted, never silently selected
 * or flattened. Clip presence conveys the stored filename limitation. */
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
				if (candidate.schemaVersion === 1) {
					const source = normalizeFramescaperImageSourceV1(candidate);
					const imageClips: NonNullable<PhotoFramescaperHandoffSourceChoiceV1['imageClips']>[number][] = [];
					for (const [scope, clips] of [['timeline', project.clips], ['bin', project.projectBin.clips]] as const) {
						for (const clip of clips) {
							if (clip.kind !== 'image' || clip.sourceId !== source.id) continue;
							const sequence = project.sequences.find(value => value.id === clip.sequenceId);
							if (!sequence) throw new ReferenceError('Ordinary image clip sequence is missing.');
							if (typeof sequence.name !== 'string') throw new TypeError('Ordinary image clip sequence requires its stored name.');
							imageClips.push(Object.freeze({ clipId: clip.id, sequenceId: sequence.id, sequenceName: sequence.name, scope }));
						}
					}
					if (!imageClips.length || source.canonical.frameCount !== 1 || !['png', 'jpeg', 'gif', 'webp', 'bmp'].includes(source.original.recognizedFormat)
						|| source.original.byteLength > MAXIMUM_ORIGINAL || source.assetByteLength > MAXIMUM_BODIES) { unsupportedImageCount++; continue; }
					sources.push(Object.freeze({ sourceId: source.id, name: source.name, originalName: source.original.fileName,
						processVersion: 1, width: source.canonical.width, height: source.canonical.height, imageClips: Object.freeze(imageClips) }));
					continue;
				}
				const source = normalizeFramescaperImageSourceV2(candidate), origin = source.provenance.origin;
				const lutBytes = framescaperImageSourceResourceReferencesV2(source).reduce((sum, reference) => sum + reference.byteLength, 0);
				try { assertPhotoDevelopHandoffMasksV1(source.develop, source.canonical.width, source.canonical.height); }
				catch { unsupportedImageCount++; continue; }
				if (source.original.byteLength > MAXIMUM_ORIGINAL
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
