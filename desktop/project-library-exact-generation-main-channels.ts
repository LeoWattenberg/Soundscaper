/* SPDX-License-Identifier: AGPL-3.0-only */

export interface FramescaperDesktopProjectLibraryExactGenerationMainChannels {
	readonly handshake: string;
	readonly readProjectBundle: string;
	readonly readBodyChunk: string;
	readonly listProjects: string;
	readonly deleteProject: string;
	readonly duplicateProject: string;
	readonly beginPublication: string;
	readonly writePublicationChunk: string;
	readonly finishPublication: string;
	readonly abortPublication: string;
}

export function createFramescaperDesktopProjectLibraryExactGenerationMainChannels(
	generation: number,
): Readonly<FramescaperDesktopProjectLibraryExactGenerationMainChannels> {
	if (!Number.isSafeInteger(generation) || generation < 1) {
		throw new TypeError('Framescaper exact-generation IPC version is invalid');
	}
	const root = `framescaper:v${String(generation)}:projects`;
	return Object.freeze({
		handshake: `${root}:handshake`,
		readProjectBundle: `${root}:bundle`,
		readBodyChunk: `${root}:bodies:read`,
		listProjects: `${root}:list`,
		deleteProject: `${root}:delete`,
		duplicateProject: `${root}:duplicate`,
		beginPublication: `${root}:publication:begin`,
		writePublicationChunk: `${root}:publication:chunk`,
		finishPublication: `${root}:publication:finish`,
		abortPublication: `${root}:publication:abort`,
	});
}
