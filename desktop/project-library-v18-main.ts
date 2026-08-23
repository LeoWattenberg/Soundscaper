/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV18Handshake,
	createFramescaperDesktopProjectLibraryV18Paths,
	DESKTOP_PROJECT_LIBRARY_V18_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V18_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V18_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV18Handshake,
	validateFramescaperDesktopProjectLibraryV18Owner,
} from './project-library-v18-contract.ts';
import { validateFramescaperDesktopV18CurrentProjectV27 } from './project-library-v18-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';
import {
	createFramescaperDesktopProjectLibraryV18Extension,
	type FramescaperDesktopProjectLibraryV18Qualification,
	type FramescaperDesktopProjectLibraryV18WriterSnapshot,
} from './project-library-v18-writer.ts';
import { framescaperDesktopProjectLibraryV12ClosedRecord as closedRecord } from './project-library-v12-values.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint', 'importCheckpoint'] as const;

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V18',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V18_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V18_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V18_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV18Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV18Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV18Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV18Owner,
	validateProject: (value: unknown) => validateFramescaperDesktopV18CurrentProjectV27(value),
});

export interface FramescaperDesktopProjectLibraryV18MainSnapshot
	extends FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly writer: Readonly<FramescaperDesktopProjectLibraryV18WriterSnapshot>;
}
export type FramescaperDesktopProjectLibraryV18MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Selected V18 owner with an exact lease/fence and immutable V17 copy-forward boundary. */
export class FramescaperDesktopProjectLibraryV18Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) {
		this.#core = core;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV18Main> {
		const options = closedRecord(value, START_FIELDS, 'Framescaper desktop V18 main options');
		if (typeof options.onLeaseLost !== 'function') {
			throw new TypeError('Framescaper desktop V18 onLeaseLost must be a function');
		}
		const qualification = validateQualification(options.qualification);
		return new FramescaperDesktopProjectLibraryV18Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner: options.owner,
				handshake: options.handshake,
			}, createFramescaperDesktopProjectLibraryV18Extension({
				onLeaseLost: options.onLeaseLost as (error: unknown) => void,
				qualification,
			})),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV18MainSnapshot> {
		return this.#core.snapshot() as Readonly<FramescaperDesktopProjectLibraryV18MainSnapshot>;
	}
	openSession(value: unknown): FramescaperDesktopProjectLibraryV18MainSession {
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

function validateQualification(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryV18Qualification> | null {
	if (value === null) return null;
	const record = closedRecord(value, QUALIFICATION_FIELDS, 'Framescaper desktop V18 qualification');
	if ((record.checkpoint !== null && typeof record.checkpoint !== 'function')
		|| (record.importCheckpoint !== null && typeof record.importCheckpoint !== 'function')) {
		throw new TypeError('Framescaper desktop V18 qualification checkpoints are invalid');
	}
	return Object.freeze({
		leaseTtlMs: record.leaseTtlMs as number,
		renewIntervalMs: record.renewIntervalMs as number,
		checkpoint: record.checkpoint as FramescaperDesktopProjectLibraryV18Qualification['checkpoint'],
		importCheckpoint: record.importCheckpoint as FramescaperDesktopProjectLibraryV18Qualification['importCheckpoint'],
	});
}
