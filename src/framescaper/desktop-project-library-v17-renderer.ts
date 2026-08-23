/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	assertFramescaperDesktopProjectLibraryExactRendererComposition,
	connectFramescaperDesktopProjectLibraryExactRenderer,
	type FramescaperDesktopProjectLibraryV12ProjectSummary,
	type FramescaperDesktopProjectLibraryV12Renderer,
} from './desktop-project-library-v12-renderer.ts';

const IDENTITY = Object.freeze({
	label: 'Framescaper desktop V17', librarySchemaVersion: 17, databaseUserVersion: 19, scopeVersion: 'v17',
});

export type FramescaperDesktopProjectLibraryV17ProjectSummary =
	FramescaperDesktopProjectLibraryV12ProjectSummary;
export type FramescaperDesktopProjectLibraryV17Renderer =
	FramescaperDesktopProjectLibraryV12Renderer;

export function connectFramescaperDesktopProjectLibraryV17Renderer(
	profile: EditorProjectRuntimeProfile | unknown,
	store: unknown,
): Promise<FramescaperDesktopProjectLibraryV17Renderer | null> {
	return connectFramescaperDesktopProjectLibraryExactRenderer(profile, store, IDENTITY);
}

export function assertFramescaperDesktopProjectLibraryV17RendererComposition(
	profile: EditorProjectRuntimeProfile | unknown,
	store: unknown,
	renderer: unknown,
): asserts renderer is FramescaperDesktopProjectLibraryV17Renderer {
	assertFramescaperDesktopProjectLibraryExactRendererComposition(profile, store, renderer, IDENTITY);
}
