/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FramescaperSuccessorEnvironment } from '../../src/framescaper/editor-project-successor-environment.ts';
import type { FramescaperSuccessorProject } from '../../src/framescaper/editor-project-successor.ts';
import type { MotionAsset } from '../../src/common/editor/motion-asset.ts';
import type { importFramescaperSuccessorPortableArchive } from '../../src/framescaper/editor-project-successor-portable-import.ts';
import type { exportFramescaperSuccessorPortableArchive } from '../../src/framescaper/editor-project-successor-portable-export.ts';
interface Fixture {
	create(): Promise<{ archive: Blob; project: FramescaperSuccessorProject; asset: MotionAsset }>;
	open(): Promise<FramescaperSuccessorEnvironment>;
	importArchive: typeof importFramescaperSuccessorPortableArchive;
	exportArchive: typeof exportFramescaperSuccessorPortableArchive;
}
let directory: string; let server: Server; let address: string;
const root = fileURLToPath(new URL('../../', import.meta.url));
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'successor-portable-browser-')); const entry = join(directory, 'fixture.ts'); const output = join(directory, 'site');
	const source = (path: string) => JSON.stringify(join(root, path));
	await writeFile(entry, `
import { createFramescaperSuccessorEnvironment } from ${source('src/framescaper/editor-project-successor-environment.ts')};
import { createFramescaperSuccessorRuntime } from ${source('src/framescaper/editor-project-successor-runtime.ts')};
import { createFramescaperCompositionSource } from ${source('src/framescaper/editor-composition-link-source.ts')};
import { createMotionscaperProject } from ${source('src/motionscaper/editor-project.ts')};
import { createMotionscaperRevision } from ${source('src/common/editor/motion-project-revision.ts')};
import { createMotionCompositionOffer } from ${source('src/common/editor/motion-link-protocol.ts')};
import { createAudioSource } from ${source('src/common/editor/project-media-factory.ts')};
import { digestScapeBytes } from ${source('src/common/editor/scape-archive-media.ts')};
import { importFramescaperSuccessorPortableArchive } from ${source('src/framescaper/editor-project-successor-portable-import.ts')};
import { exportFramescaperSuccessorPortableArchive } from ${source('src/framescaper/editor-project-successor-portable-export.ts')};
async function create() {
 const bytes=new Uint8Array([7,8,9]);const sha256=digestScapeBytes(bytes);
 const asset={kind:'image',id:'unused',name:'Unused original',mimeType:'image/png',width:1,height:1,hasAlpha:true,sha256,byteLength:3,storageKey:'motion-sha256:'+sha256};
 const revision=createMotionscaperRevision({...createMotionscaperProject({id:'motion',title:'Portable scene',compositionId:'main',durationFrames:3,width:2,height:1}),assets:[asset]});
 const linked=createFramescaperCompositionSource({sourceId:'picture',audioSourceId:'sound',offer:createMotionCompositionOffer('main',revision),sampleRate:48000});
 const audio=createAudioSource({id:'ordinary',name:'Unused PCM',sampleRate:48000,channelCount:1,frameCount:4,chunkFrames:4});
 const project={...createFramescaperSuccessorRuntime({line:'successor'}).createProject({id:'portable',title:'Edited linked Frame',sources:[linked.source,linked.audioSource,audio]}),compositionLinks:[linked.link]};
 const result=await exportFramescaperSuccessorPortableArchive(project,{getMediaAssetMetadata:async()=>{throw Error('virtual metadata');},loadMediaAsset:async()=>{throw Error('virtual body');},async *readSourceChunks(id){if(id!=='ordinary')throw Error('virtual PCM');yield [new Float32Array([.25,.5,.75,1])];}},{readAsset:async()=>({size:3,stream:()=>new Blob([bytes]).stream()})});
 return {archive:result.blob,project,asset};
}
globalThis.portableFixture={create,open:()=>createFramescaperSuccessorEnvironment({line:'successor',storeOptions:{preferOpfs:false}}),importArchive:importFramescaperSuccessorPortableArchive,exportArchive:exportFramescaperSuccessorPortableArchive};
`);
	await build({ root, configFile: false, publicDir: false, logLevel: 'silent', build: { outDir: output, emptyOutDir: true, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	server = createServer((request, response) => { void (async () => {
		try {
			const path = new URL(request.url ?? '/', 'http://localhost').pathname;
			if (path === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<script type="module" src="/fixture.js"></script>'); return; }
			if (!/^\/[A-Za-z0-9_./-]+$/u.test(path) || path.includes('..')) { response.writeHead(404).end(); return; }
			response.setHeader('Content-Type', path.endsWith('.wasm') ? 'application/wasm' : 'text/javascript'); response.end(await readFile(join(output, path.slice(1))));
		} catch { response.writeHead(404).end(); }
	})(); });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve)); const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Portable fixture could not bind.'); address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });

test('M10 actual successor portable import rolls back owner failure and restores exact linked and PCM closure after ordinary cache loss', async ({ page, context }) => {
	await page.goto(address); await page.waitForFunction(() => 'portableFixture' in globalThis);
	const saved = await page.evaluate(async () => {
		const f = (globalThis as unknown as { portableFixture: Fixture }).portableFixture; const { archive, project, asset } = await f.create(); const environment = await f.open();
		const original = IDBObjectStore.prototype.put;
		IDBObjectStore.prototype.put = function (this: IDBObjectStore, ...args: Parameters<typeof original>) { if (this.name === 'owners') throw new DOMException('Owner full', 'QuotaExceededError'); return original.apply(this, args); };
		let failure = false;
		try { await f.importArchive(archive, environment.store, { line: 'successor' }); } catch (error) { failure = error instanceof DOMException && error.name === 'QuotaExceededError'; } finally { IDBObjectStore.prototype.put = original; }
		const before = await environment.owners.loadOwner(project.id); const hidden = await environment.owners.readAsset(asset);
		await f.importArchive(archive, environment.store, { line: 'successor' }); await environment.close();
		await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase('kw-media-framescaper-editor-v2-media'); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('Media cache deletion is blocked.')); });
		return { projectId: project.id, projectJson: JSON.stringify(project), asset, failure, before, hidden };
	});
	expect(saved.failure).toBe(true); expect(saved.before).toBeNull(); expect(saved.hidden).toBeNull(); await page.close();
	const reopened = await context.newPage(); await reopened.goto(address); await reopened.waitForFunction(() => 'portableFixture' in globalThis);
	const result = await reopened.evaluate(async ({ projectId, projectJson, asset }) => {
		const f = (globalThis as unknown as { portableFixture: Fixture }).portableFixture; const environment = await f.open();
		try {
			const loaded = await environment.controllerStore.loadProject(projectId); const body = await environment.owners.readAsset(asset);
			const linked = body ? [...new Uint8Array(await new Response(body.stream()).arrayBuffer())] : null;
			const pcm = []; for await (const chunk of environment.store.readSourceChunks('ordinary')) pcm.push(...chunk.channels[0]!);
			const exported = await f.exportArchive(loaded, environment.store, { readAsset: (asset) => environment.owners.readAsset(asset) });
			return { same: JSON.stringify(loaded) === projectJson, linked, pcm, version: exported.manifest.project.schemaVersion, kinds: exported.manifest.assets.map(asset => asset.kind).sort(), catalog: (await environment.owners.listOwners()).length, nativeProject: await environment.store.loadProject(projectId) };
		} finally { await environment.close(); }
	}, { projectId: saved.projectId, projectJson: saved.projectJson, asset: saved.asset });
	expect(result).toEqual({ same: true, linked: [7, 8, 9], pcm: [0.25, 0.5, 0.75, 1], version: 2, kinds: ['audio', 'motion-linked-original', 'video-timing'], catalog: 1, nativeProject: null }); await reopened.close();
});
