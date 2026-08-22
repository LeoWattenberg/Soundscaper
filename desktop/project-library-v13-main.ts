/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV13Handshake,
	createFramescaperDesktopProjectLibraryV13Paths,
	DESKTOP_PROJECT_LIBRARY_V13_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V13_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V13_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV13Handshake,
	validateFramescaperDesktopProjectLibraryV13Owner,
} from './project-library-v13-contract.ts';
import { validateFramescaperDesktopCurrentProjectV22 } from './project-library-v13-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V13',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V13_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V13_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V13_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV13Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV13Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV13Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV13Owner,
	validateProject: validateFramescaperDesktopCurrentProjectV22,
});

export type FramescaperDesktopProjectLibraryV13MainSnapshot =
	FramescaperDesktopProjectLibraryExactGenerationMainSnapshot;
export type FramescaperDesktopProjectLibraryV13MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

export class FramescaperDesktopProjectLibraryV13Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) { this.#core = core; }
	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV13Main> {
		return new FramescaperDesktopProjectLibraryV13Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, value),
		);
	}
	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV13MainSnapshot> { return this.#core.snapshot(); }
	openSession(value: unknown): FramescaperDesktopProjectLibraryV13MainSession { return this.#core.openSession(value); }
	close(): Promise<void> { return this.#core.close(); }
}
