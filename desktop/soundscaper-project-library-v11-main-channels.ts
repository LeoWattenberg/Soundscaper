/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_CHANNELS,
} from './soundscaper-project-library-v11-ipc.ts';

/** Complete product-owned V11 channel inventory shared by main and sandbox preload. */
export const SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_MAIN_CHANNELS = Object.freeze({
	...SOUNDSCAPER_DESKTOP_PROJECT_LIBRARY_V11_CHANNELS,
	listProjects: 'soundscaper:v11:projects:list',
	deleteProject: 'soundscaper:v11:projects:delete',
	duplicateProject: 'soundscaper:v11:projects:duplicate',
	beginPublication: 'soundscaper:v11:projects:publication:begin',
	writePublicationChunk: 'soundscaper:v11:projects:publication:chunk',
	finishPublication: 'soundscaper:v11:projects:publication:finish',
	abortPublication: 'soundscaper:v11:projects:publication:abort',
	persistNativePluginState: 'soundscaper:v11:native-plugin-state:persist',
	readNativePluginState: 'soundscaper:v11:native-plugin-state:read',
} as const);
