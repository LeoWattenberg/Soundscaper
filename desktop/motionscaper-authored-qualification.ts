/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { lstat, mkdir, readFile, readdir, realpath, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { launchMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-launch.ts';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';
import { hashMotionSustainedFile, sampleMotionOwnedProcesses } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { resolveMotionQualificationPaths } from './motionscaper-native-qualification-paths.ts';
import { inspectMotionNativeReference, prepareMotionNativeReferenceDecoder } from './motionscaper-native-reference.ts';
import { motionAuthoredFileIdentity, motionAuthoredPackageIdentity, motionAuthoredSourceIdentity, verifyMotionAuthoredFileIdentity } from './motionscaper-authored-identity.ts';
import { motionAuthoredRasterIdentity, verifyMotionAuthoredRasterIdentity } from './motionscaper-authored-raster-authority.ts';
import { motionAuthoredSha, readMotionAuthoredReference } from './motionscaper-authored-reference.ts';
import { verifyMotionAuthoredNative, verifyMotionAuthoredPreview } from './motionscaper-authored-oracles.ts';
import { finishMotionAuthoredQualification } from './motionscaper-authored-lifecycle.ts';

async function author(page: Page): Promise<void> {
	const menu = async (top: string, item: string) => { await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
	const fill = async (fields: readonly (readonly [string, string])[]) => { for (const [name, value] of fields) await page.getByRole('dialog').getByLabel(name, { exact: true }).fill(value); };
	const create = async () => { await page.getByRole('dialog').getByRole('button', { name: 'Create', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); };
	await menu('File', 'New Composition'); await expect(page.getByRole('dialog', { name: 'New Composition', exact: true })).toBeVisible();
	await fill([['Project title', 'Desktop authored title'], ['Width', '160'], ['Height', '96'], ['Frame rate numerator', '30'], ['Frame rate denominator', '1'], ['Duration in frames', '2']]); await create();
	await menu('Layer', 'New Rectangle');
	await fill([['Layer name', 'Card'], ['Width', '140'], ['Height', '64'], ['Position X', '10'], ['Position Y', '8'], ['Opacity (%)', '100'], ['Fill color', '#4a80ff']]); await create();
	await menu('Layer', 'New Text');
	await fill([['Layer name', 'Title'], ['Text', 'Motion'], ['Font size', '24'], ['Width', '120'], ['Height', '40'], ['Position X', '20'], ['Position Y', '20'], ['Opacity (%)', '100'], ['Fill color', '#ffffff']]); await create();
}

/** Standalone until independently qualified; aggregate registration must not precede its real GTK run. */
export async function qualifyMotionscaperAuthoredTitle(output: string): Promise<void> {
	if (process.platform !== 'linux' || process.arch !== 'x64' || !/^:\d+$/u.test(process.env.DISPLAY ?? '')
		|| process.env.MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY !== process.env.DISPLAY) throw new Error('Authored qualification requires its explicitly owned private Linux x64 X11 display.');
	for (const name of ['TMPDIR', 'XDG_RUNTIME_DIR']) {
		const path = process.env[name]; assert.ok(path && path.length <= 80, 'Use a short private runtime directory for native sockets.');
		assert.equal(await realpath(path), path); const metadata = await lstat(path);
		assert.ok(metadata.isDirectory()); assert.equal(metadata.uid, process.getuid!()); assert.equal(metadata.mode & 0o777, 0o700);
	}
	assert.equal(resolve(output), output); assert.match(output, /^\/[A-Za-z0-9_./-]+$/u); assert.equal(await realpath(dirname(output)), dirname(output));
	const root = resolve(import.meta.dirname, '..'), revision = await motionAuthoredSourceIdentity(root);
	const paths = resolveMotionQualificationPaths(root, 'motionscaper', process.arch);
	const verifyStage = async () => {
		const stage = await verifyMotionscaperDesktopStage(paths.stage, 'linux-x64'); assert.equal(stage.sourceRevision, revision);
		await verifyMotionscaperPackagedResources(join(paths.package, 'resources'), stage);
	};
	await verifyStage(); const packageBefore = await motionAuthoredPackageIdentity(paths.package);
	assert.ok(process.env.MOTIONSCAPER_REFERENCE_ARTIFACT && process.env.MOTIONSCAPER_REFERENCE_NATIVE_RESULT, 'A verified source-bound decoder artifact is mandatory; compilation fallback is not admitted.');
	for (const input of [root, paths.package, paths.stage, process.env.MOTIONSCAPER_REFERENCE_ARTIFACT, process.env.MOTIONSCAPER_REFERENCE_NATIVE_RESULT]) {
		assert.ok(output !== input && !output.startsWith(`${input}/`), 'Qualification output must not mutate its source or input artifacts.');
	}
	await mkdir(output, { recursive: false, mode: 0o700 });
	const write = async (name: string, value: unknown) => { await writeFile(join(output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); };
	const decoder = await prepareMotionNativeReferenceDecoder(output);
	const decoderIdentity = await motionAuthoredFileIdentity(decoder); assert.ok(decoderIdentity.mode & 0o111);
	const rasterAuthority = await motionAuthoredRasterIdentity(root);
	const pins = await Promise.all([join(paths.stage, 'stage-manifest.json'), join(process.env.MOTIONSCAPER_REFERENCE_ARTIFACT, 'reference-receipt.json'), join(process.env.MOTIONSCAPER_REFERENCE_NATIVE_RESULT, 'build-result.json')].map(path => hashMotionSustainedFile(path)));
	await write('input-authority.json', { root, sourceRevision: revision, paths, pins, packageBefore, display: process.env.DISPLAY, decoderIdentity, rasterAuthority });
	let application: Awaited<ReturnType<typeof launchMotionSustainedApplication>> | undefined;
	const receipt = await finishMotionAuthoredQualification(async () => {
		application = await launchMotionSustainedApplication({ executable: paths.executable, cwd: root, directory: output, native: true });
		await write('chooser-owner.json', { owner: application.owner, display: process.env.DISPLAY });
		const { page } = application; const pageErrors: string[] = []; page.on('pageerror', error => { if (pageErrors.length < 32) pageErrors.push(error.message); });
		page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(30000);
		await expect(page.locator('[data-motion-editor-bound="true"]')).toBeVisible({ timeout: 30000 }); assert.ok(page.url().startsWith('motionscaper-app://bundle/'));
		const remember = async () => { const owned = await sampleMotionOwnedProcesses(application!.owner, []); application!.retainProcessIdentities(owned.processes.map(value => value.identity)); };
		const menu = async (top: string, item: string) => { await remember(); await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click(); };
		let chooserIndex = 0;
		const choose = async (mode: 'save-project' | 'export' | 'cancel-export', name: 'saved.mscape' | 'output.mov') => {
			const result = await motionSustainedCommand({ command: '/usr/bin/python3', args: ['-B', '-E', '-s', join(root, 'scripts/lib/motionscaper-authored-chooser-x11.py'), output, mode, name], cwd: root, directory: output, id: `chooser-${++chooserIndex}`, timeoutMs: 25000 });
			assert.match(result.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u);
		};
		await author(page); await menu('File', 'Save'); await choose('save-project', 'saved.mscape');
		await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device', { timeout: 30000 });
		const archivePath = join(output, 'saved.mscape'), moviePath = join(output, 'output.mov');
		const reference = await readMotionAuthoredReference(root, archivePath, rasterAuthority);
		await menu('View', 'Composition Preview'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true });
		let maximumPreviewPremultipliedCodeError = 0;
		for (const frame of [0, 1]) {
			await preview.getByLabel('Frame', { exact: true }).fill(String(frame)); const canvas = preview.locator('canvas');
			await expect(canvas).toHaveAttribute('data-motion-frame', String(frame), { timeout: 30000 });
			const actual = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data));
			maximumPreviewPremultipliedCodeError = Math.max(maximumPreviewPremultipliedCodeError, verifyMotionAuthoredPreview(reference.references[frame]!, actual));
		}
		await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.getByRole('dialog')).toHaveCount(0);
		await menu('File', 'Render'); const render = page.getByRole('dialog', { name: 'Render Composition', exact: true });
		await expect(render.getByLabel('Output format', { exact: true }).locator('option[value="prores"]')).toHaveCount(1, { timeout: 30000 });
		await render.getByLabel('Output format', { exact: true }).selectOption('prores');
		await render.getByLabel('First frame', { exact: true }).fill('0'); await render.getByLabel('End frame (exclusive)', { exact: true }).fill('2');
		await render.getByRole('button', { name: 'Render', exact: true }).click(); await choose('cancel-export', 'output.mov');
		await expect(render.getByRole('button', { name: 'Render', exact: true })).toBeEnabled({ timeout: 30000 });
		assert.ok(!(await readdir(output)).includes('output.mov')); assert.equal(motionAuthoredSha(await readFile(archivePath)), reference.archiveSha256);
		await render.getByRole('button', { name: 'Render', exact: true }).click(); await choose('export', 'output.mov');
		await expect(render.getByRole('status')).toHaveText('Render complete', { timeout: 30000 }); await expect(render.getByRole('alert')).toHaveCount(0); await remember();
		assert.ok((await stat(moviePath)).size <= 64 * 1024 * 1024);
		const rgbaPath = join(output, 'reference.rgba'), pcmPath = join(output, 'reference.pcm');
		await verifyMotionAuthoredFileIdentity(decoderIdentity);
		const decoded = await motionSustainedCommand({ command: decoder, args: [moviePath, rgbaPath, pcmPath], cwd: root, directory: output, id: 'reference-decoder', timeoutMs: 30000 });
		const metadata = inspectMotionNativeReference(JSON.parse(decoded.stdout) as unknown, (await stat(rgbaPath)).size, (await stat(pcmPath)).size);
		const rgba = await readFile(rgbaPath), pcm = await readFile(pcmPath);
		const metrics = verifyMotionAuthoredNative(reference.references, { metadata, rgba: new Float32Array(rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength)), pcm: new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength)) });
		assert.equal(motionAuthoredSha(await readFile(archivePath)), reference.archiveSha256); assert.deepEqual(pageErrors, []);
		return { sourceRevision: revision, scope: 'Linux x64 software authored title: New, shape, text, native Save, preview, destination Cancel/retry, two-frame ProRes',
			ownOrigin: page.url(), gpuMode: 'software (--disable-gpu)', frameCount: 2, maximumPreviewPremultipliedCodeError, ...metrics,
			archiveSha256: reference.archiveSha256, retainedFontSha256: reference.retainedFontSha256, movie: await hashMotionSustainedFile(moviePath), decoderCommand: decoded.receipt, pageErrors };
	}, async () => { if (application) await application.cleanup(); }, async () => {
		assert.equal(await motionAuthoredSourceIdentity(root), revision); await verifyStage();
		for (const pin of pins) assert.deepEqual(await hashMotionSustainedFile(pin.path), pin, 'Native/reference/stage input identity changed.');
		await verifyMotionAuthoredFileIdentity(decoderIdentity); await verifyMotionAuthoredRasterIdentity(rasterAuthority);
		const packageAfter = await motionAuthoredPackageIdentity(paths.package); await write('package-after.json', packageAfter); assert.deepEqual(packageAfter, packageBefore);
	}, async value => { await write('result.json', value); });
	console.log(`MOTIONSCAPER_AUTHORED_NATIVE_QUALIFIED ${JSON.stringify(receipt)}`);
}
