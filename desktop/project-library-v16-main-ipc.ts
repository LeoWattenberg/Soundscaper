/* SPDX-License-Identifier: AGPL-3.0-only */
import { registerFramescaperDesktopProjectLibraryExactGenerationMainIpc } from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V16_MAIN_CHANNELS } from './project-library-v16-main-channels.ts';
import { FramescaperDesktopProjectLibraryV16Main } from './project-library-v16-main.ts';
export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V16_MAIN_CHANNELS } from './project-library-v16-main-channels.ts';
export function registerFramescaperDesktopProjectLibraryV16MainIpc(value: unknown) {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V16', channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V16_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV16Main => main instanceof FramescaperDesktopProjectLibraryV16Main,
	});
}
