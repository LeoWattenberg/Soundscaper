/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryV17Handshake,
	createFramescaperDesktopProjectLibraryV17Paths,
	DESKTOP_PROJECT_LIBRARY_V17_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V17_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V17_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV17Handshake,
	validateFramescaperDesktopProjectLibraryV17Owner,
} from './project-library-v17-contract.ts';
import { validateFramescaperDesktopV17CurrentProjectV20 } from './project-library-v17-current-project.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';
import {
	createFramescaperDesktopProjectLibraryV17Extension,
	type FramescaperDesktopProjectLibraryV17Qualification,
	type FramescaperDesktopProjectLibraryV17WriterSnapshot,
} from './project-library-v17-writer.ts';
import { framescaperDesktopProjectLibraryV12ClosedRecord as closedRecord } from './project-library-v12-values.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint', 'importCheckpoint'] as const;

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V17',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V17_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V17_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V17_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV17Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV17Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV17Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV17Owner,
	validateProject: (value: unknown) => validateFramescaperDesktopV17CurrentProjectV20(value),
});

export interface FramescaperDesktopProjectLibraryV17MainSnapshot
	extends FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly writer: Readonly<FramescaperDesktopProjectLibraryV17WriterSnapshot>;
}
export type FramescaperDesktopProjectLibraryV17MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Selected V17 owner with an exact lease/fence and immutable V12 copy-forward boundary. */
export class FramescaperDesktopProjectLibraryV17Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain) {
		this.#core = core;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV17Main> {
		const options = closedRecord(value, START_FIELDS, 'Framescaper desktop V17 main options');
		if (typeof options.onLeaseLost !== 'function') {
			throw new TypeError('Framescaper desktop V17 onLeaseLost must be a function');
		}
		const qualification = validateQualification(options.qualification);
		return new FramescaperDesktopProjectLibraryV17Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner: options.owner,
				handshake: options.handshake,
			}, createFramescaperDesktopProjectLibraryV17Extension({
				onLeaseLost: options.onLeaseLost as (error: unknown) => void,
				qualification,
			})),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV17MainSnapshot> {
		return this.#core.snapshot() as Readonly<FramescaperDesktopProjectLibraryV17MainSnapshot>;
	}
	openSession(value: unknown): FramescaperDesktopProjectLibraryV17MainSession {
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
): Readonly<FramescaperDesktopProjectLibraryV17Qualification> | null {
	if (value === null) return null;
	const record = closedRecord(value, QUALIFICATION_FIELDS, 'Framescaper desktop V17 qualification');
	if ((record.checkpoint !== null && typeof record.checkpoint !== 'function')
		|| (record.importCheckpoint !== null && typeof record.importCheckpoint !== 'function')) {
		throw new TypeError('Framescaper desktop V17 qualification checkpoints are invalid');
	}
	return Object.freeze({
		leaseTtlMs: record.leaseTtlMs as number,
		renewIntervalMs: record.renewIntervalMs as number,
		checkpoint: record.checkpoint as FramescaperDesktopProjectLibraryV17Qualification['checkpoint'],
		importCheckpoint: record.importCheckpoint as FramescaperDesktopProjectLibraryV17Qualification['importCheckpoint'],
	});
}
