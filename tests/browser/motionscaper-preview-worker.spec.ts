/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { build } from 'vite';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MotionPreviewClient, MotionPreviewFrame, MotionPreviewOptions } from '../../src/common/editor/controller/composition/motion-preview-types.ts';
import type { MotionPreviewSessionOptions } from '../../src/common/editor/controller/composition/motion-preview-render-session.ts';
import type { MotionPreviewBackend } from '../../src/common/editor/controller/composition/motion-preview-types.ts';
import type { MotionscaperProject } from '../../src/common/editor/motion-project-types.ts';

type Fixture = Readonly<{ createClient(options: MotionPreviewOptions): Promise<MotionPreviewClient>; createSession(options: MotionPreviewSessionOptions): MotionPreviewBackend;
	project: MotionscaperProject; loadAsset(): Promise<Uint8Array> }>;
let directory: string; let server: Server; let address: string;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixtureSource = () => `
import { createMotionPreviewClient as createClient } from ${JSON.stringify(join(repository, 'src/common/editor/controller/composition/motion-preview-client.ts'))};
import { createMotionPreviewRenderSession as createSession } from ${JSON.stringify(join(repository, 'src/common/editor/controller/composition/motion-preview-render-session.ts'))};
import { createMotionscaperProject, createMotionLayer } from ${JSON.stringify(join(repository, 'src/motionscaper/editor-project.ts'))};
import { motionColor, motionScalar, motionVector } from ${JSON.stringify(join(repository, 'src/common/editor/motion-property.ts'))};
import manifest from ${JSON.stringify(join(repository, 'config/motionscaper-raster-runtime.json'))};
import fontUrl from ${JSON.stringify(join(repository, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2?url'))};
const pin = manifest.assets.find(asset => asset.id === 'inter-latin');
const font = { id: 'font', kind: 'font', name: 'Inter', family: 'Inter', style: 'Regular', sha256: pin.sha256, byteLength: pin.byteLength, storageKey: 'motion-sha256:' + pin.sha256, mimeType: 'font/woff2' };
const base = createMotionscaperProject({ id: 'preview', title: 'Preview', compositionId: 'main', width: 64, height: 32 });
const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([0.5, 0, 0, 0.5]), size: motionVector([64, 32]) } });
const text = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [{ text: 'A Ω', fontAssetId: 'font', fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([64, 32]) } } });
const project = { ...base, assets: [font], compositions: [{ ...base.compositions[0], layers: [text, solid] }] };
globalThis.motionFixture = { createClient, createSession, project, loadAsset: async () => new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()) };
`;

test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motionscaper-worker-browser-'));
	const entry = join(directory, 'fixture.ts'); await writeFile(entry, fixtureSource());
	const output = join(directory, 'site');
	await build({ root: repository, configFile: false, publicDir: false, logLevel: 'silent', worker: { format: 'es' },
		build: { outDir: output, emptyOutDir: true, assetsInlineLimit: 0, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	server = createServer((request, response) => { void (async () => {
		try {
			const pathname = new URL(request.url ?? '/', 'http://fixture').pathname;
			if (pathname === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<script type="module" src="/fixture.js"></script>'); return; }
			if (pathname.includes('..')) { response.writeHead(403).end(); return; }
			const path = join(output, pathname); const body = await readFile(path);
			response.setHeader('Content-Type', extname(path) === '.wasm' ? 'application/wasm' : extname(path) === '.js' ? 'text/javascript' : 'application/octet-stream'); response.end(body);
		} catch { response.writeHead(404).end(); }
	})(); });
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const bound = server.address(); if (!bound || typeof bound === 'string') throw new Error('Motion browser fixture did not bind.'); address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => { if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });

test('M05 bundled preview loads fonts and WASM lazily in a persistent worker and renders after the network goes offline', async ({ page, context }) => {
	const requests: string[] = []; page.on('request', (request) => requests.push(request.url()));
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	expect(requests.filter((url) => /\.wasm|\.woff2/u.test(url))).toEqual([]);
	const first = await page.evaluate(async () => {
		const scope = globalThis as unknown as { motionFixture: Fixture; preview: MotionPreviewClient; frames: MotionPreviewFrame[] }; scope.frames = [];
		scope.preview = await scope.motionFixture.createClient({ onFrame: (frame) => scope.frames.push(frame), onState: () => {} });
		await scope.preview.setProject(scope.motionFixture.project, scope.motionFixture.loadAsset); await scope.preview.seek({ compositionId: 'main', time: 0 });
		const frame = scope.frames[0]!; return { backend: frame.backend, pixels: [...frame.rgba], size: [frame.width, frame.height] };
	});
	expect(first.backend).toBe('worker-webgl2'); expect(first.size).toEqual([64, 32]);
	expect(first.pixels.some((value, index) => index % 4 === 1 && value > 0)).toBe(true);
	await context.setOffline(true);
	const next = await page.evaluate(async () => {
		const scope = globalThis as unknown as { preview: MotionPreviewClient; frames: MotionPreviewFrame[] };
		await scope.preview.seek({ compositionId: 'main', time: { num: 1, den: 30 } }); const frame = scope.frames.at(-1)!;
		scope.preview.dispose(); return { pixels: [...frame.rgba], time: frame.time, status: scope.preview.snapshot().status };
	});
	expect(next.pixels).toEqual(first.pixels); expect(next.time).toEqual({ num: 1, den: 30 }); expect(next.status).toBe('disposed');
});

test('M05 absent Worker uses the same CanvasKit CPU rasterizer with transparent sRGB output', async ({ page }) => {
	await page.addInitScript(() => Object.defineProperty(globalThis, 'Worker', { value: undefined }));
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture; let rendered: MotionPreviewFrame | undefined;
		const client = await fixture.createClient({ onFrame: (frame) => { rendered = frame; }, onState: () => {} });
		await client.setProject(fixture.project, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
		client.dispose(); return { backend: rendered!.backend, corner: [...rendered!.rgba.slice(-4)], text: rendered!.rgba.some((value, index) => index % 4 === 1 && value > 0) };
	});
	expect(result).toEqual({ backend: 'host-cpu', corner: [188, 0, 0, 128], text: true });
});

test('M05 a failed module worker load falls back to the host and completes the pending seek', async ({ page }) => {
	await page.route('**/motion-preview-worker-*.js', (route) => route.abort());
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const backend = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const client = await fixture.createClient({ onFrame: () => {}, onState: () => {} });
		await client.setProject(fixture.project, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
		const value = client.snapshot().backend; client.dispose(); return value;
	});
	expect(backend).toBe('host-cpu');
});

test('M05 actual WebGL context loss retries the same frame through CanvasKit CPU', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const result = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture; const canvas = document.createElement('canvas');
		const session = fixture.createSession({ backend: 'worker-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 8 * 1024 * 1024, createCanvas: () => canvas });
		const signal = new AbortController().signal; await session.setProject(fixture.project, fixture.loadAsset, signal);
		const request = { compositionId: 'main', time: { num: 0, den: 1 }, generation: 1 }; const first = await session.render(request, signal);
		const lose = canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context'); if (!lose) throw new Error('Context loss extension unavailable.');
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Context loss was not delivered.')), 2000);
			canvas.addEventListener('webglcontextlost', (event) => { event.preventDefault(); clearTimeout(timer); resolve(); }, { once: true }); lose.loseContext();
		});
		const retried = await session.render({ ...request, generation: 2 }, signal); session.dispose();
		return { first: first.backend, retried: retried.backend, same: first.rgba.every((value, index) => Math.abs(value - retried.rgba[index]!) <= 1) };
	});
	expect(result).toEqual({ first: 'worker-webgl2', retried: 'worker-cpu', same: true });
});
