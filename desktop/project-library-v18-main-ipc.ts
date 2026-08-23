/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V18_MAIN_CHANNELS } from './project-library-v18-main-channels.ts';
import { FramescaperDesktopProjectLibraryV18Main } from './project-library-v18-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V18_MAIN_CHANNELS } from './project-library-v18-main-channels.ts';
export type FramescaperDesktopProjectLibraryV18MainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryV18MainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryV18MainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V18',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V18_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV18Main => (
			main instanceof FramescaperDesktopProjectLibraryV18Main
		),
	});
}

