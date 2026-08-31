/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	createFramescaperDesktopProjectLibraryHandshake,
	createFramescaperDesktopProjectLibraryPaths,
	DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	validateFramescaperDesktopProjectLibraryHandshake,
	validateFramescaperDesktopProjectLibraryOwner,
} from './framescaper-project-library-contract.ts';
import { validateFramescaperDesktopCurrentProject } from './framescaper-project-library-current-project.ts';
import {
	validateFramescaperDesktopBodies,
	validateFramescaperDesktopBodyDescriptor,
} from '../src/framescaper/desktop-project-library-body-contract.ts';
import {
	FramescaperDesktopProjectLibraryExactGenerationMain,
	type FramescaperDesktopProjectLibraryExactGenerationMainSession,
	type FramescaperDesktopProjectLibraryExactGenerationMainSnapshot,
} from './project-library-exact-generation-main.ts';
import type { FramescaperDesktopProjectLibraryExactGenerationPaths } from './project-library-exact-generation-contract.ts';
import { framescaperDesktopExactMediaPath } from './project-library-exact-generation-storage.ts';
import { materializeProjectLibraryNativeBody } from './project-library-native-body-materialization.ts';
import {
	createFramescaperDesktopProjectLibraryExtension,
	type FramescaperDesktopProjectLibraryTestControl,
	type FramescaperDesktopProjectLibraryWriterSnapshot,
} from './framescaper-project-library-writer.ts';
import { framescaperDesktopProjectLibraryClosedRecord as closedRecord } from './framescaper-project-library-values.ts';

const START_FIELDS = ['appDataPath', 'owner', 'handshake', 'onLeaseLost', 'testControl'] as const;
const TEST_CONTROL_FIELDS = ['leaseTtlMs', 'renewIntervalMs', 'checkpoint'] as const;

const CONFIGURATION = Object.freeze({
	maximumBodies: 5_118,
	label: 'Framescaper desktop 1.0',
	librarySchemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_SCHEMA_VERSION,
	schemaFamily: 'framescaper' as const,
	schemaVersion: FRAMESCAPER_DESKTOP_LIBRARY_PROJECT_SCHEMA_VERSION,
	databaseUserVersion: DESKTOP_PROJECT_LIBRARY_DATABASE_VERSION,
	createHandshake: createFramescaperDesktopProjectLibraryHandshake,
	validateHandshake: validateFramescaperDesktopProjectLibraryHandshake,
	createPaths: createFramescaperDesktopProjectLibraryPaths,
	validateOwner: validateFramescaperDesktopProjectLibraryOwner,
	validateProject: (value: unknown) => validateFramescaperDesktopCurrentProject(value),
	validateBodyDescriptor: (value: unknown) => validateFramescaperDesktopBodyDescriptor(value),
	validateBodies: (project: unknown, projectSha256: string, value: unknown) => (
		validateFramescaperDesktopBodies(
			validateFramescaperDesktopCurrentProject(project), projectSha256, value,
		)
	),
});

export interface FramescaperDesktopProjectLibraryMainSnapshot
	extends FramescaperDesktopProjectLibraryExactGenerationMainSnapshot {
	readonly writer: Readonly<FramescaperDesktopProjectLibraryWriterSnapshot>;
}
export type FramescaperDesktopProjectLibraryMainSession =
	FramescaperDesktopProjectLibraryExactGenerationMainSession;

/** Framescaper 1.0 owner with an exact lease, fence, and crash-recovery boundary. */
export class FramescaperDesktopProjectLibraryMain {
	readonly #core: FramescaperDesktopProjectLibraryExactGenerationMain;
	readonly #paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>;

	private constructor(core: FramescaperDesktopProjectLibraryExactGenerationMain,
		paths: Readonly<FramescaperDesktopProjectLibraryExactGenerationPaths>) {
		this.#core = core;
		this.#paths = paths;
	}

	static async start(value: unknown): Promise<FramescaperDesktopProjectLibraryMain> {
		const options = closedRecord(value, START_FIELDS, 'Framescaper desktop 1.0 main options');
		if (typeof options.onLeaseLost !== 'function') {
			throw new TypeError('Framescaper desktop 1.0 onLeaseLost must be a function');
		}
		const testControl = validateTestControl(options.testControl);
		const owner = validateFramescaperDesktopProjectLibraryOwner(options.owner);
		return new FramescaperDesktopProjectLibraryMain(
			await FramescaperDesktopProjectLibraryExactGenerationMain.start(CONFIGURATION, {
				appDataPath: options.appDataPath,
				owner,
				handshake: options.handshake,
			}, createFramescaperDesktopProjectLibraryExtension({
				onLeaseLost: options.onLeaseLost as (error: unknown) => void,
				testControl,
			})), CONFIGURATION.createPaths(options.appDataPath as string),
		);
	}

	get localHandshake(): unknown { return this.#core.localHandshake; }
	snapshot(): Readonly<FramescaperDesktopProjectLibraryMainSnapshot> {
		return this.#core.snapshot() as Readonly<FramescaperDesktopProjectLibraryMainSnapshot>;
	}
	openSession(value: unknown): FramescaperDesktopProjectLibraryMainSession {
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
		const body = validateFramescaperDesktopBodyDescriptor(bodyValue);
		return materializeProjectLibraryNativeBody(
			framescaperDesktopExactMediaPath(this.#paths, body), destination, body, signal,
		);
	}
	close(): Promise<void> { return this.#core.close(); }
}

function validateTestControl(
	value: unknown,
): Readonly<FramescaperDesktopProjectLibraryTestControl> | null {
	if (value === null) return null;
	const record = closedRecord(value, TEST_CONTROL_FIELDS, 'Framescaper desktop 1.0 test control');
	if (record.checkpoint !== null && typeof record.checkpoint !== 'function') {
		throw new TypeError('Framescaper desktop 1.0 test-control checkpoints are invalid');
	}
	return Object.freeze({
		leaseTtlMs: record.leaseTtlMs as number,
		renewIntervalMs: record.renewIntervalMs as number,
		checkpoint: record.checkpoint as FramescaperDesktopProjectLibraryTestControl['checkpoint'],
	});
}
