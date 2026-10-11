/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from '@playwright/test';
import { build } from 'vite';
import type { OutputChunk } from 'rolldown';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workerChunkGroups } from '../../scripts/lib/build-worker-chunks.mjs';
import { expectMotionWorkerBackend } from './helpers/motionscaper-worker-webgl.ts';
import type { MotionPreviewClient, MotionPreviewFrame, MotionPreviewOptions } from '../../src/common/editor/controller/composition/motion-preview-types.ts';
import type { MotionPreviewSessionOptions } from '../../src/common/editor/controller/composition/motion-preview-render-session.ts';
import type { MotionPreviewBackend } from '../../src/common/editor/controller/composition/motion-preview-types.ts';
import type { MotionscaperProject } from '../../src/common/editor/motion-project-types.ts';

type Fixture = Readonly<{ createClient(options: MotionPreviewOptions): Promise<MotionPreviewClient>; createSession(options: MotionPreviewSessionOptions): MotionPreviewBackend;
	project: MotionscaperProject; shapeProject: MotionscaperProject; pinProject: MotionscaperProject; depthProject: MotionscaperProject; lightProject: MotionscaperProject; focusProject: MotionscaperProject; shutterProject: MotionscaperProject; exportPixels(project: MotionscaperProject, frame: number): Promise<number[]>;
	audioFixture(): Promise<{ project: MotionscaperProject; bytes: Uint8Array }>; loadAsset(): Promise<Uint8Array> }>;
let directory: string; let server: Server; let address: string;
const repository = fileURLToPath(new URL('../../', import.meta.url));
const fixtureSource = () => `
import { createMotionPreviewClient as createClient } from ${JSON.stringify(join(repository, 'src/common/editor/controller/composition/motion-preview-client.ts'))};
import { createMotionPreviewRenderSession as createSession } from ${JSON.stringify(join(repository, 'src/common/editor/controller/composition/motion-preview-render-session.ts'))};
import { createMotionscaperProject, createMotionLayer } from ${JSON.stringify(join(repository, 'src/motionscaper/editor-project.ts'))};
import { motionColor, motionScalar, motionVector } from ${JSON.stringify(join(repository, 'src/common/editor/motion-property.ts'))};
import { createMotionShapeOperator, createMotionTextAnimator } from ${JSON.stringify(join(repository, 'src/common/editor/motion-authoring-operators.ts'))};
import { motionRectanglePath } from ${JSON.stringify(join(repository, 'src/common/editor/motion-shape-primitives.ts'))};
import { motionWavFixture } from ${JSON.stringify(join(repository, 'tests/helpers/motion-media-fixture.ts'))};
import { prepareMotionMedia } from ${JSON.stringify(join(repository, 'src/common/editor/motion-media-import.ts'))};
import manifest from ${JSON.stringify(join(repository, 'config/motionscaper-raster-runtime.json'))};
import fontUrl from ${JSON.stringify(join(repository, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2?url'))};
const pin = manifest.assets.find(asset => asset.id === 'inter-latin');
const font = { id: 'font', kind: 'font', name: 'Inter', family: 'Inter', style: 'Regular', sha256: pin.sha256, byteLength: pin.byteLength, storageKey: 'motion-sha256:' + pin.sha256, mimeType: 'font/woff2' };
const base = createMotionscaperProject({ id: 'preview', title: 'Preview', compositionId: 'main', width: 64, height: 32 });
const solid = createMotionLayer({ id: 'solid', name: 'Solid', durationFrames: 300, content: { kind: 'solid', color: motionColor([0.5, 0, 0, 0.5]), size: motionVector([64, 32]) } });
const animator = createMotionTextAnimator('shift');
const text = createMotionLayer({ id: 'text', name: 'Text', durationFrames: 300, content: { kind: 'text', document: { runs: [{ text: 'A Ω', fontAssetId: 'font', fontSize: motionScalar(24), color: motionColor([1, 1, 1, 1]), tracking: motionScalar(0) }], align: 'left', lineHeight: motionScalar(1), boxSize: motionVector([64, 32]), animators: [{ ...animator, selector: { ...animator.selector, unit: 'line' }, position: motionVector([5, 0]) }] } } });
const project = { ...base, assets: [font], compositions: [{ ...base.compositions[0], layers: [text, solid] }] };
const repeater = createMotionShapeOperator({ id: 'copies', kind: 'repeater' });
const trim = createMotionShapeOperator({ id: 'trim', kind: 'trim-paths' });
const shapes = createMotionLayer({ id: 'shape', name: 'Operators', durationFrames: 300, content: { kind: 'shapes', shapes: [{ id: 'rect', path: motionRectanglePath({ x: 4, y: 4, width: 8, height: 8 }), fill: null, stroke: { width: motionScalar(2), color: motionColor([0, 0, 1, 1]), lineCap: 'butt', lineJoin: 'miter' } }], operators: [{ ...repeater, copies: motionScalar(2), transform: { ...repeater.transform, position: motionVector([16, 0]) } }, { ...trim, mode: 'simultaneous', end: motionScalar(0.5) }, createMotionShapeOperator({ id: 'merge', kind: 'boolean' })] } });
const shapeProject = { ...base, compositions: [{ ...base.compositions[0], layers: [shapes] }] };
const card = createMotionLayer({ id: 'card', name: 'Pinned card', durationFrames: 300, content: { kind: 'solid', color: motionColor([0, 0.5, 0, 0.5]), size: motionVector([8, 8]) } });
const corners = [[-4, 0], [8, 0], [12, 12], [0, 12]];
const pinProject = { ...base, compositions: [{ ...base.compositions[0], layers: [{ ...card, transform: { ...card.transform, position: motionVector([8, 4, 0]) }, effects: [{ id: 'pin', type: 'corner-pin', enabled: true, parameters: ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((id, index) => ({ id, value: motionVector(corners[index]) })) }] }] }] };
const plane = (id, color, rotationY) => { const layer = createMotionLayer({ id, name: id, durationFrames: 300, content: { kind: 'solid', color: motionColor(color), size: motionVector([64, 32]) } });
 return { ...layer, is3D: true, transform: { ...layer.transform, anchor: motionVector([32, 16, 0]), position: motionVector([32, 16, 0]), rotation: motionVector([0, rotationY, 0]) } }; };
const camera = createMotionLayer({ id: 'camera', name: 'Camera', durationFrames: 300, content: { kind: 'camera', projection: 'orthographic', zoom: motionScalar(64), near: 1, far: 1000, focusDistance: motionScalar(100), aperture: motionScalar(0) } });
const depthProject = { ...base, compositions: [{ ...base.compositions[0], layers: [plane('red-plane', [1, 0, 0, 0.5], 60), plane('green-plane', [0, 1, 0, 0.5], -60), { ...camera, transform: { ...camera.transform, position: motionVector([32, 16, -100]) } }] }] };
const caster = createMotionLayer({ id: 'caster', name: 'Caster', durationFrames: 300, content: { kind: 'solid', color: motionColor([0, 0, 0, 0.5]), size: motionVector([8, 32]) } });
const receiver = createMotionLayer({ id: 'receiver', name: 'Receiver', durationFrames: 300, content: { kind: 'solid', color: motionColor([1, 1, 1, 1]), size: motionVector([64, 32]) } });
const point = createMotionLayer({ id: 'light', name: 'Point', durationFrames: 300, content: { kind: 'light', lightType: 'point', color: motionColor([1, 1, 1, 1]), intensity: motionScalar(1), coneAngle: motionScalar(90), coneFeather: motionScalar(0), castsShadows: true } });
const lightProject = { ...base, compositions: [{ ...base.compositions[0], layers: [{ ...caster, is3D: true, material: { ...caster.material, castsShadows: true }, transform: { ...caster.transform, position: motionVector([8, 0, 0]) } }, { ...receiver, is3D: true, transform: { ...receiver.transform, position: motionVector([0, 0, 32]) } }, { ...point, transform: { ...point.transform, position: motionVector([0, 16.5, -32]) } }, { ...camera, transform: { ...camera.transform, position: motionVector([32, 16, -100]) } }] }] };
const focusProject = { ...base, compositions: [{ ...base.compositions[0], depthOfFieldSamples: 16, layers: [{ ...card, is3D: true, color: motionColor([1, 1, 1, 1]), transform: { ...card.transform, position: motionVector([28, 12, 64]) } }, { ...camera, projection: 'perspective', focusDistance: motionScalar(64), aperture: motionScalar(32), transform: { ...camera.transform, position: motionVector([32, 16, -64]) } }] }] };
const shutterProject = { ...focusProject, compositions: [{ ...focusProject.compositions[0], temporal: { shutterOpenFrames: { num: -1, den: 2 }, shutterCloseFrames: { num: 1, den: 2 }, samples: 4 }, layers: focusProject.compositions[0].layers.map(layer => layer.kind === 'solid' ? { ...layer, transform: { ...layer.transform, position: { ...layer.transform.position, expression: { source: '[28 + frame * 8, 12, 64]', enabled: true, references: [] } } } } : layer) }] };
const exportPixels = async (project, frame) => {
 const [{ createMotionscaperRenderRequest }, { renderMotionFrameSequence }, { createMotionBrowserRasterizer }, { motionSurfaceToRgba8 }] = await Promise.all([
  import(${JSON.stringify(join(repository, 'src/motionscaper/editor-render-task.ts'))}), import(${JSON.stringify(join(repository, 'src/common/editor/controller/export/motion-render-pipeline.ts'))}),
  import(${JSON.stringify(join(repository, 'src/common/editor/controller/composition/motion-raster-runtime.ts'))}), import(${JSON.stringify(join(repository, 'src/common/editor/motion-surface.ts'))})]);
 let pixels = []; const request = createMotionscaperRenderRequest({ project, compositionId: 'main', firstFrame: frame, endFrame: frame + 1,
  acquire: async () => ({ rasterizer: await createMotionBrowserRasterizer({ assets: [], loadAsset: async () => { throw new Error('No source expected'); } }), release: async () => {} }),
  sink: { write: async output => { pixels = [...motionSurfaceToRgba8(output.surface, 'srgb')]; }, finish: async () => true, abort: async () => {} } });
 await renderMotionFrameSequence(request); return pixels;
};
const audioFixture = async () => {
 const bytes = motionWavFixture(2); const { asset } = await prepareMotionMedia(new Blob([bytes]), { id: 'sound', name: 'Sound.wav' });
 const audioSolid = { ...solid, transform: { ...solid.transform, opacity: { ...motionScalar(1), expression: { source: 'audioAmplitude("sound", time, 0.02)', enabled: true, references: [] } } } };
 return { bytes, project: { ...base, assets: [asset], compositions: [{ ...base.compositions[0], layers: [audioSolid] }] } };
};
globalThis.motionFixture = { createClient, createSession, project, shapeProject, pinProject, depthProject, lightProject, focusProject, shutterProject, exportPixels, audioFixture, loadAsset: async () => new Uint8Array(await (await fetch(fontUrl)).arrayBuffer()) };
`;

test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'motionscaper-worker-browser-'));
	const entry = join(directory, 'fixture.ts'); await writeFile(entry, fixtureSource());
	const output = join(directory, 'site');
	const workerChunks: OutputChunk[] = [];
	await build({ root: repository, configFile: false, publicDir: false, logLevel: 'silent', worker: { format: 'es',
		plugins: () => [{ name: 'verify-motion-worker-fixture', generateBundle(_options, bundle) {
			for (const item of Object.values(bundle)) if (item.type === 'chunk') workerChunks.push(item);
		} }],
		rolldownOptions: { output: { strictExecutionOrder: true, codeSplitting: { groups: workerChunkGroups, minSize: 20_000 } } } },
		build: { outDir: output, emptyOutDir: true, assetsInlineLimit: 0, rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } } });
	const registration = workerChunks.filter(chunk => chunk.facadeModuleId === join(repository, 'src/common/editor/motion-preview-worker.ts'));
	expect(registration).toHaveLength(1); expect(registration[0]!.isEntry).toBe(true); expect(registration[0]!.exports).toEqual([]);
	for (const chunk of workerChunks) expect([...chunk.imports, ...chunk.dynamicImports]).not.toContain(registration[0]!.fileName);
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

test('M06 ordered repeat, simultaneous trim and boolean geometry match worker and CPU preview pixels', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.shapeProject, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend); client.dispose();
		}
		return { pixels, backends };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]);
	expect(rendered.pixels[0]!.slice((4 * 64 + 8) * 4, (4 * 64 + 8) * 4 + 4)).toEqual([0, 0, 255, 255]);
	expect(rendered.pixels[0]!.slice((4 * 64 + 24) * 4, (4 * 64 + 24) * 4 + 4)).toEqual([0, 0, 0, 0]);
});

test('M07 projective corner pin preserves fractional coverage and negative origin in worker and CPU previews', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.pinProject, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend); client.dispose();
		}
		return { pixels, backends };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]);
	expect(rendered.pixels[0]!.slice((8 * 64 + 10) * 4, (8 * 64 + 10) * 4 + 4)).toEqual([0, 188, 0, 128]);
	expect(rendered.pixels[0]!.slice((8 * 64 + 18) * 4, (8 * 64 + 18) * 4 + 4)).toEqual([0, 0, 0, 0]);
});

test('M09 intersecting translucent planes preserve per-pixel depth in worker WebGL and host CPU preview', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.depthProject, fixture.loadAsset);
			for (const num of [1, 0, 2, 1]) await client.seek({ compositionId: 'main', time: { num, den: 30 } });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend); client.dispose();
		}
		return { pixels, backends };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]);
	expect(rendered.pixels[0]!.slice((16 * 64 + 24) * 4, (16 * 64 + 24) * 4 + 4)).toEqual([156, 213, 0, 191]);
	expect(rendered.pixels[0]!.slice((16 * 64 + 40) * 4, (16 * 64 + 40) * 4 + 4)).toEqual([213, 156, 0, 191]);
});

test('M09 transparent shadow casters and point lighting match worker WebGL and host CPU preview', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.lightProject, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend); client.dispose();
		}
		return { pixels, backends };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]);
	const response = Math.round(255 * (1.055 * (0.5 * 64 / Math.hypot(20.5, 64)) ** (1 / 2.4) - 0.055));
	expect(rendered.pixels[0]!.slice((16 * 64 + 20) * 4, (16 * 64 + 20) * 4 + 4)).toEqual([response, response, response, 255]);
});

test('M09 deterministic depth-of-field lens samples preserve transparent coverage in worker and CPU preview', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 64 * 1024 * 1024, maximumWorkingBytes: 64 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.focusProject, fixture.loadAsset); await client.seek({ compositionId: 'main', time: 0 });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend); client.dispose();
		}
		return { pixels, backends };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]);
	const edge = rendered.pixels[0]!.slice((16 * 64 + 28) * 4, (16 * 64 + 28) * 4 + 4);
	expect(edge.slice(0, 3)).toEqual([255, 255, 255]); expect(edge[3]).toBeGreaterThan(0); expect(edge[3]).toBeLessThan(255);
});

test('M05 bundled preview loads fonts and WASM lazily, animates shaped fallback glyphs and renders offline in a persistent worker', async ({ page, context }) => {
	const requests: string[] = []; page.on('request', (request) => requests.push(request.url()));
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	expect(requests.filter((url) => /\.wasm|\.woff2/u.test(url))).toEqual([]);
	const first = await page.evaluate(async () => {
		const scope = globalThis as unknown as { motionFixture: Fixture; preview: MotionPreviewClient; frames: MotionPreviewFrame[] }; scope.frames = [];
		scope.preview = await scope.motionFixture.createClient({ onFrame: (frame) => scope.frames.push(frame), onState: () => {} });
		await scope.preview.setProject(scope.motionFixture.project, scope.motionFixture.loadAsset); await scope.preview.seek({ compositionId: 'main', time: 0 });
		const frame = scope.frames[0]!; return { backend: frame.backend, pixels: [...frame.rgba], size: [frame.width, frame.height] };
	});
	await expectMotionWorkerBackend(page, first.backend); expect(first.size).toEqual([64, 32]);
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


test('M08 native PCM-driven pixels match worker WebGL and host CPU after arbitrary and offline seeks', async ({ page, context }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const initial = await page.evaluate(async () => {
		const scope = globalThis as unknown as { motionFixture: Fixture; audioPreview: MotionPreviewClient; audioFrame: MotionPreviewFrame; audioBytes: Uint8Array };
		const authored = await scope.motionFixture.audioFixture(); scope.audioBytes = authored.bytes;
		let host: MotionPreviewFrame | undefined;
		const fallback = await scope.motionFixture.createClient({ backendFactory: () => Promise.resolve(scope.motionFixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 8 * 1024 * 1024 })), onFrame(frame) { host = frame; }, onState() {} });
		await fallback.setProject(authored.project, () => Promise.resolve(authored.bytes)); await fallback.seek({ compositionId: 'main', time: { num: 1, den: 25 } }); fallback.dispose();
		scope.audioPreview = await scope.motionFixture.createClient({ onFrame(frame) { scope.audioFrame = frame; }, onState() {} });
		await scope.audioPreview.setProject(authored.project, () => Promise.resolve(authored.bytes)); await scope.audioPreview.seek({ compositionId: 'main', time: { num: 1, den: 25 } });
		return { worker: scope.audioFrame.backend, same: scope.audioFrame.rgba.every((value, index) => value === host!.rgba[index]), alpha: scope.audioFrame.rgba[3], bytes: authored.bytes.length };
	});
	await expectMotionWorkerBackend(page, initial.worker); expect(initial.same).toBe(true); expect(initial.alpha).toBeGreaterThan(1); expect(initial.alpha).toBeLessThan(127);
	await context.setOffline(true);
	const next = await page.evaluate(async () => {
		const scope = globalThis as unknown as { audioPreview: MotionPreviewClient; audioFrame: MotionPreviewFrame; audioBytes: Uint8Array };
		for (const num of [1, 0, 2, 1]) await scope.audioPreview.seek({ compositionId: 'main', time: { num, den: 25 } });
		const result = { alpha: scope.audioFrame.rgba[3], bytes: scope.audioBytes.length }; scope.audioPreview.dispose(); return result;
	});
	expect(next).toEqual({ alpha: initial.alpha, bytes: initial.bytes });
});


test('M09 authored shutter and lens sampling agree across actual worker, host and export after arbitrary seeks', async ({ page }) => {
	await page.goto(address); await page.waitForFunction(() => 'motionFixture' in globalThis);
	const rendered = await page.evaluate(async () => {
		const fixture = (globalThis as unknown as { motionFixture: Fixture }).motionFixture;
		const pixels: number[][] = []; const backends: string[] = []; let reduced: number[] = [];
		for (const forceHost of [false, true]) {
			let frame: MotionPreviewFrame | undefined;
			const client = await fixture.createClient({ ...(forceHost ? { backendFactory: () => Promise.resolve(fixture.createSession({ backend: 'host-cpu', maximumAssetBytes: 1024 * 1024, maximumWorkingBytes: 8 * 1024 * 1024 })) } : {}), onFrame(value) { frame = value; }, onState() {} });
			await client.setProject(fixture.shutterProject, fixture.loadAsset);
			for (const num of [1, 0, 2, 1]) await client.seek({ compositionId: 'main', time: { num, den: 30 } });
			pixels.push([...frame!.rgba]); backends.push(frame!.backend);
			await client.seek({ compositionId: 'main', time: { num: 1, den: 30 }, quality: { temporalSamples: 1, depthOfFieldSamples: 1 } }); reduced = [...frame!.rgba]; client.dispose();
		}
		pixels.push(await fixture.exportPixels(fixture.shutterProject, 1)); return { pixels, backends, reduced };
	});
	await expectMotionWorkerBackend(page, rendered.backends[0]); expect(rendered.backends[1]).toBe('host-cpu'); expect(rendered.pixels[0]).toEqual(rendered.pixels[1]); expect(rendered.pixels[0]).toEqual(rendered.pixels[2]);
	expect(rendered.pixels[0]).not.toEqual(rendered.reduced); expect(rendered.pixels[0]!.some((value, index) => index % 4 === 3 && value > 0 && value < 255)).toBe(true);
});
