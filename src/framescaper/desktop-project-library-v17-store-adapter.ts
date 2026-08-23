/* SPDX-License-Identifier: AGPL-3.0-only */

import type { EditorProjectRuntimeProfile } from '../common/editor/project-runtime-profile.ts';
import {
	createFramescaperDesktopProjectStoreExactAdapter,
	type FramescaperDesktopProjectStoreV12Adapter,
	type FramescaperDesktopProjectStoreV12Local,
} from './desktop-project-library-v12-store-adapter.ts';
import {
	assertFramescaperDesktopProjectLibraryV17RendererComposition,
	type FramescaperDesktopProjectLibraryV17Renderer,
} from './desktop-project-library-v17-renderer.ts';

export type FramescaperDesktopProjectStoreV17Local = FramescaperDesktopProjectStoreV12Local;
export type FramescaperDesktopProjectStoreV17Adapter<Store> =
	FramescaperDesktopProjectStoreV12Adapter<Store>;

export function createFramescaperDesktopProjectStoreV17Adapter<
	Store extends FramescaperDesktopProjectStoreV17Local,
>(
	profile: EditorProjectRuntimeProfile | unknown,
	composition: Readonly<{
		readonly localStore: Store;
		readonly desktopProjectLibrary: FramescaperDesktopProjectLibraryV17Renderer | null;
	}>,
): Store | FramescaperDesktopProjectStoreV17Adapter<Store> {
	return createFramescaperDesktopProjectStoreExactAdapter(
		profile,
		composition,
		assertFramescaperDesktopProjectLibraryV17RendererComposition,
		'Framescaper desktop V17',
	);
}
