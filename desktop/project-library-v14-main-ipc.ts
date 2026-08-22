/* SPDX-License-Identifier: AGPL-3.0-only */
import { registerFramescaperDesktopProjectLibraryExactGenerationMainIpc } from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V14_MAIN_CHANNELS } from './project-library-v14-main-channels.ts';
import { FramescaperDesktopProjectLibraryV14Main } from './project-library-v14-main.ts';
export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V14_MAIN_CHANNELS } from './project-library-v14-main-channels.ts';
export function registerFramescaperDesktopProjectLibraryV14MainIpc(value: unknown) {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V14', channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V14_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV14Main => main instanceof FramescaperDesktopProjectLibraryV14Main,
	});
}
