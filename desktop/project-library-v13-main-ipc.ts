/* SPDX-License-Identifier: AGPL-3.0-only */
import { registerFramescaperDesktopProjectLibraryExactGenerationMainIpc } from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V13_MAIN_CHANNELS } from './project-library-v13-main-channels.ts';
import { FramescaperDesktopProjectLibraryV13Main } from './project-library-v13-main.ts';
export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V13_MAIN_CHANNELS } from './project-library-v13-main-channels.ts';
export function registerFramescaperDesktopProjectLibraryV13MainIpc(value: unknown) {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V13', channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V13_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV13Main => main instanceof FramescaperDesktopProjectLibraryV13Main,
	});
}
