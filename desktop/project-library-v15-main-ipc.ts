/* SPDX-License-Identifier: AGPL-3.0-only */
import { registerFramescaperDesktopProjectLibraryExactGenerationMainIpc } from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V15_MAIN_CHANNELS } from './project-library-v15-main-channels.ts';
import { FramescaperDesktopProjectLibraryV15Main } from './project-library-v15-main.ts';
export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V15_MAIN_CHANNELS } from './project-library-v15-main-channels.ts';
export function registerFramescaperDesktopProjectLibraryV15MainIpc(value: unknown) {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V15', channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V15_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV15Main => main instanceof FramescaperDesktopProjectLibraryV15Main,
	});
}
