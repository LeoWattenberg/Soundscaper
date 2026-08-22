/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V12_MAIN_CHANNELS } from './project-library-v12-main-channels.ts';
import { FramescaperDesktopProjectLibraryV12Main } from './project-library-v12-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V12_MAIN_CHANNELS } from './project-library-v12-main-channels.ts';
export type FramescaperDesktopProjectLibraryV12MainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryV12MainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryV12MainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V12',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V12_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV12Main => (
			main instanceof FramescaperDesktopProjectLibraryV12Main
		),
	});
}
