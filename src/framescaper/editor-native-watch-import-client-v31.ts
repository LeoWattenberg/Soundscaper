/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperNativeWatchImportClientForSchema,
	type FramescaperNativeWatchImportClientV28,
	type FramescaperNativeWatchImportClientV28Options,
	type FramescaperNativeWatchImportControllerV28,
} from './editor-native-watch-import-client-v28.ts';

export type FramescaperNativeWatchImportControllerV31 = FramescaperNativeWatchImportControllerV28;
export type FramescaperNativeWatchImportClientV31Options = FramescaperNativeWatchImportClientV28Options;
export type FramescaperNativeWatchImportClientV31 = FramescaperNativeWatchImportClientV28;

/** Consume main-owned exact-F31 watch claims without exposing paths to the renderer. */
export function createFramescaperNativeWatchImportClientV31(
	options: FramescaperNativeWatchImportClientV31Options,
): Readonly<FramescaperNativeWatchImportClientV31> {
	return createFramescaperNativeWatchImportClientForSchema(31, options);
}
