/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectStore } from '../common/editor/storage.js';
import { sameProjectSnapshot } from '../common/editor/storage/project-snapshot-equality.ts';
import { cloneFramescaperProjectTimelineImage } from './editor-project-timeline-image.ts';
import type { FramescaperSelectedOpenFxExecutionNativeMedia } from './selected-native-media-openfx-exact-planes.ts';
import { FRAMESCAPER_PROJECT_SCHEMA_FAMILY, classifyProjectSchemaIdentity } from '../common/editor/project-schema-identity.ts';
import {
	bindProductVideoVisualPreviewRuntime,
	createProductVideoVisualPreviewRuntime,
} from '../common/editor/ui/workspace/product-video-visual-preview-runtime.ts';

/** Bind lazy authenticated timelineImage image preview, Project Bin, and filmstrip routes. */
export function bindFramescaperSelectedImagePreviewControllerTimelineImage(options: Readonly<{
	readonly controller: object;
	readonly profile: unknown;
	readonly store: AudioEditorProjectStore;
	readonly cloneProject?: (profile: unknown, project: unknown) => never;
	readonly openFxExecute?: FramescaperSelectedOpenFxExecutionNativeMedia['execute'];
}>): void {
	if (!options?.controller || typeof options.controller !== 'object') {
		throw new TypeError('Selected timelineImage image preview requires a controller owner.');
	}
	const profile = options.profile, store = options.store, clone = options.cloneProject ?? cloneFramescaperProjectTimelineImage;
	const execute = options.openFxExecute;
	const capture = <Request extends Readonly<{ project: unknown }>>(request: Request) => {
		const live = request.project;
		const project = Reflect.apply(clone, undefined, [profile, live]) as ReturnType<typeof cloneFramescaperProjectTimelineImage>;
		return { ...request, project, store, profile,
			// The owning clone already admitted/captured this exact request before
			// import. Keep its explicit custom seam and returned project identity.
			cloneProject: () => project,
			...(execute ? { openFxExecute: execute } : {}),
			assertCurrentV16() {
				const current = Reflect.apply(clone, undefined, [profile, live]);
				if (!sameProjectSnapshot(current, project)) throw new Error('The selected TimelineImage preview snapshot changed.');
			},
		};
	};
	bindProductVideoVisualPreviewRuntime(options.controller, createProductVideoVisualPreviewRuntime(
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const captured = capture(request);
			const module = await import('./editor-selected-timeline-image-image-preview.ts');
			return module.createFramescaperSelectedVisualPreviewSessionTimelineImage(captured);
		},
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const captured = capture(request);
			const module = await import('./editor-selected-timeline-image-image-preview.ts');
			return module.createFramescaperSelectedProjectBinThumbnailTimelineImage(captured);
		},
		async (request) => {
			if (isOpaquePreviewProject(request.project)) return null;
			const captured = capture(request);
			const module = await import('./editor-selected-timeline-image-image-filmstrip.ts');
			return module.createFramescaperSelectedTimelineFilmstripTimelineImage(captured);
		},
	));
}

/** Opaque custody has no owning visual runtime; malformed inputs retain factory validation. */
function isOpaquePreviewProject(project: unknown): boolean {
	try {
		return classifyProjectSchemaIdentity(project, FRAMESCAPER_PROJECT_SCHEMA_FAMILY).disposition !== 'current';
	} catch {
		return false;
	}
}
