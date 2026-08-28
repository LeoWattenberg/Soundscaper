/* SPDX-License-Identifier: AGPL-3.0-only */

const ROOT = 'framescaper:v1:project-library';

/** Closed Framescaper 1.0 project-library IPC inventory. */
export const FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_MAIN_CHANNELS = Object.freeze({
	handshake: `${ROOT}:handshake`,
	readProjectBundle: `${ROOT}:bundle`,
	readBodyChunk: `${ROOT}:bodies:read`,
	listProjects: `${ROOT}:list`,
	deleteProject: `${ROOT}:delete`,
	duplicateProject: `${ROOT}:duplicate`,
	beginPublication: `${ROOT}:publication:begin`,
	writePublicationChunk: `${ROOT}:publication:chunk`,
	finishPublication: `${ROOT}:publication:finish`,
	abortPublication: `${ROOT}:publication:abort`,
} as const);
