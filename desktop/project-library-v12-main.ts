/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV12Handshake,
	createFramescaperDesktopProjectLibraryV12Paths,
	DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV12Handshake,
	validateFramescaperDesktopProjectLibraryV12Owner,
} from './project-library-v12-contract.ts';
import { validateFramescaperDesktopCurrentProjectV20 } from './project-library-v12-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V12',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V12_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V12_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV12Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV12Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV12Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV12Owner,
	validateProject: (value: unknown) => validateFramescaperDesktopCurrentProjectV20(value),
});

export type FramescaperDesktopProjectLibraryV12MainSnapshot =
	FramescaperDesktopProjectLibraryExactGenerationMainSnapshot;
export type FramescaperDesktopProjectLibraryV12MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Selected V12 wrapper over the shared exact-generation owner. */
export class FramescaperDesktopProjectLibraryV12Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) {
		this.#core = core;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV12Main> {
		return new FramescaperDesktopProjectLibraryV12Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, value),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV12MainSnapshot> { return this.#core.snapshot(); }
	openSession(value: unknown): FramescaperDesktopProjectLibraryV12MainSession {
		return this.#core.openSession(value);
	}
	nativeProjectState(projectId: string): Readonly<{ open: boolean; writable: boolean }> {
		return this.#core.nativeProjectState(projectId);
	}
	nativeProjectRecord(
		projectId: string,
	): ReturnType<FramescaperDesktopProjectLibraryExactGenerationMain['nativeProjectRecord']> {
		return this.#core.nativeProjectRecord(projectId);
	}
	readNativeProjectBundle(projectId: string): Promise<unknown> {
		return this.#core.readNativeProjectBundle(projectId);
	}
	readNativeBody(body: unknown): Promise<Uint8Array> { return this.#core.readNativeBody(body); }
	close(): Promise<void> { return this.#core.close(); }
}
