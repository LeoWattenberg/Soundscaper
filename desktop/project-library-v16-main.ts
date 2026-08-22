/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV16Handshake,
	createFramescaperDesktopProjectLibraryV16Paths,
	DESKTOP_PROJECT_LIBRARY_V16_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V16_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V16_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV16Handshake,
	validateFramescaperDesktopProjectLibraryV16Owner,
} from './project-library-v16-contract.ts';
import { validateFramescaperDesktopCurrentProjectV26 } from './project-library-v16-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V16',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V16_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V16_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V16_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV16Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV16Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV16Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV16Owner,
	validateProject: validateFramescaperDesktopCurrentProjectV26,
});

export type FramescaperDesktopProjectLibraryV16MainSnapshot =
	FramescaperDesktopProjectLibraryExactGenerationMainSnapshot;
export type FramescaperDesktopProjectLibraryV16MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

export class FramescaperDesktopProjectLibraryV16Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) { this.#core = core; }
	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV16Main> {
		return new FramescaperDesktopProjectLibraryV16Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, value),
		);
	}
	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV16MainSnapshot> { return this.#core.snapshot(); }
	openSession(value: unknown): FramescaperDesktopProjectLibraryV16MainSession { return this.#core.openSession(value); }
	close(): Promise<void> { return this.#core.close(); }
}
