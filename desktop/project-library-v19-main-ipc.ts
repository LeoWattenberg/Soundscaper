/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V19_MAIN_CHANNELS } from './project-library-v19-main-channels.ts';
import { FramescaperDesktopProjectLibraryV19Main } from './project-library-v19-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V19_MAIN_CHANNELS } from './project-library-v19-main-channels.ts';
export type FramescaperDesktopProjectLibraryV19MainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryV19MainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryV19MainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V19',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V19_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV19Main => (
			main instanceof FramescaperDesktopProjectLibraryV19Main
		),
	});
}
