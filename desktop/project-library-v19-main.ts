/* SPDX-License-Identifier: AGPL-3.0-only */

import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	createFramescaperDesktopProjectLibraryV19Handshake,
	createFramescaperDesktopProjectLibraryV19Paths,
	DESKTOP_PROJECT_LIBRARY_V19_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V19_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V19_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV19Handshake,
	validateFramescaperDesktopProjectLibraryV19Owner,
} from './project-library-v19-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV18Handshake,
	createFramescaperDesktopProjectLibraryV18Paths,
} from './project-library-v18-contract.ts';
import { FramescaperDesktopProjectLibraryV18Main } from './project-library-v18-main.ts';
import { validateFramescaperDesktopV19CurrentProjectV28 } from './project-library-v19-current-project.ts';
import {
	validateFramescaperDesktopV28Bodies,
	validateFramescaperDesktopV28BodyDescriptor,
} from '../src/framescaper/desktop-project-library-v28-body-contract.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from './project-library-exact-generation-contract.ts';
import { framescaperDesktopExactMediaPath } from './project-library-exact-generation-storage.ts';
import { materializeProjectLibraryNativeBody } from './project-library-native-body-materialization.ts';
import {
	createFramescaperDesktopProjectLibraryV19Extension,
	type FramescaperDesktopProjectLibraryV19Qualification,
	type FramescaperDesktopProjectLibraryV19WriterSnapshot,
} from './project-library-v19-writer.ts';
import { framescaperDesktopProjectLibraryV12ClosedRecord as closedRecord } from './project-library-v12-values.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint', 'importCheckpoint'] as const;

const CONFIGURATION = Object.freeze({
	label: 'Framescaper desktop V19',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V19_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V19_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V19_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV19Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV19Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV19Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV19Owner,
	validateProject: (value: unknown) => validateFramescaperDesktopV19CurrentProjectV28(value),
	validateBodyDescriptor: (value: unknown) => validateFramescaperDesktopV28BodyDescriptor(value),
	validateBodies: (project: unknown, projectSha256: string, value: unknown) => (
		validateFramescaperDesktopV28Bodies(
			validateFramescaperDesktopV19CurrentProjectV28(project), projectSha256, value,
		)
	),
});

export interface FramescaperDesktopProjectLibraryV19MainSnapshot
	extends FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly writer: Readonly<FramescaperDesktopProjectLibraryV19WriterSnapshot>;
}
export type FramescaperDesktopProjectLibraryV19MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Selected V19 owner with an exact lease/fence and immutable V18 copy-forward boundary. */
export class FramescaperDesktopProjectLibraryV19Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain,
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>) {
		this.#core = core;
		this.#paths = paths;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV19Main> {
		const options = closedRecord(value, START_FIELDS, 'Framescaper desktop V19 main options');
		if (typeof options.onLeaseLost !== 'function') {
			throw new TypeError('Framescaper desktop V19 onLeaseLost must be a function');
		}
		const qualification = validateQualification(options.qualification);
		const owner = validateFramescaperDesktopProjectLibraryV19Owner(options.owner);
		await settleV18Source({
			appDataPath: options.appDataPath as string,
			owner,
			onLeaseLost: options.onLeaseLost as (error: unknown) => void,
		});
		return new FramescaperDesktopProjectLibraryV19Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner,
				handshake: options.handshake,
			}, createFramescaperDesktopProjectLibraryV19Extension({
				onLeaseLost: options.onLeaseLost as (error: unknown) => void,
				qualification,
			})), CONFIGURATION.createPaths(options.appDataPath as string),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV19MainSnapshot> {
		return this.#core.snapshot() as Readonly<FramescaperDesktopProjectLibraryV19MainSnapshot>;
	}
	openSession(value: unknown): FramescaperDesktopProjectLibraryV19MainSession {
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
	materializeNativeBody(bodyValue: unknown, destination: string, signal?: AbortSignal) {
		const body = validateFramescaperDesktopV28BodyDescriptor(bodyValue);
		return materializeProjectLibraryNativeBody(
			framescaperDesktopExactMediaPath(this.#paths, body), destination, body, signal,
		);
	}
	close(): Promise<void> { return this.#core.close(); }
}

/**
 * V19 has one direct immutable source: V18. Let V18 settle its own older
 * lineage before the V19 importer takes a digest-bound snapshot. Existing V19
 * catalogs never reopen the source generation.
 */
async function settleV18Source(value: Readonly<{
	appDataPath: string;
	owner: Readonly<{ product: 'framescaper'; processId: number; instanceId: string }>;
	onLeaseLost(error: unknown): void;
}>): Promise<void> {
	const v19 = createFramescaperDesktopProjectLibraryV19Paths(value.appDataPath);
	if (await fileExists(v19.databasePath)) return;
	const v18 = createFramescaperDesktopProjectLibraryV18Paths(value.appDataPath);
	if (await fileExists(v18.databasePath) && v18SourceIsSettled(v18.databasePath)) return;
	const bootstrap = await FramescaperDesktopProjectLibraryV18Main.start({
		appDataPath: value.appDataPath,
		owner: {
			...value.owner,
			instanceId: `v19_v18_${value.owner.instanceId}`.slice(0, 128),
		},
		handshake: createFramescaperDesktopProjectLibraryV18Handshake(),
		onLeaseLost: value.onLeaseLost,
		qualification: null,
	});
	await bootstrap.close();
}

function v18SourceIsSettled(databasePath: string): boolean {
	let database: DatabaseSync | null = null;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true, timeout: 50 });
		const lineage = database.prepare('SELECT state FROM v17_import WHERE singleton = 1').get();
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
): Readonly<FramescaperDesktopProjectLibraryV19Qualification> | null {
	if (value === null) return null;
	const record = closedRecord(value, QUALIFICATION_FIELDS, 'Framescaper desktop V19 qualification');
	if ((record.checkpoint !== null && typeof record.checkpoint !== 'function')
		|| (record.importCheckpoint !== null && typeof record.importCheckpoint !== 'function')) {
		throw new TypeError('Framescaper desktop V19 qualification checkpoints are invalid');
	}
	return Object.freeze({
		leaseTtlMs: record.leaseTtlMs as number,
		renewIntervalMs: record.renewIntervalMs as number,
		checkpoint: record.checkpoint as FramescaperDesktopProjectLibraryV19Qualification['checkpoint'],
		importCheckpoint: record.importCheckpoint as FramescaperDesktopProjectLibraryV19Qualification['importCheckpoint'],
	});
}
