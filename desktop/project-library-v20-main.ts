/* SPDX-License-Identifier: AGPL-3.0-only */

import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	createFramescaperDesktopProjectLibraryV20Handshake,
	createFramescaperDesktopProjectLibraryV20Paths,
	DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryV20Handshake,
	validateFramescaperDesktopProjectLibraryV20Owner,
} from './project-library-v20-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV19Handshake,
	createFramescaperDesktopProjectLibraryV19Paths,
} from './project-library-v19-contract.ts';
import { FramescaperDesktopProjectLibraryV19Main } from './project-library-v19-main.ts';
import { validateFramescaperDesktopV20CurrentProjectV31 } from './project-library-v20-current-project.ts';
import {
	validateFramescaperDesktopV31Bodies,
	validateFramescaperDesktopV31BodyDescriptor,
} from '../src/framescaper/desktop-project-library-v31-body-contract.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from './project-library-exact-generation-contract.ts';
import { framescaperDesktopExactMediaPath } from './project-library-exact-generation-storage.ts';
import { materializeProjectLibraryNativeBody } from './project-library-native-body-materialization.ts';
import {
	createFramescaperDesktopProjectLibraryV20Extension,
	type FramescaperDesktopProjectLibraryV20Qualification,
	type FramescaperDesktopProjectLibraryV20WriterSnapshot,
} from './project-library-v20-writer.ts';
import { framescaperDesktopProjectLibraryV12ClosedRecord as closedRecord } from './project-library-v12-values.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'qualification'] as const;
const QUALIFICATION_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint', 'importCheckpoint'] as const;

const CONFIGURATION = Object.freeze({
	maximumBodies: 5_118,
	label: 'Framescaper desktop V20',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_SCHEMA_VERSION,
	projectSchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_V20_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_V20_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryV20Handshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryV20Handshake,
	createPaths: createFramescaperDesktopProjectLibraryV20Paths,
	validateOwner: validateFramescaperDesktopProjectLibraryV20Owner,
	validateProject: (value: unknown) => validateFramescaperDesktopV20CurrentProjectV31(value),
	validateBodyDescriptor: (value: unknown) => validateFramescaperDesktopV31BodyDescriptor(value),
	validateBodies: (project: unknown, projectSha256: string, value: unknown) => (
		validateFramescaperDesktopV31Bodies(
			validateFramescaperDesktopV20CurrentProjectV31(project), projectSha256, value,
		)
	),
});

export interface FramescaperDesktopProjectLibraryV20MainSnapshot
	extends FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly writer: Readonly<FramescaperDesktopProjectLibraryV20WriterSnapshot>;
}
export type FramescaperDesktopProjectLibraryV20MainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Selected V20 owner with an exact lease/fence and immutable V19 copy-forward boundary. */
export class FramescaperDesktopProjectLibraryV20Main {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain,
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>) {
		this.#core = core;
		this.#paths = paths;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryV20Main> {
		const options = closedRecord(value, START_FIELDS, 'Framescaper desktop V20 main options');
		if (typeof options.onLeaseLost !== 'function') {
			throw new TypeError('Framescaper desktop V20 onLeaseLost must be a function');
		}
		const qualification = validateQualification(options.qualification);
		const owner = validateFramescaperDesktopProjectLibraryV20Owner(options.owner);
		await settleV19Source({
			appDataPath: options.appDataPath as string,
			owner,
			onLeaseLost: options.onLeaseLost as (error: unknown) => void,
		});
		return new FramescaperDesktopProjectLibraryV20Main(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner,
				handshake: options.handshake,
			}, createFramescaperDesktopProjectLibraryV20Extension({
				onLeaseLost: options.onLeaseLost as (error: unknown) => void,
				qualification,
			})), CONFIGURATION.createPaths(options.appDataPath as string),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryV20MainSnapshot> {
		return this.#core.snapshot() as Readonly<FramescaperDesktopProjectLibraryV20MainSnapshot>;
	}
	openSession(value: unknown): FramescaperDesktopProjectLibraryV20MainSession {
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
		const body = validateFramescaperDesktopV31BodyDescriptor(bodyValue);
		return materializeProjectLibraryNativeBody(
			framescaperDesktopExactMediaPath(this.#paths, body), destination, body, signal,
		);
	}
	close(): Promise<void> { return this.#core.close(); }
}

/**
 * V20 has one direct immutable source: V19. Let V19 settle its own older
 * lineage before the V20 importer takes a digest-bound snapshot. Existing V20
 * catalogs never reopen the source generation.
 */
async function settleV19Source(value: Readonly<{
	appDataPath: string;
	owner: Readonly<{ product: 'framescaper'; processId: number; instanceId: string }>;
	onLeaseLost(error: unknown): void;
}>): Promise<void> {
	const v20 = createFramescaperDesktopProjectLibraryV20Paths(value.appDataPath);
	if (await fileExists(v20.databasePath)) return;
	const v19 = createFramescaperDesktopProjectLibraryV19Paths(value.appDataPath);
	if (await fileExists(v19.databasePath) && v19SourceIsSettled(v19.databasePath)) return;
	const bootstrap = await FramescaperDesktopProjectLibraryV19Main.start({
		appDataPath: value.appDataPath,
		owner: {
			...value.owner,
			instanceId: `v20_v19_${value.owner.instanceId}`.slice(0, 128),
		},
		handshake: createFramescaperDesktopProjectLibraryV19Handshake(),
		onLeaseLost: value.onLeaseLost,
		qualification: null,
	});
	await bootstrap.close();
}

function v19SourceIsSettled(databasePath: string): boolean {
	let database: DatabaseSync | null = null;
	try {
		database = new DatabaseSync(databasePath, { readOnly: true, timeout: 50 });
		const lineage = database.prepare('SELECT state FROM v18_import WHERE singleton = 1').get();
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
): Readonly<FramescaperDesktopProjectLibraryV20Qualification> | null {
	if (value === null) return null;
	const record = closedRecord(value, QUALIFICATION_FIELDS, 'Framescaper desktop V20 qualification');
	if ((record.checkpoint !== null && typeof record.checkpoint !== 'function')
		|| (record.importCheckpoint !== null && typeof record.importCheckpoint !== 'function')) {
		throw new TypeError('Framescaper desktop V20 qualification checkpoints are invalid');
	}
	return Object.freeze({
		leaseTtlMs: record.leaseTtlMs as number,
		renewIntervalMs: record.renewIntervalMs as number,
		checkpoint: record.checkpoint as FramescaperDesktopProjectLibraryV20Qualification['checkpoint'],
		importCheckpoint: record.importCheckpoint as FramescaperDesktopProjectLibraryV20Qualification['importCheckpoint'],
	});
}
