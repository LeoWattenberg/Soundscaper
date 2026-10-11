/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FramescaperCompositionLinkRepository } from '../../src/framescaper/editor-composition-link-repository.ts';
import type { MotionCompositionOffer } from '../../src/common/editor/motion-link-protocol.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';

interface Fixture {
	open(): Promise<FramescaperCompositionLinkRepository>; offer(revision: number, width?: number): MotionCompositionOffer;
	bytes: Uint8Array<ArrayBuffer>; asset: MotionAsset; database(): Promise<IDBDatabase>;
}
let directory: string; let server: Server; let address: string;
const repository = fileURLToPath(new URL('../../', import.meta.url));
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motionscaper-link-browser-'));
	const entry = join(directory, 'fixture.ts'); const output = join(directory, 'site');
	const source = (path: string) => JSON.stringify(join(repository, path));
	await writeFile(entry, `
import { openFramescaperCompositionLinkRepository } from ${source('src/framescaper/editor-composition-link-repository.ts')};
import { openFramescaperSuccessorDatabase } from ${source('src/framescaper/editor-project-successor-database.ts')};
import { createMotionCompositionOffer } from ${source('src/common/editor/motion-link-protocol.ts')};
import { createMotionscaperRevision } from ${source('src/common/editor/motion-project-revision.ts')};
import { createMotionscaperProject } from ${source('src/motionscaper/editor-project.ts')};
import { digestScapeBytes } from ${source('src/common/editor/scape-archive-media.ts')};
const bytes = new Uint8Array([1,2,3,4]); const sha256 = digestScapeBytes(bytes);
const asset = { id: 'image', kind: 'image', name: 'Image', mimeType: 'image/png', width: 1, height: 1, hasAlpha: true, sha256, byteLength: bytes.length, storageKey: 'motion-sha256:' + sha256 };
globalThis.motionLinkFixture = { bytes, asset, open: () => openFramescaperCompositionLinkRepository({line:'successor'}), database: () => openFramescaperSuccessorDatabase(indexedDB,'successor'),
 offer: (revision, width = 1920) => createMotionCompositionOffer('main', createMotionscaperRevision({...createMotionscaperProject({id:'motion',compositionId:'main',title:'Revision ' + revision,width}),revision,assets:[asset]})) };
`);
	await build({ root: repository, configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: output, emptyOutDir: true, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	server = createServer((request, response) => { void (async () => {
		try {
			if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<script type="module" src="/fixture.js"></script>'); return; }
			if (request.url !== '/fixture.js') { response.writeHead(404).end(); return; }
			response.setHeader('Content-Type', 'text/javascript'); response.end(await readFile(join(output, 'fixture.js')));
		} catch { response.writeHead(404).end(); }
	})(); });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); const bound = server.address();
	if (!bound || typeof bound === 'string') throw new Error('Motion link fixture could not bind.'); address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await page.goto(address); await page.waitForFunction(() => 'motionLinkFixture' in globalThis); });

test('M10 real IndexedDB keeps streamed dependencies private until atomic publication and reopens without either editor', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open();
		let release!: () => void; let staged!: () => void; let count = 0;
		const started = new Promise<void>((resolve) => { staged = resolve; }); const finish = new Promise<void>((resolve) => { release = resolve; });
		const transfer = receiver.receive('frame', 'linked', fixture.offer(1), { readAsset: async () => ({ size: 4, stream: () => new ReadableStream<Uint8Array>({ async pull(controller) {
			if (++count === 1) controller.enqueue(fixture.bytes.slice(0, 2)); else { staged(); await finish; controller.enqueue(fixture.bytes.slice(2)); controller.close(); }
		} }, { highWaterMark: 0 }) }) });
		await started; const before = await receiver.load('frame', 'linked'); release(); const accepted = await transfer; await receiver.close();
		const reopened = await fixture.open(); const loaded = await reopened.load('frame', 'linked'); const body = await reopened.readAsset(fixture.asset);
		const bytes = body ? [...new Uint8Array(await new Response(body.stream()).arrayBuffer())] : null; await reopened.close();
		return { before, accepted: accepted.accepted.revision.digest, loaded: loaded?.accepted.revision.digest, bytes, names: (await indexedDB.databases()).map((database) => database.name) };
	});
	expect(result.before).toBeNull(); expect(result.loaded).toBe(result.accepted); expect(result.bytes).toEqual([1, 2, 3, 4]); expect(result.names).toEqual(['kw-media-framescaper-editor-v2']);
});

test('M10 cancelling a stalled real storage transfer preserves the accepted snapshot and removes private chunks', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open();
		const readAsset = async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() }); await receiver.receive('frame', 'linked', fixture.offer(1), { readAsset });
		const abort = new AbortController(); let ready!: () => void; let cancelled = 0; let count = 0; const started = new Promise<void>((resolve) => { ready = resolve; });
		const pending = receiver.receive('frame', 'linked', fixture.offer(2), { signal: abort.signal, readAsset: async () => ({ size: 4, stream: () => new ReadableStream<Uint8Array>({
			pull(controller) { if (++count === 1) controller.enqueue(fixture.bytes.slice(0, 2)); else ready(); }, cancel() { cancelled++; },
		}, { highWaterMark: 0 }) }) });
		const rejected = pending.then(() => 'published', (error: unknown) => error instanceof Error ? error.name : 'failure'); await started; abort.abort(); const error = await rejected;
		const state = await receiver.load('frame', 'linked'); const database = await fixture.database();
		const stores = await new Promise<number[]>((resolve, reject) => { const transaction = database.transaction(['staging', 'chunks', 'assets'], 'readonly'); const counts = ['staging', 'chunks', 'assets'].map((name) => transaction.objectStore(name).count()); transaction.oncomplete = () => resolve(counts.map((request) => request.result)); transaction.onabort = () => reject(transaction.error); });
		database.close(); await receiver.close(); return { error, cancelled, revision: state?.accepted.revision.revision, stores };
	});
	expect(result).toEqual({ error: 'AbortError', cancelled: 1, revision: 1, stores: [0, 1, 1] });
});

test('M10 real storage retains incompatible updates and Undo pause across reopen before Resume and Conform', async ({ page }) => {
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionLinkFixture: Fixture }).motionLinkFixture; const receiver = await fixture.open(); const readAsset = async () => ({ size: 4, stream: () => new Blob([fixture.bytes]).stream() });
		await receiver.receive('frame', 'linked', fixture.offer(1), { readAsset }); await receiver.receive('frame', 'linked', fixture.offer(2), { readAsset }); await receiver.restore('frame', 'linked', fixture.offer(1));
		await receiver.receive('frame', 'linked', fixture.offer(3, 1280), { readAsset }); await receiver.close(); const reopened = await fixture.open(); const paused = await reopened.load('frame', 'linked');
		const resumed = await reopened.resume('frame', 'linked'); const conformed = await reopened.conform('frame', 'linked'); const historical = await reopened.loadRevision('motion', fixture.offer(1).revision.digest); await reopened.close();
		return { paused: paused?.paused, accepted: paused?.accepted.revision.revision, pending: paused?.pending?.revision.revision, resumed: resumed.accepted.revision.revision, conformed: conformed.accepted.revision.revision, historical: historical?.revision };
	});
	expect(result).toEqual({ paused: true, accepted: 1, pending: 3, resumed: 1, conformed: 3, historical: 1 });
});
