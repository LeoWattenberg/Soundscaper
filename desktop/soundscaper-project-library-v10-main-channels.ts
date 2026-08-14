/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
} from './soundscaper-project-library-v10-ipc.ts';

/** Complete product-owned V10 channel inventory shared by main and sandbox preload. */
export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_MAIN_CHANNELS = Object.freeze({
	...SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V10_CHANNELS,
	listProjects: 'soundscaper:v10:projects:list',
	deleteProject: 'soundscaper:v10:projects:delete',
	duplicateProject: 'soundscaper:v10:projects:duplicate',
	beginPublication: 'soundscaper:v10:projects:publication:begin',
	writePublicationChunk: 'soundscaper:v10:projects:publication:chunk',
	finishPublication: 'soundscaper:v10:projects:publication:finish',
	abortPublication: 'soundscaper:v10:projects:publication:abort',
} as const);
