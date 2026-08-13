/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { createFramescaperScapeNativeRuntimeV18 } from '../src/framescaper/editor-scape-native-v18.ts';
import { FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v18.ts';
import { FramescaperScapeProjectFileV18 } from '../src/framescaper/scape-project-file-v18.ts';
import { FramescaperScapeArchiveV18 } from '../src/framescaper/scape-project-preservation-v18.ts';
import {
	archiveProject,
	createFramescaperV18ArchiveFixture,
	seedFramescaperV18ArchiveBodies,
} from './helpers/framescaper-v18-archive-fixture.ts';

const PROFILE = FRAMESCAPER_V18_PROJECT_RUNTIME_PROFILE;

test('native V18 save-copy validates and streams format-2 bytes unchanged', async (context) => {
	const { file } = await setup(context);
	const exported = await file.exportProject(archiveProject());
	assert.ok(exported.blob);
	const runtime = createFramescaperScapeNativeRuntimeV18(PROFILE, file);
	const chunks: Uint8Array[] = [];
	const result = await runtime.copyScapeArchive(
		exported.blob,
		(bytes) => { chunks.push(bytes.slice()); },
		{ signal: new AbortController().signal },
	);

	assert.deepEqual(result, { byteLength: exported.blob.size, schemaVersion: 18 });
	assert.deepEqual(join(chunks), new Uint8Array(await exported.blob.arrayBuffer()));
});

test('native V18 save-copy refuses a writable format-1 project', async (context) => {
	const { file } = await setup(context, false);
	const exported = await file.exportProject(archiveProject({ attached: false }));
	assert.ok(exported.blob);
	const runtime = createFramescaperScapeNativeRuntimeV18(PROFILE, file);
	let writes = 0;
	await assert.rejects(
		runtime.copyScapeArchive(
			exported.blob,
			() => { writes += 1; },
			{ signal: new AbortController().signal },
		),
		/intrinsically read-only/iu,
	);
	assert.equal(writes, 0);
});

async function setup(context: TestContext, attached = true) {
	const fixture = await createFramescaperV18ArchiveFixture(context);
	await seedFramescaperV18ArchiveBodies(fixture, attached);
	const archive = new FramescaperScapeArchiveV18(PROFILE, {
		store: fixture.store,
		port: fixture.port,
		opfs: fixture.opfs,
	});
	return {
		file: new FramescaperScapeProjectFileV18(PROFILE, {
			archive,
			store: fixture.store,
		}),
	};
}

function join(chunks: readonly Uint8Array[]): Uint8Array {
	const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
