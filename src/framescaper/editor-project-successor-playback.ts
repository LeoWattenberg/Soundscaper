/* SPDX-License-Identifier: AGPL-3.0-only */
import type { PlaybackProjectService } from '../common/editor/controller/source/playback-project-service.ts';
import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { registerVideoTimingIndex } from '../common/editor/video-source-time.ts';
import { createFramescaperPlaybackProjectService } from './editor-project-playback.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';
import { normalizeFramescaperSuccessorProject, type FramescaperSuccessorProject } from './editor-project-successor.ts';
import { framescaperSuccessorBaselineProject } from './editor-project-successor-commands.ts';
import { resolveFramescaperCompositionSource } from './editor-composition-link-source.ts';
const CANONICAL = new WeakMap<object, FramescaperSuccessorProject>();
export function framescaperSuccessorPlaybackCanonicalProject(value: object): FramescaperSuccessorProject | null { return CANONICAL.get(value) ?? null; }
function associated<T extends { readonly project: object }>(result: T, value: unknown): T {
	CANONICAL.set(result.project, normalizeFramescaperSuccessorProject(value)); return result;
}
/** Existing timeline evaluation receives a transient v1 shape, while session and storage retain canonical v2 intent. */
export function createFramescaperSuccessorPlayback(media: AudioEditorProjectStore): PlaybackProjectService {
	const ordinary = createFramescaperPlaybackProjectService(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { timingStore: media });
	const project = framescaperSuccessorBaselineProject;
	return Object.freeze({
		async prepareProjectForActivation(value: object, options: { signal?: AbortSignal } = {}) {
			const canonical = normalizeFramescaperSuccessorProject(value); const baseline = project(canonical); const timing = new Map<string, Blob>();
			for (const link of canonical.compositionLinks) {
				options.signal?.throwIfAborted(); const source = baseline.sources.find(entry => entry.id === link.sourceId)!;
				const resolved = resolveFramescaperCompositionSource(canonical, source)!;
				registerVideoTimingIndex(source, resolved.timing.index);
				timing.set(resolved.timing.reference.storageKey, new Blob([new Uint8Array(resolved.timing.bytes)]));
			}
			const preparation = createFramescaperPlaybackProjectService(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, { timingStore: {
				loadMediaAsset: (key: string, readOptions?: { signal?: AbortSignal }) => timing.get(key) ?? media.loadMediaAsset(key, readOptions),
			} });
			await preparation.prepareProjectForActivation?.(baseline, options);
		},
		projectForActivationAdmission: (value: object) => associated(ordinary.projectForActivationAdmission!(project(value)), value),
		projectForPlayback: (value: object) => associated(ordinary.projectForPlayback(project(value)), value),
		projectForAudioRenderedFallbackDelivery: (value: object) => associated(ordinary.projectForAudioRenderedFallbackDelivery(project(value)), value),
		projectForVideoRenderedFallbackDelivery: (value: object) => associated(ordinary.projectForVideoRenderedFallbackDelivery(project(value)), value),
	}) as PlaybackProjectService;
}
