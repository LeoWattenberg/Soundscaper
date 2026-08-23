/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V17_MAIN_CHANNELS } from './project-library-v17-main-channels.ts';
import { FramescaperDesktopProjectLibraryV17Main } from './project-library-v17-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V17_MAIN_CHANNELS } from './project-library-v17-main-channels.ts';
export type FramescaperDesktopProjectLibraryV17MainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryV17MainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryV17MainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V17',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V17_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV17Main => (
			main instanceof FramescaperDesktopProjectLibraryV17Main
		),
	});
}
