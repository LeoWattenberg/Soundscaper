/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from './framescaper-project-library-main-channels.ts';
import { FramescaperDesktopProjectLibraryMain } from './framescaper-project-library-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS } from './framescaper-project-library-main-channels.ts';
export type FramescaperDesktopProjectLibraryMainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryMainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryMainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper 1.0',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryMain => (
			main instanceof FramescaperDesktopProjectLibraryMain
		),
	});
}
