/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { expect } from '@playwright/test';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../scripts/lib/motionscaper-desktop-package.mjs';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';
import { launchMotionSustainedApplication } from '../scripts/performance/motionscaper-sustained-launch.ts';
import { motionSustainedMenu } from '../scripts/performance/motionscaper-sustained-ui.ts';
import { hashMotionSustainedFile } from '../scripts/performance/motionscaper-sustained-observation.ts';
import { exportMotionscaperArchive } from '../src/motionscaper/editor-scape.ts';
import { createMotionscaperRevision } from '../src/motionscaper/editor-project-revision.ts';
import { createMotionMaximumIndexFixture } from './motionscaper-native-maximum-index-fixture.ts';
import { createMotionMaximumScene } from './motionscaper-native-maximum-scenes.ts';
import { motionMaximumNativeProfile, type MotionMaximumNativeKind } from './motionscaper-native-maximum-profile.ts';
import { inspectMotionMaximumNativePictures } from './motionscaper-native-maximum-pictures.ts';
import { previewMotionMaximum, renderMotionMaximum } from './motionscaper-native-maximum-ui.ts';
import { prepareMotionMaximumDecoder, decodeMotionMaximumNative } from './motionscaper-native-maximum-reference.ts';
import { motionAuthoredSourceIdentity, motionAuthoredPackageIdentity, motionAuthoredFileIdentity, verifyMotionAuthoredFileIdentity } from './motionscaper-authored-identity.ts';
import { verifyMotionSustainedReferenceAuthority } from '../scripts/performance/motionscaper-sustained-reference-authority.ts';
import { finishMotionAuthoredQualification } from './motionscaper-authored-lifecycle.ts';
import { resolveMotionQualificationPaths } from './motionscaper-native-qualification-paths.ts';

interface Options {
	readonly kind: MotionMaximumNativeKind; readonly output: string;
	readonly ffmpegPrefix: string; readonly nativeResult: string;
	readonly prefixAuthority: string; readonly prefixAuthoritySha256: string;
}
/** Source changes admitted here are qualification additions only. The installed application retains
 * its original source revision; a new driver commit never retags a held package or historical result.
 */
export async function verifyMotionMaximumApplicationSource(root: string, applicationRevision: string) {
	assert.match(applicationRevision, /^[a-f0-9]{40}$/u);
	const sourceRevision = await motionAuthoredSourceIdentity(root);
	const delta = (await promisify(execFile)('git', ['diff', '--name-status', applicationRevision, sourceRevision], { cwd: root, timeout: 10000 })).stdout;
	for (const line of delta.trim().split('\n').filter(Boolean)) assert.match(line,
		/^A\t(?:desktop\/motionscaper-native-maximum-[a-z-]+\.ts|tests\/motionscaper-native-maximum-[a-z-]+\.test\.ts|scripts\/lib\/motionscaper-maximum-reference\.cpp|scripts\/motionscaper-maximum-native-smoke\.mjs)$/u,
		'Package reuse requires byte-identical application/runtime sources; only these added qualification files may differ.');
	return { sourceRevision, applicationRevision, delta };
}
/** Direct public-menu qualification only; a separately reviewed finite outer owner must launch it. */
export async function qualifyMotionscaperNativeMaximum(options: Options): Promise<void> {
	assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
	assert.match(process.env.DISPLAY ?? '', /^:\d+$/u); assert.equal(process.env.MOTIONSCAPER_QUALIFICATION_PRIVATE_DISPLAY, process.env.DISPLAY);
	for (const key of ['TMPDIR', 'XDG_RUNTIME_DIR']) {
		const path = process.env[key]; assert.ok(path && path.length <= 80); assert.equal(await realpath(path), path);
		const value = await lstat(path); assert.ok(value.isDirectory() && !value.isSymbolicLink()); assert.equal(value.uid, process.getuid!()); assert.equal(value.mode & 0o777, 0o700);
	}
	const profile = motionMaximumNativeProfile(options.kind), root = resolve(import.meta.dirname, '..');
	assert.match(options.output, /^\/tmp\/motionscaper-native-scene-[A-Za-z0-9_-]+$/u);
	assert.equal(await realpath(dirname(options.output)), dirname(options.output));
	const paths = resolveMotionQualificationPaths(root, 'motionscaper', process.arch);
	const stage = await verifyMotionscaperDesktopStage(paths.stage, 'linux-x64');
	const source = await verifyMotionMaximumApplicationSource(root, stage.sourceRevision);
	await verifyMotionscaperPackagedResources(join(paths.package, 'resources'), stage);
	const packageBefore = await motionAuthoredPackageIdentity(paths.package);
	await mkdir(options.output, { mode: 0o700 });
	const write = (name: string, value: unknown) => writeFile(join(options.output, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
	await write('input-authority.json', { source, paths, profile, packageBefore, display: process.env.DISPLAY, options });
	const referenceDirectory = join(options.output, 'reference'); await mkdir(referenceDirectory, { mode: 0o700 });
	const decoder = await prepareMotionMaximumDecoder(root, referenceDirectory, options.ffmpegPrefix, options.nativeResult, { path: options.prefixAuthority, sha256: options.prefixAuthoritySha256 });
	const decoderIdentity = await motionAuthoredFileIdentity(decoder.executable);
	const fixture = options.kind === 'index' ? createMotionMaximumIndexFixture() : { revision: createMotionscaperRevision(createMotionMaximumScene(options.kind)), bodies: new Map<string, Uint8Array>() };
	const archivePath = join(options.output, 'saved.mscape');
	const archive = await exportMotionscaperArchive(fixture.revision.project, asset => { const body = fixture.bodies.get(asset.id); if (!body) throw new Error('Missing maximum fixture retained asset.'); return Promise.resolve(new Blob([new Uint8Array(body)])); });
	assert.ok(archive); await writeFile(archivePath, new Uint8Array(await archive.arrayBuffer()), { flag: 'wx', mode: 0o600 });
	const archiveBefore = await hashMotionSustainedFile(archivePath);
	let application: Awaited<ReturnType<typeof launchMotionSustainedApplication>> | undefined;
	const receipt = await finishMotionAuthoredQualification(async () => {
		application = await launchMotionSustainedApplication({ executable: paths.executable, cwd: root, directory: options.output, native: true });
		const page = application.page, errors: string[] = []; page.setDefaultTimeout(15000);
		page.on('pageerror', error => { if (errors.length < 32) errors.push(error.message); });
		await expect(page.locator('[data-motion-editor-bound="true"]')).toBeVisible({ timeout: 30000 }); assert.ok(page.url().startsWith('motionscaper-app://bundle/'));
		let chooserSequence = 0;
		const choose = async (path: string) => {
			const result = await motionSustainedCommand({ command: '/usr/bin/python3', args: ['-B', '-E', '-s', join(root, 'scripts/lib/motionscaper-scene-chooser-x11.py'), path], cwd: root, directory: options.output, id: `gtk-chooser-${++chooserSequence}`, timeoutMs: 20000 });
			assert.match(result.stdout, /MOTIONSCAPER_NATIVE_FILE_CHOOSER_SELECTED/u);
		};
		await motionSustainedMenu(page, 'File', 'Open'); await choose(archivePath);
		await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device', { timeout: 30000 });
		await expect(page.locator('[data-motion-project-title]')).toHaveText(fixture.revision.project.title);
		const preview = await previewMotionMaximum(application, options.kind, options.output);
		const native = await renderMotionMaximum(application, options.kind, options.output, fixture.revision.digest, join(paths.package, 'resources/runtime/motionscaper-media-host/motionscaper-media-host'), choose);
		await verifyMotionAuthoredFileIdentity(decoderIdentity);
		const decoded = await decodeMotionMaximumNative(decoder.executable, native.movie, referenceDirectory, options.kind);
		const pictures = inspectMotionMaximumNativePictures(options.kind, decoded.rgba); assert.deepEqual(errors, []);
		return { kind: options.kind, source, profile, revisionDigest: fixture.revision.digest, preview, native,
			decoded: { ...decoded, rgba: undefined }, pictures, archive: archiveBefore, actualNativeChoosers: chooserSequence, errors };
	}, async () => { if (application) await application.cleanup(); }, async () => {
		assert.deepEqual(await verifyMotionMaximumApplicationSource(root, stage.sourceRevision), source);
		await verifyMotionscaperPackagedResources(join(paths.package, 'resources'), await verifyMotionscaperDesktopStage(paths.stage, 'linux-x64'));
		assert.deepEqual(await motionAuthoredPackageIdentity(paths.package), packageBefore);
		assert.deepEqual(await hashMotionSustainedFile(archivePath), archiveBefore);
		await verifyMotionAuthoredFileIdentity(decoderIdentity);
		assert.deepEqual(await hashMotionSustainedFile(decoder.receipt.source.path, 1024 * 1024), decoder.receipt.source);
		await verifyMotionSustainedReferenceAuthority(options.prefixAuthority, options.prefixAuthoritySha256, options.ffmpegPrefix, decoder.receipt.nativeBuildReceiptSha256);
	}, value => write('result.json', value));
	console.log(`MOTIONSCAPER_NATIVE_MAXIMUM_QUALIFIED ${JSON.stringify({ kind: options.kind, source, revisionDigest: receipt.revisionDigest, pictures: receipt.pictures, profile })}`);
}
