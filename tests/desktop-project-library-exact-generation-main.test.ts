/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
	createFramescaperDesktopProjectLibraryV12Handshake,
} from '../desktop/project-library-v12-contract.ts';
import {
	createFramescaperDesktopProjectLibraryV13Handshake,
	createFramescaperDesktopProjectLibraryV13Paths,
} from '../desktop/project-library-v13-contract.ts';
import { FramescaperDesktopProjectLibraryV13Main } from '../desktop/project-library-v13-main.ts';
import {
	createFramescaperDesktopProjectLibraryV14Handshake,
	createFramescaperDesktopProjectLibraryV14Paths,
} from '../desktop/project-library-v14-contract.ts';
import { FramescaperDesktopProjectLibraryV14Main } from '../desktop/project-library-v14-main.ts';
import {
	createFramescaperDesktopProjectLibraryV15Handshake,
	createFramescaperDesktopProjectLibraryV15Paths,
} from '../desktop/project-library-v15-contract.ts';
import { FramescaperDesktopProjectLibraryV15Main } from '../desktop/project-library-v15-main.ts';
import {
	createFramescaperDesktopProjectLibraryV16Handshake,
	createFramescaperDesktopProjectLibraryV16Paths,
} from '../desktop/project-library-v16-contract.ts';
import { FramescaperDesktopProjectLibraryV16Main } from '../desktop/project-library-v16-main.ts';

interface CandidateMain {
	readonly localHandshake: unknown;
	openSession(handshake: unknown): Readonly<{ close(): Promise<void> }>;
	close(): Promise<void>;
}

test('V13-V16 mains share the core while retaining exact SQLite and handshake identities', async () => {
	const root = await mkdtemp(join(tmpdir(), 'framescaper-exact-main-'));
	const owner = Object.freeze({ product: 'framescaper' as const, processId: 42, instanceId: 'candidate-main-test' });
	const candidates = [
		candidate(13, 22, 15, createFramescaperDesktopProjectLibraryV13Handshake,
			createFramescaperDesktopProjectLibraryV13Paths, FramescaperDesktopProjectLibraryV13Main.start),
		candidate(14, 24, 16, createFramescaperDesktopProjectLibraryV14Handshake,
			createFramescaperDesktopProjectLibraryV14Paths, FramescaperDesktopProjectLibraryV14Main.start),
		candidate(15, 25, 17, createFramescaperDesktopProjectLibraryV15Handshake,
			createFramescaperDesktopProjectLibraryV15Paths, FramescaperDesktopProjectLibraryV15Main.start),
		candidate(16, 26, 18, createFramescaperDesktopProjectLibraryV16Handshake,
			createFramescaperDesktopProjectLibraryV16Paths, FramescaperDesktopProjectLibraryV16Main.start),
	] as const;
	try {
		for (const entry of candidates) {
			const handshake = entry.handshake();
			const main = await entry.start({ appDataPath: root, owner, handshake });
			try {
				assert.deepEqual(main.localHandshake, handshake);
				const session = main.openSession(handshake);
				await session.close();
				assert.throws(() => main.openSession(createFramescaperDesktopProjectLibraryV12Handshake()), /unsupported/iu);
				const database = new DatabaseSync(entry.paths(root).databasePath, { readOnly: true });
				try {
					assert.equal(pragma(database, 'user_version'), entry.database);
					assert.equal(pragma(database, 'application_id'), 0x46534350);
					const identity = database.prepare(
						'SELECT schema_version, project_schema_version FROM library_identity',
					).get() as Record<string, unknown>;
					assert.equal(identity.schema_version, entry.library);
					assert.equal(identity.project_schema_version, entry.project);
				} finally { database.close(); }
			} finally { await main.close(); }
		}
		assert.equal(new Set(candidates.map((entry) => entry.paths(root).databasePath)).size, 4);
	} finally { await rm(root, { recursive: true, force: true }); }
});

function candidate(
	library: number,
	project: number,
	database: number,
	handshake: () => unknown,
	paths: (root: string) => Readonly<{ databasePath: string }>,
	start: (value: unknown) => Promise<CandidateMain>,
) {
	return Object.freeze({ library, project, database, handshake, paths, start });
}

function pragma(database: DatabaseSync, name: 'application_id' | 'user_version'): unknown {
	return (database.prepare(`PRAGMA ${name}`).get() as Record<string, unknown>)[name];
}
