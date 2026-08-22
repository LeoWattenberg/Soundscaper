/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV15Handshake,
	createFramescaperDesktopProjectLibraryV15Paths,
	DESKTOP_PROJECT_LIBRARY_V15_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V15_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V15_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV15Handshake,
	validateFramescaperDesktopProjectLibraryV15Owner,
} from './project-library-v15-contract.ts';
import { validateFramescaperDesktopCurrentProjectV25 } from './project-library-v15-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V15',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V15_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V15_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V15_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV15Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV15Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV15Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV15Owner,
	validateProject: validateFramescaperDesktopCurrentProjectV25,
});

export type FramescaperDesktopProjectLibraryV15MainSnapshot =
	FramescaperDesktopProjectLibraryExactGenerationMainSnapshot;
export type FramescaperDesktopProjectLibraryV15MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

export class FramescaperDesktopProjectLibraryV15Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) { this.#core = core; }
	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV15Main> {
		return new FramescaperDesktopProjectLibraryV15Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, value),
		);
	}
	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV15MainSnapshot> { return this.#core.snapshot(); }
	openSession(value: unknown): FramescaperDesktopProjectLibraryV15MainSession { return this.#core.openSession(value); }
	close(): Promise<void> { return this.#core.close(); }
}
