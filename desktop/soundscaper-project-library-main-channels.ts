/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS,
} from './soundscaper-project-library-ipc.ts';

/** Complete product-owned baseline channel inventory shared by main and sandbox preload. */
export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS = Object.freeze({
	...SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_CHANNELS,
	listProjects: 'soundscaper:v1:project-library:projects:list',
	deleteProject: 'soundscaper:v1:project-library:projects:delete',
	duplicateProject: 'soundscaper:v1:project-library:projects:duplicate',
	beginPublication: 'soundscaper:v1:project-library:publication:begin',
	writePublicationChunk: 'soundscaper:v1:project-library:publication:chunk',
	finishPublication: 'soundscaper:v1:project-library:publication:finish',
	abortPublication: 'soundscaper:v1:project-library:publication:abort',
	persistNativePluginState: 'soundscaper:v1:project-library:native-plugin-state:persist',
	readNativePluginState: 'soundscaper:v1:project-library:native-plugin-state:read',
} as const);
