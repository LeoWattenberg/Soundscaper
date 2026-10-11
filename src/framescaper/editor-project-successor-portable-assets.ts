/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizeFramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { resolveFramescaperCompositionSource, resolveFramescaperCompositionAudioSource } from './editor-composition-link-source.ts';
import { createFramescaperScapeProjectAssetExtension } from './editor-scape-assets.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { indexFramescaperLinkedAssets } from './editor-project-successor-link-assets.ts';
import { safeScapeEntryId } from '../common/editor/scape-archive-media.ts';
import type { PlannedScapeExportAsset } from '../common/editor/scape-export-plan.ts';

/** Only exact typed link contracts may omit encoded/PCM source bodies. This projection is planning-only, never persisted. */
export function framescaperSuccessorPortableAssets(value: unknown) {
	const project = normalizeFramescaperSuccessorProject(value); const baseline = framescaperSuccessorBaselineProject(project);
	const virtual = new Set<string>(); const timing = new Map<string, PlannedScapeExportAsset>();
	for (const source of baseline.sources) {
		const picture = resolveFramescaperCompositionSource(project, source);
		if (picture) {
			virtual.add(source.id); const reference = picture.timing.reference;
			timing.set(reference.storageKey, { source, sourceId: reference.storageKey, storageKey: reference.storageKey, kind: 'video-timing', encoding: reference.encoding,
				mimeType: 'application/vnd.soundscaper.video-timing', entry: `timing/${safeScapeEntryId(reference.sha256)}.scti`, size: reference.byteLength,
				expectedSha256: reference.sha256, timingReference: reference, body: picture.timing.bytes });
		}
		if (resolveFramescaperCompositionAudioSource(project, source)) virtual.add(source.id);
	}
	const ordinary = { ...baseline, sources: baseline.sources.filter(source => !virtual.has(source.id)) };
	return { project, baseline, ordinary, virtual, timing, linked: indexFramescaperLinkedAssets(project), extension: createFramescaperScapeProjectAssetExtension(FRAMESCAPER_PROJECT_RUNTIME_PROFILE) };
}
