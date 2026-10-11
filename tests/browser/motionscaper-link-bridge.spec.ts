/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, type Page } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeProductHeaders, matchedHeaders, parseHeaderRules, webBuildRouting } from '../../scripts/lib/product-web-routing.mjs';

interface Fixture { receive(): string; send(url: string, stall?: boolean): void; connect(url: string): void; update(revision: number): Promise<void>; disconnect(): Promise<void>; state(): { received: string | null; sent: string | null; error: string | null; pulls: number; cancelled: number }; retained(): Promise<{ digest: string | null; bytes: number[] | null }> }
let directory: string; const servers: Server[] = []; let motion: string; let frame: string;
const repository = fileURLToPath(new URL('../../', import.meta.url));
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motion-bridge-'));
	const template = await readFile(join(repository, 'public/_headers'), 'utf8');
	const outputs = [join(directory, 'motion'), join(directory, 'frame')];
	for (const [index, product] of (['motionscaper', 'framescaper'] as const).entries()) {
		const routing = webBuildRouting({ SCAPE_PRODUCT: product, SCAPE_FRAMESCAPER_LINE: product === 'framescaper' ? 'successor' : 'baseline' }); const headers = parseHeaderRules(composeProductHeaders(template, routing));
		const server = createServer((request, response) => { void (async () => {
			const path = new URL(request.url ?? '/', 'http://localhost').pathname;
			for (const [name, values] of matchedHeaders(headers, path)) response.setHeader(name, values.join(', '));
			if (path === '/en/' || path.startsWith('/composition-link/')) {
				response.setHeader('Content-Type', 'text/html'); response.end(`<main id="composition-link-bridge"></main><script type="module" src="/fixture.js"></script>`); return;
			}
			if (!/^\/[A-Za-z0-9._/-]+$/u.test(path) || path.includes('..')) { response.writeHead(404).end(); return; }
			try { response.setHeader('Content-Type', path.endsWith('.css') ? 'text/css' : 'text/javascript'); response.end(await readFile(join(outputs[index], path.slice(1)))); } catch { response.writeHead(404).end(); }
		})(); });
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve)); servers.push(server);
		const address = server.address(); if (!address || typeof address === 'string') throw new Error('Cannot bind bridge fixture.');
		if (index === 0) motion = `http://127.0.0.1:${address.port}`; else frame = `http://127.0.0.1:${address.port}`;
	}
	const source = (path: string) => JSON.stringify(join(repository, path));
	const entry = join(directory, 'fixture.ts'); await writeFile(entry, `
import { createMotionLinkReceiverConnection, sendMotionLinkConnection, openMotionLinkSenderConnection } from ${source('src/common/editor/controller/composition/motion-link-connection.ts')};
import { openFramescaperCompositionLinkRepository } from ${source('src/framescaper/editor-composition-link-repository.ts')};
import { createMotionscaperProject } from ${source('src/motionscaper/editor-project.ts')};
import { createMotionscaperRevision } from ${source('src/common/editor/motion-project-revision.ts')};
import { createMotionCompositionOffer } from ${source('src/common/editor/motion-link-protocol.ts')};
import { digestScapeBytes } from ${source('src/common/editor/scape-archive-media.ts')};
if (location.pathname.startsWith('/composition-link/')) await import(${source('src/common/editor/ui/composition-link/bridge-page-entry.tsx')});
const origins = {senderOrigin:${JSON.stringify(motion)},receiverOrigin:${JSON.stringify(frame)}};
const bytes = Uint8Array.from({length:128},(_,i)=>i); const sha256 = digestScapeBytes(bytes);
const asset = {id:'picture',kind:'image',name:'Retained',width:1,height:1,hasAlpha:true,mimeType:'image/png',byteLength:bytes.length,sha256,storageKey:'motion-sha256:'+sha256};
const offer = createMotionCompositionOffer('main',createMotionscaperRevision({...createMotionscaperProject({id:'source',title:'Transferred',compositionId:'main'}),assets:[asset]}));
let received = null, sent = null, error = null, pulls = 0, cancelled = 0, persistent = null;
globalThis.fixture = {
 receive() { const connection = createMotionLinkReceiverConnection({...origins,async receive(value,options) {const repository = await openFramescaperCompositionLinkRepository({line:'successor'});try {await repository.receive('frame','linked',value,options);received=value.revision.digest;}finally{await repository.close();}}}); connection.completion.then(digest=>received=digest,failure=>error=String(failure)); return connection.url; },
 send(connectionUrl,stall=false) { void sendMotionLinkConnection({...origins,connectionUrl,offer,readAsset:async()=>({size:bytes.length,stream:()=>new ReadableStream({pull(controller){pulls++;if(!stall){controller.enqueue(bytes);controller.close();}},cancel(){cancelled++;}},{highWaterMark:0})})}).then(digest=>sent=digest,failure=>error=String(failure)); },
 connect(connectionUrl) { void openMotionLinkSenderConnection({...origins,connectionUrl,readAsset:async()=>({size:bytes.length,stream:()=>new Blob([bytes]).stream()})}).then(async connection=>{persistent=connection;sent=await connection.send(offer);},failure=>error=String(failure)); },
 async update(revision) {if(!persistent) throw new Error('Not connected.'); const updated = createMotionCompositionOffer('main',createMotionscaperRevision({...offer.revision.project,revision,title:'Saved '+revision}));sent=await persistent.send(updated);},
 async disconnect() {await persistent?.dispose();persistent=null;},
 state:()=>({received,sent,error,pulls,cancelled}),
 async retained() {const repository=await openFramescaperCompositionLinkRepository({line:'successor'});try{const state=await repository.load('frame','linked');const body=await repository.readAsset(asset);return{digest:state?.accepted.revision.digest??null,bytes:body?[...new Uint8Array(await new Response(body.stream()).arrayBuffer())]:null};}finally{await repository.close();}}
};
`);
	for (const [index, product] of (['motionscaper', 'framescaper'] as const).entries()) await build({ root: repository, configFile: false, publicDir: false, logLevel: 'silent', define: { __SCAPE_PRODUCT__: JSON.stringify(product), __SCAPE_FRAMESCAPER_LINE__: JSON.stringify(product === 'framescaper' ? 'successor' : 'baseline'), 'import.meta.env.PUBLIC_MOTION_LINK_PEER_ORIGIN': JSON.stringify(product === 'motionscaper' ? frame : motion) }, build: { target: 'esnext', outDir: outputs[index], emptyOutDir: true, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
});
test.afterAll(async () => { for (const server of servers) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
async function ready(page: Page, origin: string) { await page.goto(`${origin}/en/`); await page.waitForFunction(() => 'fixture' in globalThis); }
function state(page: Page) { return page.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.state()); }

test('M10 actual cross-origin bridge preserves editor isolation, pairs new tabs and reopens received closure offline', async ({ context }) => {
	const sender = await context.newPage(); const receiver = await context.newPage(); await ready(sender, motion); await ready(receiver, frame);
	expect(await sender.evaluate(() => crossOriginIsolated)).toBe(true); expect(await receiver.evaluate(() => crossOriginIsolated)).toBe(true);
	const url = await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.receive());
	const sendingBridgeEvent = context.waitForEvent('page'); await sender.evaluate((connection) => (globalThis as unknown as { fixture: Fixture }).fixture.send(connection), url); const sendingBridge = await sendingBridgeEvent;
	await expect(sendingBridge.getByRole('button', { name: 'Connect to Framescaper', exact: true })).toBeVisible();
	expect(await sendingBridge.evaluate(() => ({ isolated: crossOriginIsolated, opener: opener === null }))).toEqual({ isolated: false, opener: true });
	const receivingBridgeEvent = context.waitForEvent('page'); await sendingBridge.getByRole('button', { name: 'Connect to Framescaper', exact: true }).click(); const receivingBridge = await receivingBridgeEvent;
	await expect.poll(async () => (await state(receiver)).received).toMatch(/^[a-f0-9]{64}$/u); await expect.poll(async () => (await state(sender)).sent).toBe((await state(receiver)).received);
	expect(await receivingBridge.evaluate(() => ({ isolated: crossOriginIsolated, opener: opener !== null }))).toEqual({ isolated: false, opener: true });
	const expected = (await state(receiver)).received; await sender.close(); await sendingBridge.close(); await receivingBridge.close(); await receiver.close();
	const reopened = await context.newPage(); await ready(reopened, frame); await context.setOffline(true);
	const retained = await reopened.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.retained()); expect(retained.digest).toBe(expected); expect(retained.bytes).toEqual(Array.from({ length: 128 }, (_, i) => i));
});

test('M10 closing a cross-origin receiving bridge cancels a stalled source and publishes no partial closure', async ({ context }) => {
	const sender = await context.newPage(); const receiver = await context.newPage(); await ready(sender, motion); await ready(receiver, frame);
	const url = await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.receive());
	const sendingBridgeEvent = context.waitForEvent('page'); await sender.evaluate((connection) => (globalThis as unknown as { fixture: Fixture }).fixture.send(connection, true), url); const sendingBridge = await sendingBridgeEvent;
	const receivingBridgeEvent = context.waitForEvent('page'); await sendingBridge.getByRole('button', { name: 'Connect to Framescaper', exact: true }).click(); const receivingBridge = await receivingBridgeEvent;
	await expect.poll(async () => (await state(sender)).pulls).toBe(1); await receivingBridge.close();
	await expect.poll(async () => (await state(sender)).cancelled).toBe(1); await expect.poll(async () => (await state(receiver)).error).not.toBeNull();
	expect(await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.retained())).toEqual({ digest: null, bytes: null });
});


test('M10 established bridge sends later saved revisions through the same windows until Disconnect', async ({ context }) => {
	const sender = await context.newPage(); const receiver = await context.newPage(); await ready(sender, motion); await ready(receiver, frame);
	const url = await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.receive());
	const bridgeEvent = context.waitForEvent('page'); await sender.evaluate((connection) => (globalThis as unknown as { fixture: Fixture }).fixture.connect(connection), url); const bridge = await bridgeEvent;
	await bridge.getByRole('button', { name: 'Connect to Framescaper', exact: true }).click();
	await expect.poll(async () => (await state(sender)).sent).toMatch(/^[a-f0-9]{64}$/u); const first = (await state(sender)).sent;
	const windows = context.pages().length;
	await sender.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.update(1)); const updated = (await state(sender)).sent;
	expect(updated).not.toBe(first); await expect.poll(async () => (await state(receiver)).received).toBe(updated); expect(context.pages()).toHaveLength(windows);
	await sender.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.disconnect());
	await expect(bridge.getByRole('status')).toContainText('connection closed');
	await context.setOffline(true); expect((await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.retained())).digest).toBe(updated);
});

test('M10 closing the isolated source editor cancels its pending bridge transfer', async ({ context }) => {
	const sender = await context.newPage(); const receiver = await context.newPage(); await ready(sender, motion); await ready(receiver, frame);
	const url = await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.receive());
	const bridgeEvent = context.waitForEvent('page'); await sender.evaluate((connection) => (globalThis as unknown as { fixture: Fixture }).fixture.send(connection, true), url); const bridge = await bridgeEvent;
	await bridge.getByRole('button', { name: 'Connect to Framescaper', exact: true }).click(); await expect.poll(async () => (await state(sender)).pulls).toBe(1);
	await sender.close(); await expect.poll(async () => (await state(receiver)).error).not.toBeNull();
	expect(await receiver.evaluate(() => (globalThis as unknown as { fixture: Fixture }).fixture.retained())).toEqual({ digest: null, bytes: null });
	await expect(bridge.getByRole('status')).toContainText('connection closed');
});
