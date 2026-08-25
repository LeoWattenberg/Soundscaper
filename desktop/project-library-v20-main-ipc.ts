/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	registerFramescaperDesktopProjectLibraryExactGenerationMainIpc,
	type FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration,
} from './project-library-exact-generation-main-ipc.ts';
import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_MAIN_CHANNELS } from './project-library-v20-main-channels.ts';
import { FramescaperDesktopProjectLibraryV20Main } from './project-library-v20-main.ts';

export { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_MAIN_CHANNELS } from './project-library-v20-main-channels.ts';
export type FramescaperDesktopProjectLibraryV20MainIpcRegistration =
	FramescaperDesktopProjectLibraryExactGenerationMainIpcRegistration;

export function registerFramescaperDesktopProjectLibraryV20MainIpc(
	value: unknown,
): FramescaperDesktopProjectLibraryV20MainIpcRegistration {
	return registerFramescaperDesktopProjectLibraryExactGenerationMainIpc(value, {
		label: 'Framescaper V20',
		channels: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_MAIN_CHANNELS,
		isMain: (main): main is FramescaperDesktopProjectLibraryV20Main => (
			main instanceof FramescaperDesktopProjectLibraryV20Main
		),
	});
}
