/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import test from 'node:test';

import {
	FramescaperDesktopProjectLibraryV10ProxyMediaInventory,
} from '../desktop/project-library-v10-proxy-media-inventory.ts';
import {
	createFramescaperDesktopProjectLibraryV10Handshake,
} from '../desktop/project-library-v10-contract.ts';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE = 'desktop/project-library-v10-proxy-media-inventory.ts';
const TEST_MODULE = 'tests/desktop-project-library-v10-proxy-media-inventory.test.ts';
const MODULE_STEM = 'project-library-v10-proxy-media-inventory';
const PROJECT_DIGEST = 'a'.repeat(64);
const BINDING_ID = `p${'c'.repeat(64)}`;
const BODY = new TextEncoder().encode('exact Framescaper V10 proxy bytes');
const BODY_DIGEST = digest(BODY);

test('constructs an inert exact Framescaper V10 inventory owner', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = FramescaperDesktopProjectLibraryV10ProxyMediaInventory.create({
		appDataPath: fixture.appDataRoot,
		owner: owner(),
	});
	assert.deepEqual(inventory.owner, owner());
	assert.equal(Object.isFrozen(inventory.owner), true);
	assert.equal(relative(fixture.appDataRoot, inventory.paths.libraryRoot),
		join('kw.media', 'scape-project-library', 'v10'));
	assert.equal(relative(inventory.paths.libraryRoot, inventory.paths.managedMediaRoot), 'media');
	assert.equal(inventory.handshakeState(), 'pending');
	assert.deepEqual(inventory.localHandshake, {
		kind: 'framescaper-project-library-handshake',
		version: 1,
		owner: 'framescaper',
		projectSchemaVersion: 18,
		scapeFormatVersions: [1, 2],
		attachedScapeFormatVersion: 2,
		storageDatabaseName: 'kw-media-framescaper-editor-v18',
		desktopLibrarySchemaVersion: 10,
		desktopDatabaseUserVersion: 12,
		desktopLibraryScope: ['kw.media', 'scape-project-library', 'v10'],
	});
	await assert.rejects(access(inventory.paths.libraryRoot), /ENOENT/u);
	assert.equal(Object.isFrozen(inventory.paths), true);
	assert.equal(Object.isFrozen(inventory.localHandshake), true);
	assert.equal(Object.isFrozen(inventory), true);
});

test('refuses every non-Framescaper owner and open constructor shape before I/O', async (context) => {
	const fixture = await fixtureFor(context);
	for (const value of [
		{ appDataPath: fixture.appDataRoot, owner: { ...owner(), product: 'soundscaper' } },
		{ appDataPath: fixture.appDataRoot, owner: owner(), extra: true },
		{ appDataPath: 'relative', owner: owner() },
		null,
	]) assert.throws(
		() => FramescaperDesktopProjectLibraryV10ProxyMediaInventory.create(value),
		TypeError,
	);
	await assert.rejects(access(join(fixture.appDataRoot, 'kw.media')), /ENOENT/u);
});

test('requires the exact handshake before metadata observation or operational I/O', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = createInventory(fixture);
	const metadata = zeroTrapProxy({});
	await assert.rejects(inventory.audit(metadata.proxy), /handshake.*required/iu);
	assert.deepEqual(metadata.hits, [0, 0, 0, 0]);
	await assert.rejects(access(inventory.paths.managedMediaRoot), /ENOENT/u);

	assert.throws(() => inventory.acceptHandshake({
		...createFramescaperDesktopProjectLibraryV10Handshake(),
		desktopDatabaseUserVersion: 11,
	}), /handshake/iu);
	assert.equal(inventory.handshakeState(), 'refused');
	assert.throws(
		() => inventory.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake()),
		/refused/iu,
	);
	await assert.rejects(inventory.audit(validMetadata()), /refused/iu);
	await assert.rejects(access(inventory.paths.managedMediaRoot), /ENOENT/u);
});

test('audits exact V10 proxy inventory through bounded file reads', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = createInventory(fixture);
	await publishFixture(inventory.paths.managedMediaRoot);
	inventory.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	const audit = await inventory.audit(validMetadata());
	assert.deepEqual(audit, {
		owner: 'framescaper',
		librarySchemaVersion: 10,
		projectSchemaVersion: 18,
		databaseUserVersion: 12,
		metadataRevision: 1,
		totalBytes: BODY.byteLength,
		media: [{
			id: BINDING_ID,
			relativeFile: relativeFile(),
			byteLength: BODY.byteLength,
			sha256: BODY_DIGEST,
		}],
	});
	assert.equal(Object.isFrozen(audit), true);
	assert.equal(Object.isFrozen(audit.media), true);
	assert.ok(audit.media.every((entry) => Object.isFrozen(entry)));
});

test('enforces metadata schema 10, project schema 18, and Framescaper ownership before file work', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = createInventory(fixture);
	inventory.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	for (const replacement of [
		{ schemaVersion: 9 },
		{ projects: [{ ...validMetadata().projects[0], projectSchemaVersion: 17 }] },
		{ projects: [{ ...validMetadata().projects[0], preferredProduct: 'soundscaper' }] },
		{ media: [{ ...validMetadata().media[0], category: 'video' }] },
	]) await assert.rejects(
		inventory.audit({ ...validMetadata(), ...replacement }),
		/Framescaper|schema|proxy|owner/iu,
	);
	await assert.rejects(access(inventory.paths.managedMediaRoot), /ENOENT/u);
});

test('refuses missing, orphaned, linked, changed-length, and changed-digest bodies', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = createInventory(fixture);
	inventory.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	const bodyPath = await publishFixture(inventory.paths.managedMediaRoot);

	await rm(bodyPath);
	await assert.rejects(inventory.audit(validMetadata()), /missing|inventory|expected/iu);
	await writeFile(bodyPath, BODY);
	const orphan = join(inventory.paths.managedMediaRoot, 'proxy', 'ff', `p${'f'.repeat(64)}.bin`);
	await mkdir(join(orphan, '..'), { recursive: true });
	await writeFile(orphan, BODY);
	await assert.rejects(inventory.audit(validMetadata()), /unexpected|inventory|orphan/iu);
	await rm(orphan);

	const link = join(inventory.paths.managedMediaRoot, 'proxy', 'dd', `p${'d'.repeat(64)}.bin`);
	await mkdir(join(link, '..'), { recursive: true });
	await symlink(bodyPath, link);
	await assert.rejects(inventory.audit(validMetadata()), /symbolic|unsupported|inventory/iu);
	await rm(link);

	await writeFile(bodyPath, new Uint8Array(BODY.byteLength - 1));
	await assert.rejects(inventory.audit(validMetadata()), /length|size/iu);
	await writeFile(bodyPath, new Uint8Array(BODY.byteLength));
	await assert.rejects(inventory.audit(validMetadata()), /digest|SHA-256/iu);
});

test('bounds proxy bytes and honors pre-I/O cancellation', async (context) => {
	const fixture = await fixtureFor(context);
	const inventory = createInventory(fixture);
	inventory.acceptHandshake(createFramescaperDesktopProjectLibraryV10Handshake());
	await assert.rejects(inventory.audit({
		...validMetadata(),
		media: [{ ...validMetadata().media[0], byteLength: 512 * 1024 * 1024 + 1 }],
	}), /maximum|512|byte/iu);

	const controller = new AbortController();
	controller.abort(new Error('inventory cancelled'));
	await assert.rejects(inventory.audit(validMetadata(), controller.signal), /inventory cancelled/iu);
	await assert.rejects(access(inventory.paths.managedMediaRoot), /ENOENT/u);
});

test('stays isolated from every V9 owner, product entrypoint, and runtime selector', async () => {
	const source = await readSource(MODULE);
	assert.deepEqual(importSpecifiers(source), [
		'node:crypto',
		'node:fs',
		'node:fs/promises',
		'node:path',
		'./project-library-v10-contract.ts',
		'./project-library-v10-handshake-gate.ts',
		'./project-library-v10-metadata.ts',
	]);
	assert.doesNotMatch(source,
		/from ['"]\.\/project-library-(?!v10)|main\.mjs|preload|ipc|electron|project-runtime-profile|editor-project-v18|soundscaper|productId/iu);
	const references: string[] = [];
	for (const file of await sourceFiles(['desktop', 'src', 'tests'])) {
		if ((await readSource(file)).includes(MODULE_STEM)) references.push(file);
	}
	assert.deepEqual(references, [
		'tests/audio-editor-framescaper-project-storage-profile.test.ts',
		TEST_MODULE,
	]);
	for (const legacy of [
		'desktop/project-library-host.ts',
		'desktop/project-library-contract.ts',
		'desktop/project-library-database.ts',
		'desktop/project-library-media-inventory-store.ts',
	]) assert.doesNotMatch(await readSource(legacy), /project-library-v10/iu, legacy);
});

interface Fixture {
	readonly appDataRoot: string;
}

async function fixtureFor(context: test.TestContext): Promise<Fixture> {
	const appDataRoot = await mkdtemp(join(tmpdir(), 'soundscaper-v10-proxy-inventory-'));
	context.after(() => rm(appDataRoot, { force: true, recursive: true }));
	return { appDataRoot };
}

function createInventory(fixture: Fixture): FramescaperDesktopProjectLibraryV10ProxyMediaInventory {
	return FramescaperDesktopProjectLibraryV10ProxyMediaInventory.create({
		appDataPath: fixture.appDataRoot,
		owner: owner(),
	});
}

function owner() {
	return { product: 'framescaper' as const, processId: 42, instanceId: 'framescaper-v10-owner' };
}

function validMetadata() {
	return {
		schemaVersion: 10,
		revision: 1,
		projects: [{
			id: 'framescaper-v10-entry',
			projectId: 'framescaper-project',
			name: 'Framescaper project',
			metadataFile: `framescaper-v10-entry/4-${PROJECT_DIGEST}.json`,
			preferredProduct: 'framescaper',
			updatedAtMs: 1,
			projectSchemaVersion: 18,
			projectRevision: 4,
			byteLength: 128,
			sha256: PROJECT_DIGEST,
		}],
		media: [{
			id: BINDING_ID,
			relativeFile: relativeFile(),
			category: 'proxy',
			byteLength: BODY.byteLength,
			sha256: BODY_DIGEST,
		}],
	};
}

function relativeFile(): string {
	return `proxy/${BINDING_ID.slice(1, 3)}/${BINDING_ID}.bin`;
}

async function publishFixture(managedMediaRoot: string): Promise<string> {
	const bodyPath = join(managedMediaRoot, ...relativeFile().split('/'));
	await mkdir(join(bodyPath, '..'), { recursive: true });
	await writeFile(bodyPath, BODY);
	return bodyPath;
}

function digest(bytes: Uint8Array): string {
	return createHash('sha256').update(bytes).digest('hex');
}

function zeroTrapProxy(target: object) {
	const hits = [0, 0, 0, 0];
	return { proxy: new Proxy(target, {
		getPrototypeOf() { hits[0] += 1; throw new Error('prototype trap'); },
		ownKeys() { hits[1] += 1; throw new Error('keys trap'); },
		getOwnPropertyDescriptor() { hits[2] += 1; throw new Error('descriptor trap'); },
		get() { hits[3] += 1; throw new Error('get trap'); },
	}), hits };
}

async function sourceFiles(roots: readonly string[]): Promise<string[]> {
	const output: string[] = [];
	for (const root of roots) await visit(root);
	return output.sort();
	async function visit(relativePath: string): Promise<void> {
		for (const entry of await readdir(resolve(ROOT, relativePath), { withFileTypes: true })) {
			const child = `${relativePath}/${entry.name}`;
			if (entry.isDirectory()) await visit(child);
			else if (/\.(?:[cm]?[jt]sx?)$/u.test(entry.name)) output.push(child.split(sep).join('/'));
		}
	}
}

async function readSource(relativePath: string): Promise<string> {
	return readFile(resolve(ROOT, relativePath), 'utf8');
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/gu)].map((match) => match[1]);
}
