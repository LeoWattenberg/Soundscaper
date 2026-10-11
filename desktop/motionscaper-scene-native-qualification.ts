/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium, expect, type Browser } from '@playwright/test';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { encodeMotionChannel, motionSurfaceToRgba8 } from '../src/common/editor/motion-surface.ts';
import { createMotionNativeScene, renderMotionNativeSceneReference } from './motionscaper-native-scene-reference.ts';
import { buildMotionNativeReferenceDecoder, decodeMotionNativeReference } from './motionscaper-native-reference.ts';

/** External qualification only: authenticates the package, then drives its unchanged public menus. */
export async function qualifyMotionscaperNativeScene(): Promise<void> {
	if (process.argv.length !== 2 || process.platform !== 'linux' || !process.env.DISPLAY) throw new Error('This packaged native scene qualification requires Linux, X11 and no arguments.');
	const root = resolve(import.meta.dirname, '..'); const packageRoot = join(root, 'release/desktop-nightly-products/motionscaper', `linux${process.arch === 'x64' ? '' : `-${process.arch}`}-unpacked`);
	const executable = join(packageRoot, 'motionscaper'); await access(executable);
	const stage = await verifyMotionscaperDesktopStage(join(root, '.desktop-build'), `linux-${process.arch}`); await verifyMotionscaperPackagedResources(join(packageRoot, 'resources'), stage);
	const sourceRevision: unknown = stage.sourceRevision; assert.equal(typeof sourceRevision, 'string'); assert.match(String(sourceRevision), /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u, 'Qualification requires a source-pinned desktop stage.');
	const temporary = await mkdtemp(join(tmpdir(), 'motionscaper-native-scene-')); const archivePath = join(temporary, 'saved.mscape'), movie = join(temporary, 'output.mov');
	const project = createMotionNativeScene(); const revision = createMotionscaperRevision(project);
	const archive = await exportMotionscaperArchive(project, () => { throw new Error('No external scene assets.'); }); assert.ok(archive); await writeFile(archivePath, new Uint8Array(await archive.arrayBuffer()));
	const references = await Promise.all([1, 2].map(frame => renderMotionNativeSceneReference(project, frame))); const decoder = await buildMotionNativeReferenceDecoder(temporary);
	const env: NodeJS.ProcessEnv = { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8', SCAPE_PRODUCT: 'motionscaper' }; delete env.ELECTRON_RUN_AS_NODE; delete env.NODE_OPTIONS;
	const child = spawn(executable, ['--disable-gpu', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${join(temporary, 'profile')}`], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
	let browser: Browser | undefined, output = ''; const exited = new Promise<void>((done, reject) => { child.once('error', reject); child.once('close', () => done()); });
	const deadline = setTimeout(() => child.kill('SIGKILL'), 120000);
	try {
		const endpoint = await new Promise<string>((done, reject) => {
			let resolved = false; const receive = (bytes: Buffer) => { output += bytes.toString('utf8'); if (output.length > 1048576) { reject(new Error('Packaged scene output exceeded its budget.')); child.kill('SIGKILL'); return; }
				const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[A-Za-z0-9-]+)/u.exec(output); if (match && !resolved) { resolved = true; done(match[1]!); } };
			child.stdout.on('data', receive); child.stderr.on('data', receive); child.once('error', reject); child.once('close', () => { if (!resolved) reject(new Error(`Packaged scene closed before endpoint: ${output}`)); });
		});
		browser = await chromium.connectOverCDP(endpoint); const context = browser.contexts()[0]!; const page = context.pages()[0] ?? await context.waitForEvent('page');
		await expect(page.locator('[data-motion-editor-bound="true"]')).toBeVisible({ timeout: 30000 }); assert.ok(page.url().startsWith('motionscaper-app://bundle/'));
		const menu = async (top: string, label: string) => { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: label, exact: true }).click(); };
		const select = async (path: string) => { const result = await promisify(execFile)('python3', [join(root, 'scripts/lib/motionscaper-scene-chooser-x11.py'), path], { timeout: 20000 }); assert.match(result.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u); };
		await menu('File', 'Open'); await select(archivePath); await expect(page.getByRole('menuitem', { name: 'Render', exact: true })).toHaveCount(0);
		await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device', { timeout: 30000 });
		await menu('View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }); const canvas = preview.locator('canvas'); let maximumPreviewError = 0;
		for (const [index, frame] of [1, 2].entries()) {
			await preview.getByLabel('Frame', { exact: true }).fill(String(frame)); await expect(canvas).toHaveAttribute('data-motion-frame', String(frame), { timeout: 30000 });
			const actual = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data)); const expected = motionSurfaceToRgba8(references[index]!, 'srgb'); assert.equal(actual.length, expected.length);
			for (let pixel = 0; pixel < actual.length; pixel += 4) {
				assert.equal(actual[pixel + 3], expected[pixel + 3], 'Preview alpha differs from matching-quality CPU reference.');
				for (let c = 0; c < 3; c++) maximumPreviewError = Math.max(maximumPreviewError, Math.abs(actual[pixel + c]! - expected[pixel + c]!) * expected[pixel + 3]! / 255);
			}
		}
		assert.ok(maximumPreviewError <= 1, `Canvas premultiplied readback exceeded one 8-bit code: ${String(maximumPreviewError)}`);
		await page.keyboard.press('Escape'); await expect(preview).toHaveCount(0);
		await menu('File', 'Render'); const dialog = page.getByRole('dialog', { name: 'Render Composition', exact: true }); await dialog.getByLabel('Output format', { exact: true }).selectOption('prores');
		await dialog.getByLabel('First frame', { exact: true }).fill('1'); await dialog.getByLabel('End frame (exclusive)', { exact: true }).fill('3');
		await dialog.getByRole('button', { name: 'Render', exact: true }).click(); await select(movie); await expect(dialog.getByRole('status')).toHaveText('Render complete', { timeout: 30000 });
		const decoded = await decodeMotionNativeReference(decoder, movie, temporary); assert.equal(decoded.metadata.width, 64); assert.equal(decoded.metadata.height, 48);
		assert.deepEqual(decoded.metadata.frames, [{ num: 0, den: 30000 }, { num: 1001, den: 30000 }]); assert.equal(decoded.metadata.audio, null);
		let maximumColorError = 0, maximumAlphaError = 0;
		let maximumAlphaSample: Readonly<{ frame: number; pixel: number; expected: number; actual: number }> | null = null;
		for (const [frame, reference] of references.entries()) for (let pixel = 0; pixel < reference.pixels.length; pixel += 4) {
			const offset = frame * reference.pixels.length + pixel, alpha = reference.pixels[pixel + 3]!, decodedAlpha = decoded.rgba[offset + 3]!;
			const alphaError = Math.abs(decodedAlpha - alpha); if (alphaError > maximumAlphaError) { maximumAlphaError = alphaError; maximumAlphaSample = { frame: frame + 1, pixel: pixel / 4, expected: alpha, actual: decodedAlpha }; }
			if (alpha === 0 || alpha === 1) assert.equal(decodedAlpha, alpha, 'Native alpha endpoints changed.');
			if (alpha === 0) continue; // Straight RGB under zero alpha has no rendered color authority.
			for (let c = 0; c < 3; c++) maximumColorError = Math.max(maximumColorError, Math.abs(decoded.rgba[offset + c]! - encodeMotionChannel(reference.pixels[pixel + c]! / alpha, 'rec709')));
		}
		assert.ok(maximumColorError <= 8 / 1023, `Native 10-bit RGB boundary exceeded eight code values: ${String(maximumColorError)}`); assert.ok(maximumAlphaError <= 2 / 1023, `Native alpha exceeded two 10-bit input codes: ${String(maximumAlphaError)}`);
		console.log(`MOTIONSCAPER_NATIVE_SCENE_QUALIFIED ${JSON.stringify({ platform: process.platform, arch: process.arch, sourceRevision, gpuMode: 'software (--disable-gpu)', revisionDigest: revision.digest, frameCount: 2, temporalSamples: 4, lensSamples: 16, actualNativeChoosers: true, ownOrigin: page.url(), maximumPreviewPremultipliedCodeError: maximumPreviewError, maximumRec709ColorError: maximumColorError, maximumAlphaError, maximumAlphaSample, metadata: decoded.metadata, movieSha256: createHash('sha256').update(await readFile(movie)).digest('hex') })}`);
	} catch (error) { console.error(output); throw error; }
	finally { try { await browser?.close(); } finally { child.kill('SIGTERM'); await exited; clearTimeout(deadline); await rm(temporary, { recursive: true, force: true, maxRetries: 4, retryDelay: 250 }); } }
}
