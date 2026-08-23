/* SPDX-License-Identifier: AGPL-3.0-only */

import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	createFramescaperDesktopProjectLibraryV18Handshake,
	createFramescaperDesktopProjectLibraryV18Paths,
	DESKTOP_PROJECT_LIBRARY_V18_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V18_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V18_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV18Handshake,
	validateFramescaperDesktopProjectLibraryV18Owner,
} from './project-library-v18-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV12Paths,
} from './project-library-v12-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV17Handshake,
	createFramescaperDesktopProjectLibraryV17Paths,
} from './project-library-v17-contract.ts';
import { FramescaperDesktopProjectLibraryV17Main } from './project-library-v17-main.ts';
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
		const owner = validateFramescaperDesktopProjectLibraryV18Owner(options.owner);
		await settleDirectV12Lineage({
			appDataPath: options.appDataPath as string,
			owner,
			onLeaseLost: options.onLeaseLost as (error: unknown) => void,
		});
		return new FramescaperDesktopProjectLibraryV18Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner,
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

/**
 * A selected V18 install may encounter V12 without a previously launched V17.
 * Settle the existing V12 -> V17 copy-forward first, then let V18's normal
 * immutable V17 importer run. Existing V18 catalogs never reopen old scopes.
 */
async function settleDirectV12Lineage(value: Readonly<{
	appDataPath: string;
	owner: Readonly<{ product: 'framescaper'; processId: number; instanceId: string }>;
	onLeaseLost(error: unknown): void;
}>): Promise<void> {
	const v18 = createFramescaperDesktopProjectLibraryV18Paths(value.appDataPath);
	if (await fileExists(v18.databasePath)) return;
	const v17 = createFramescaperDesktopProjectLibraryV17Paths(value.appDataPath);
	const v12 = createFramescaperDesktopProjectLibraryV12Paths(value.appDataPath);
	const hasV17 = await fileExists(v17.databasePath);
	if (hasV17 && v17SourceIsSettled(v17.databasePath)) return;
	if (!hasV17 && !await fileExists(v12.databasePath)) return;
	const bootstrap = await FramescaperDesktopProjectLibraryV17Main.start({
		appDataPath: value.appDataPath,
		owner: {
			...value.owner,
			instanceId: `v18_v17_${value.owner.instanceId}`.slice(0, 128),
		},
		handshake: createFramescaperDesktopProjectLibraryV17Handshake(),
		onLeaseLost: value.onLeaseLost,
		qualification: null,
	});
	await bootstrap.close();
}

function v17SourceIsSettled(databasePath: string): boolean {
	let database: DatabaseSync | null = null;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true, timeout: 50 });
		const lineage = database.prepare('SELECT state FROM v12_import WHERE singleton = 1').get();
		const lease = database.prepare('SELECT active FROM library_lease WHERE singleton = 1').get();
		const journals = Number(database.prepare(
			'SELECT COUNT(*) AS count FROM publication_journal',
		).get()?.count);
		return lineage?.state === 'complete' && lease?.active === 0 && journals === 0;
	} catch {
		return false;
	} finally {
		database?.close();
	}
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
		throw error;
	}
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
