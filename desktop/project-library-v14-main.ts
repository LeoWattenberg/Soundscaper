/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV14Handshake,
	createFramescaperDesktopProjectLibraryV14Paths,
	DESKTOP_PROJECT_LIBRARY_V14_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V14_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V14_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV14Handshake,
	validateFramescaperDesktopProjectLibraryV14Owner,
} from './project-library-v14-contract.ts';
import { validateFramescaperDesktopCurrentProjectV24 } from './project-library-v14-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V14',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V14_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V14_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V14_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV14Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV14Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV14Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV14Owner,
	validateProject: validateFramescaperDesktopCurrentProjectV24,
});

export type FramescaperDesktopProjectLibraryV14MainSnapshot =
	FramescaperDesktopProjectLibraryExactGenerationMainSnapshot;
export type FramescaperDesktopProjectLibraryV14MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

export class FramescaperDesktopProjectLibraryV14Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) { this.#core = core; }
	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV14Main> {
		return new FramescaperDesktopProjectLibraryV14Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, value),
		);
	}
	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV14MainSnapshot> { return this.#core.snapshot(); }
	openSession(value: unknown): FramescaperDesktopProjectLibraryV14MainSession { return this.#core.openSession(value); }
	close(): Promise<void> { return this.#core.close(); }
}
