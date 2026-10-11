#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { access, mkdtemp, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect, type Browser } from '@playwright/test';
import { motionscaperSuccessorNativeFixture } from '../tests/helpers/motionscaper-successor-native-fixture.ts';
import { qualifyFramescaperSuccessorNativeDelivery } from './motionscaper-successor-delivery-qualification.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { verifyFramescaperSuccessorDesktopStage, verifyFramescaperSuccessorPackagedResources } from '../scripts/lib/framescaper-successor-desktop-package.ts';
import { resolveMotionQualificationPaths } from './motionscaper-native-qualification-paths.ts';

export async function qualifyFramescaperSuccessorNativeLink(): Promise<void> {
	if (process.argv.length !== 2 || process.platform !== 'linux' || !process.env.DISPLAY) throw new Error('This real GTK chooser qualification requires Linux, X11 and no arguments.');
	const root = resolve(import.meta.dirname, '..'), selected = resolveMotionQualificationPaths(root, 'framescaper-successor', process.arch), executable = selected.executable;
	await access(executable);
	const stageRoot = selected.stage, resources = join(selected.package, 'resources');
	const stage = await verifyFramescaperSuccessorDesktopStage(stageRoot, `linux-${process.arch}`); await verifyFramescaperSuccessorPackagedResources(resources, stage);
	const stageMetadata = JSON.parse(await readFile(join(stageRoot, 'stage-manifest.json'), 'utf8')) as { sourceRevision: string };
	assert.match(stageMetadata.sourceRevision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/u);
	const temporary = await mkdtemp(join(tmpdir(), 'motionscaper-native-link-')), path = join(temporary, 'saved.mscape'), profile = join(temporary, 'profile');
	const fixture = motionscaperSuccessorNativeFixture(); const { bytes } = fixture, sha256 = fixture.asset.sha256, project = fixture.revision.project;
	async function save(revision: number) {
		const snapshot = createMotionscaperRevision({ ...project, revision, title: revision === 0 ? 'Native first' : `Native revision ${String(revision)}` });
		const archive = await exportMotionscaperArchive(snapshot.project, () => new Blob([bytes])); assert.ok(archive);
		await writeFile(`${path}.tmp`, new Uint8Array(await archive.arrayBuffer())); await rename(`${path}.tmp`, path); return snapshot;
	}
	const initial = await save(0);
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SCAPE_PRODUCT: 'framescaper', SCAPE_FRAMESCAPER_LINE: 'successor', SCAPE_FRAMESCAPER_DESKTOP_PROFILE: 'framescaper-successor-v2' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
	const previewBackend = process.env.FRAMESCAPER_SUCCESSOR_PREVIEW_BACKEND ?? 'software-webgl2';
	if (previewBackend !== 'software-webgl2' && previewBackend !== 'unavailable') throw new Error('Unsupported successor qualification preview backend.');
	const previewFlags = previewBackend === 'unavailable' ? ['--disable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
	const child = spawn(executable, [...previewFlags, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
	let browser: Browser | undefined, output = '';
	const exited = new Promise<void>((resolveExit, reject) => { child.once('error', reject); child.once('close', () => resolveExit()); });
	const directoryInode = (await stat(temporary)).ino.toString(16);
	const watchCount = async () => {
		const directory = `/proc/${String(child.pid)}/fdinfo`; const files = await readdir(directory);
		assert.ok(files.length <= 4096, 'Native smoke FD inspection exceeded its budget.');
		const records = await Promise.all(files.map(file => readFile(join(directory, file), 'utf8').catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; })));
		return records.flatMap(record => record.split('\n')).filter(line => /^inotify /u.test(line) && line.includes(`ino:${directoryInode} `)).length;
	};
	const deadline = setTimeout(() => child.kill('SIGKILL'), 180_000);
	try {
		const endpoint = await new Promise<string>((resolveEndpoint, reject) => {
			let resolved = false;
			const receive = (chunk: Buffer) => {
				output += chunk.toString('utf8'); if (output.length > 1_048_576) { reject(new Error('Packaged smoke process output exceeded its budget.')); child.kill('SIGKILL'); return; }
				const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/u.exec(output);
				if (match && !resolved) { resolved = true; resolveEndpoint(match[1]!); }
			};
			child.stdout.on('data', receive); child.stderr.on('data', receive); child.once('error', reject);
			child.once('close', () => { if (!resolved) reject(new Error(`Packaged app closed before debugging endpoint: ${output}`)); });
		});
		browser = await chromium.connectOverCDP(endpoint);
		const context = browser.contexts()[0]!; const page = context.pages()[0] ?? await context.waitForEvent('page');
		await expect(page.locator('[data-audio-editor-bound="true"]')).toBeVisible({ timeout: 30000 });
		assert.equal(new URL(page.url()).origin, 'null'); assert.ok(page.url().startsWith('framescaper-successor-app://bundle/'));
		const menu = async () => { await page.getByRole('menuitem', { name: 'File', exact: true }).click(); await page.getByRole('menuitem', { name: 'Linked compositions…', exact: true }).click(); };
		assert.equal(await watchCount(), 0);
		await menu(); const dialog = page.getByRole('dialog', { name: 'Linked Motionscaper compositions', exact: true });
		await expect(dialog.getByRole('button', { name: 'Create pairing URL', exact: true })).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Choose saved .mscape file', exact: true }).click();
		const selection = await promisify(execFile)('python3', [join(root, 'scripts/lib/motionscaper-native-chooser-x11.py'), path], { timeout: 20000 });
		assert.match(selection.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u);
		await expect(dialog.getByText('Native first', { exact: true })).toBeVisible({ timeout: 30000 }); await expect(dialog.locator('code')).toHaveText(initial.digest); await expect.poll(watchCount).toBe(1);
		await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await expect(dialog).toHaveCount(0);
		const second = await save(1); await menu(); await expect(dialog.locator('code')).toHaveText(second.digest, { timeout: 10000 });
		await writeFile(`${path}.tmp`, new Uint8Array([1, 2, 3])); await rename(`${path}.tmp`, path);
		await dialog.getByRole('button', { name: 'Refresh saved revision', exact: true }).click(); await expect(dialog.getByRole('alert')).toBeVisible(); await expect(dialog.locator('code')).toHaveText(second.digest);
		const third = await save(2); await dialog.getByRole('button', { name: 'Refresh saved revision', exact: true }).click(); await expect(dialog.locator('code')).toHaveText(third.digest); await expect(dialog.getByRole('alert')).toHaveCount(0);
		await dialog.getByRole('button', { name: 'Disconnect', exact: true }).click(); await expect(dialog.getByRole('status')).toHaveText('Disconnected'); await expect.poll(watchCount).toBe(0);
		await save(3); await page.waitForTimeout(1500); await expect(dialog.locator('code')).toHaveText(third.digest);
		const persisted = await page.evaluate(async () => {
			const database = await new Promise<IDBDatabase>((resolveDatabase, reject) => { const request = indexedDB.open('kw-media-framescaper-editor-v2'); request.onsuccess = () => resolveDatabase(request.result); request.onerror = () => reject(request.error); });
			try {
				const transaction = database.transaction(['owners', 'assets', 'chunks'], 'readonly');
				const get = (name: string) => new Promise<unknown[]>((resolveRows, reject) => { const request = transaction.objectStore(name).getAll(); request.onsuccess = () => resolveRows(request.result as unknown[]); request.onerror = () => reject(request.error); });
				const [owners, assets, chunks] = await Promise.all([get('owners'), get('assets'), get('chunks')]);
				return { owners, assets, chunks: chunks.map(value => { const record = value as { bytes: Uint8Array }; return [...record.bytes]; }), databases: (await indexedDB.databases()).map(value => value.name).sort() };
			} finally { database.close(); }
		});
		assert.ok(JSON.stringify(persisted.owners).includes(third.digest)); assert.ok(JSON.stringify(persisted.assets).includes(sha256)); assert.deepEqual(persisted.chunks, [[...bytes]]);
		assert.ok(!persisted.databases.includes('kw-media-framescaper-editor-v1')); assert.ok(!persisted.databases.includes('kw-media-editor-v1'));
		await qualifyFramescaperSuccessorNativeDelivery(page, { root, temporary, sourceRevision: stageMetadata.sourceRevision, acceptedDigest: third.digest, previewBackend });
		console.log(`FRAMESCAPER_SUCCESSOR_NATIVE_LINK_QUALIFIED ${JSON.stringify({ platform: process.platform, arch: process.arch, sourceRevision: stageMetadata.sourceRevision,
			actualNativeChooser: true, nativeWatchReleased: true, initialDigest: initial.digest, updatedDigest: third.digest, corruptReplacementRefused: true, disconnectedRetainedDigest: third.digest, assetSha256: sha256, databases: persisted.databases })}`);
	} catch (error) { console.error(output); throw error; }
	finally { try { await browser?.close(); } finally { child.kill('SIGTERM'); await exited; clearTimeout(deadline); await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } }

}
