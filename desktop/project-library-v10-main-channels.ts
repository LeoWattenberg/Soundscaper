/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
} from './project-library-v10-ipc.ts';

/** Complete product-owned V10 channel inventory shared by main and sandbox preload. */
export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS = Object.freeze({
	...FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
	beginPublication: 'framescaper:v10:projects:publication:begin',
	writePublicationChunk: 'framescaper:v10:projects:publication:chunk',
	finishPublication: 'framescaper:v10:projects:publication:finish',
	abortPublication: 'framescaper:v10:projects:publication:abort',
} as const);
