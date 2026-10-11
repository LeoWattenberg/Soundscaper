/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'esbuild';
import { verifyBrowserProductBuildEvidence } from '../lib/browser-product-site-evidence.mjs';
import { verifyMotionscaperDesktopStage, verifyMotionscaperPackagedResources } from '../lib/motionscaper-desktop-package.mjs';
import { exportMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import { MOTION_SUSTAINED_PLAN as plan, assessMotionSustainedMemory } from './motionscaper-sustained-plan.ts';
import { createMotionSustainedFixture } from './motionscaper-sustained-project.ts';
import { hashMotionSustainedFile } from './motionscaper-sustained-observation.ts';
import { launchMotionSustainedApplication } from './motionscaper-sustained-launch.ts';
import { qualifyMotionSustainedPreview } from './motionscaper-sustained-preview.ts';
import { openMotionSustainedArchive } from './motionscaper-sustained-ui.ts';
import { motionSustainedOpfsSource, cleanupMotionSustainedDestination, readMotionSustainedDestination } from './motionscaper-sustained-opfs.ts';
import { renderMotionSustainedBrowser, verifyMotionSustainedBrowserVideo } from './motionscaper-sustained-browser.ts';
import { motionSustainedNativeChooser, renderMotionSustainedNative } from './motionscaper-sustained-native.ts';
import { qualifyMotionSustainedCancellation } from './motionscaper-sustained-cancel.ts';
import { decodeMotionSustainedNative, prepareMotionSustainedDecoder } from './motionscaper-sustained-native-reference.ts';
import { prepareMotionSustainedPictures, compareMotionSustainedRgba, compareMotionSustainedNative } from './motionscaper-sustained-pictures.ts';
import type { MotionSustainedPhaseSamples } from './motionscaper-sustained-sampler.ts';

interface Config {
	readonly schemaVersion: 1; readonly mode: 'browser' | 'native'; readonly sourceRevision: string; readonly planSha256: string; readonly outputDirectory: string;
	readonly browser: Readonly<{ url: string; siteDirectory: string }> | null;
	readonly native: Readonly<{ stage: string; package: string; ffmpegPrefix: string; nativeResult: string; prefixAuthority: string; prefixAuthoritySha256: string }> | null;
}
const root = resolve(import.meta.dirname, '../..');
const pixelDigest = (bytes: Uint8Array | Uint8ClampedArray | Float32Array) => createHash('sha256').update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest('hex');
function distinct(digests: readonly string[]) { assert.equal(digests.length, 3); assert.equal(new Set(digests).size, 3, 'Selected pictures must all differ.'); }
function clean(revision: string): void {
	assert.match(revision, /^[a-f0-9]{40}$/u);
	assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), revision);
	assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
}
function record(value: unknown): Record<string, unknown> { assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>; }
function path(value: unknown): asserts value is string { assert.ok(typeof value === 'string' && isAbsolute(value) && resolve(value) === value && !value.includes('\0')); }
function parse(value: unknown): Config {
	const config = record(value); assert.deepEqual(Object.keys(config).sort(), ['browser', 'mode', 'native', 'outputDirectory', 'planSha256', 'schemaVersion', 'sourceRevision']);
	assert.equal(config.schemaVersion, 1); assert.ok(config.mode === 'browser' || config.mode === 'native');
	assert.ok(typeof config.sourceRevision === 'string' && /^[a-f0-9]{40}$/u.test(config.sourceRevision));
	assert.ok(typeof config.planSha256 === 'string' && /^[a-f0-9]{64}$/u.test(config.planSha256)); path(config.outputDirectory);
	if (config.mode === 'browser') {
		assert.equal(config.native, null); const browser = record(config.browser); assert.deepEqual(Object.keys(browser).sort(), ['siteDirectory', 'url']); path(browser.siteDirectory);
		assert.ok(typeof browser.url === 'string' && /^http:\/\/127\.0\.0\.1:\d+\/en\/$/u.test(browser.url));
	} else {
		assert.equal(config.browser, null); const native = record(config.native);
		assert.deepEqual(Object.keys(native).sort(), ['ffmpegPrefix', 'nativeResult', 'package', 'prefixAuthority', 'prefixAuthoritySha256', 'stage']);
		for (const name of ['ffmpegPrefix', 'nativeResult', 'package', 'prefixAuthority', 'stage']) path(native[name]);
		assert.ok(typeof native.prefixAuthoritySha256 === 'string' && /^[a-f0-9]{64}$/u.test(native.prefixAuthoritySha256));
	}
	return config as unknown as Config;
}
async function write(path: string, value: unknown) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' }); return hashMotionSustainedFile(path); }
async function closeApplication(application: Awaited<ReturnType<typeof launchMotionSustainedApplication>>, workloadFailure: unknown) {
	try { return await application.cleanup(); }
	catch (cleanup) {
		if (workloadFailure) throw new AggregateError([workloadFailure, cleanup], 'Workload and application cleanup failed.', { cause: cleanup });
		throw cleanup;
	}
}
async function qualify(config: Config, inputPin: Awaited<ReturnType<typeof hashMotionSustainedFile>>) {
	clean(config.sourceRevision);
	assert.equal(process.platform, 'linux'); assert.equal(process.arch, 'x64');
	for (const key of ['NODE_V8_COVERAGE', 'SCAPE_BROWSER_COVERAGE', 'ELECTRON_RUN_AS_NODE']) assert.ok(!process.env[key], `${key} must be absent.`);
	const planPin = await hashMotionSustainedFile(join(root, 'scripts/performance/motionscaper-sustained-plan.ts')); assert.equal(planPin.sha256, config.planSha256);
	const packageLock = await hashMotionSustainedFile(join(root, 'package-lock.json'));
	await mkdir(config.outputDirectory, { recursive: false });
	const fixture = createMotionSustainedFixture(new Uint8Array(await readFile(join(root, 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2'))));
	const archive = await exportMotionscaperArchive(fixture.revision.project, asset => new Blob([Uint8Array.from(fixture.bodies.get(asset.id)!)], { type: asset.mimeType })); assert.ok(archive);
	const archivePath = join(config.outputDirectory, 'input.mscape'); await writeFile(archivePath, new Uint8Array(await archive.arrayBuffer()), { flag: 'wx' });
	const archivePin = await hashMotionSustainedFile(archivePath, 16 * 1024 * 1024);
	let executable = chromium.executablePath(), buildEvidence: unknown, helperPath = '', decoder: Awaited<ReturnType<typeof prepareMotionSustainedDecoder>> | null = null;
	let verifierBundle = '';
	if (config.browser) {
		buildEvidence = await verifyBrowserProductBuildEvidence({ outputDirectory: config.browser.siteDirectory, productId: 'motionscaper', origin: new URL(config.browser.url).origin, sourceRevision: config.sourceRevision });
		const response = await fetch(config.browser.url); assert.equal(response.status, 200);
		assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(config.browser.siteDirectory, 'en/index.html')), 'Served HTML differs from the authenticated Motion site.');
		const bundle = await build({ entryPoints: [join(root, 'scripts/performance/motionscaper-sustained-webm.ts')], bundle: true, write: false, format: 'iife', globalName: 'MotionSustainedVerification', platform: 'browser' });
		assert.equal(bundle.outputFiles.length, 1); verifierBundle = bundle.outputFiles[0]!.text;
		await writeFile(join(config.outputDirectory, 'webm-reference.js'), verifierBundle, { flag: 'wx' });
	} else {
		assert.ok(process.env.DISPLAY && config.native);
		const stage = await verifyMotionscaperDesktopStage(config.native.stage, 'linux-x64'); assert.equal(stage.sourceRevision, config.sourceRevision);
		await verifyMotionscaperPackagedResources(join(config.native.package, 'resources'), stage); buildEvidence = stage;
		executable = join(config.native.package, 'motionscaper'); helperPath = join(config.native.package, 'resources/runtime/motionscaper-media-host/motionscaper-media-host');
		const directory = join(config.outputDirectory, 'reference'); await mkdir(directory);
		decoder = await prepareMotionSustainedDecoder(root, directory, config.native.ffmpegPrefix, config.native.nativeResult,
			{ path: config.native.prefixAuthority, sha256: config.native.prefixAuthoritySha256 });
	}
	const evidencePin = await write(join(config.outputDirectory, 'build-evidence.json'), buildEvidence);
	const executablePin = await hashMotionSustainedFile(executable);
	const runs: { frames: number; phases: Record<string, MotionSustainedPhaseSamples>; receipt: unknown }[] = [];
	for (const frames of plan.runs) {
		clean(config.sourceRevision);
		const directory = join(config.outputDirectory, String(frames)); await mkdir(directory);
		const pictures = await prepareMotionSustainedPictures({ project: fixture.revision.project, bodies: fixture.bodies, frames, root });
		try {
			const referenceDigests = pictures.pictures.map(value => ({ index: value.index, floatSha256: pixelDigest(value.surface.pixels), previewSha256: pixelDigest(value.previewRgba), webmSha256: pixelDigest(value.webmRgba) }));
			for (const key of ['floatSha256', 'previewSha256', 'webmSha256'] as const) distinct(referenceDigests.map(value => value[key]));
			const application = await launchMotionSustainedApplication({ executable, cwd: root, directory, native: config.mode === 'native' });
			const phases: Record<string, MotionSustainedPhaseSamples> = {}, outputs: unknown[] = [], cancellations: unknown[] = [];
			let closure: unknown, workloadFailure: unknown;
			try {
				const chooser = config.native ? motionSustainedNativeChooser(root, directory) : undefined;
				const opfsName = `motion-sustained-${frames}`;
				if (config.browser) { await application.context.addInitScript({ content: motionSustainedOpfsSource({ directoryName: opfsName }) }); await application.page.goto(config.browser.url); }
				else assert.ok(application.page.url().startsWith('motionscaper-app://bundle/'));
				await openMotionSustainedArchive(application.page, archivePath, chooser);
				const preview = await qualifyMotionSustainedPreview(application, directory, frames, fixture.revision.digest); phases.preview = preview.measured;
				application.retainProcessIdentities(preview.measured.processIdentities);
				const previewPixels = [];
				for (const [index, actual] of preview.selected.entries()) {
					const path = join(directory, `preview-${actual.index}.rgba`); await writeFile(path, actual.rgba, { flag: 'wx' });
					previewPixels.push({ index: actual.index, file: await hashMotionSustainedFile(path), comparison: compareMotionSustainedRgba(actual.rgba, pictures.pictures[index]!.surface) });
				}
				distinct(previewPixels.map(value => value.file.sha256));
				outputs.push({ kind: 'preview', lifecycle: preview.lifecycle, pixels: previewPixels });
				if (config.browser) {
					let webmTransfer: Readonly<{ sha256: string; byteLength: number }> | undefined;
					for (const format of ['png', 'webm'] as const) {
						const result = await renderMotionSustainedBrowser(application, { format, frames, directory, revisionDigest: fixture.revision.digest });
						phases[format] = result.measured; application.retainProcessIdentities(result.measured.processIdentities);
						if (format === 'webm') webmTransfer = result.transfer;
						const selected = result.png?.selected.map((value, index) => {
							const pixels = pictures.decodePng(value.png); return { index: value.index, encodedSha256: value.sha256, decodedSha256: pixelDigest(pixels),
								comparison: compareMotionSustainedRgba(pixels, pictures.pictures[index]!.surface) };
						});
						if (selected) distinct(selected.map(value => value.decodedSha256));
						outputs.push({ kind: format, destination: result.destination, transfer: result.transfer, ...(result.png ? { png: { ...result.png, selected } } : {}) });
					}
					const references = pictures.pictures.map(value => ({ index: value.index, rgba: Array.from(value.webmRgba) }));
					outputs.push(await verifyMotionSustainedBrowserVideo(application, { url: config.browser.url, bundle: verifierBundle, directoryName: opfsName,
						fileName: 'output.webm', frames, references, transfer: webmTransfer!, outputPath: join(directory, 'webm-reference.json') }));
					const cancel = await qualifyMotionSustainedCancellation(application, { directory, frames, revisionDigest: fixture.revision.digest, phase: 'browser' });
					const retry = await readMotionSustainedDestination(application.page, cancel.retryName, join(directory, cancel.retryName));
					const decoded = await verifyMotionSustainedBrowserVideo(application, { url: config.browser.url, bundle: verifierBundle, directoryName: opfsName,
						fileName: cancel.retryName, frames, references, transfer: retry, outputPath: join(directory, 'retry-reference.json') });
					cancellations.push({ ...cancel, retry, decoded });
					const cleanup = await cleanupMotionSustainedDestination(application.page); assert.equal(cleanup.removed, true);
					outputs.push({ kind: 'opfs-cleanup', cleanup });
				} else {
					const result = await renderMotionSustainedNative(application, { frames, directory, revisionDigest: fixture.revision.digest, helperPath, choose: chooser! });
					phases.prores = result.measured; application.retainProcessIdentities(result.measured.processIdentities);
					outputs.push({ kind: 'prores', path: result.path, encoder: result.encoder });
					for (const phase of ['native-upload', 'native-encode'] as const) cancellations.push(await qualifyMotionSustainedCancellation(application,
						{ directory, frames, revisionDigest: fixture.revision.digest, phase, chooseNative: chooser }));
				}
			} catch (error) { workloadFailure = error; throw error; }
			finally {
				closure = await closeApplication(application, workloadFailure);
				await rm(join(directory, 'profile'), { recursive: true, force: true }); await assert.rejects(lstat(join(directory, 'profile')), { code: 'ENOENT' });
			}
			if (decoder) for (const name of ['output.mov', 'native-upload-retry.mov', 'native-encode-retry.mov']) {
				const referenceDirectory = join(directory, `${name}-reference`); await mkdir(referenceDirectory);
				const result = await decodeMotionSustainedNative(decoder.executable, join(directory, name), referenceDirectory, frames);
				const pixels = pictures.pictures.map((picture, index) => {
					const actual = result.rgba.subarray(index * 160 * 90 * 4, (index + 1) * 160 * 90 * 4);
					return { index: picture.index, sha256: pixelDigest(actual), comparison: compareMotionSustainedNative(actual, picture.surface) };
				}); distinct(pixels.map(value => value.sha256));
				const { rgba: _rgba, ...receipt } = result; outputs.push({ kind: 'native-reference', name, ...receipt, pixels });
			}
			const phasePins = await Promise.all(Object.values(phases).map(async phase => ({ phase: phase.phase, log: await hashMotionSustainedFile(phase.logPath), samples: phase.samples, processIdentities: phase.processIdentities })));
			const receipt = await write(join(directory, 'run-receipt.json'), { frames, revisionDigest: fixture.revision.digest, referenceDigests, outputs, cancellations, phases: phasePins, closure });
			runs.push({ frames, phases, receipt });
		} finally { pictures.dispose(); }
	}
	clean(config.sourceRevision);
	if (config.browser) await verifyBrowserProductBuildEvidence({ outputDirectory: config.browser.siteDirectory, productId: 'motionscaper', origin: new URL(config.browser.url).origin, sourceRevision: config.sourceRevision });
	else if (config.native) { const stage = await verifyMotionscaperDesktopStage(config.native.stage, 'linux-x64'); await verifyMotionscaperPackagedResources(join(config.native.package, 'resources'), stage); }
	const memory = Object.fromEntries(Object.keys(runs[0]!.phases).map(key => [key, assessMotionSustainedMemory(runs[0]!.phases[key]!.samples, runs[1]!.phases[key]!.samples)]));
	return write(join(config.outputDirectory, 'qualification-receipt.json'), { qualified: true, sourceRevision: config.sourceRevision, planPin, inputPin, packageLock, archivePin,
		revisionDigest: fixture.revision.digest, assets: fixture.revision.project.assets, evidencePin, executablePin, memory, runs: runs.map(value => ({ frames: value.frames, receipt: value.receipt })),
		scope: 'Controlled160x90/30fps300+1200frames; software Chromium or packaged Linux x64 only. Browser OPFS is real disk but not the OS chooser. WASM is capacity, not live allocation.' });
}

assert.equal(process.argv.length, 4, 'Supply approved run JSON path and its independently reviewed SHA256.');
const [manifestPath, expectedSha] = process.argv.slice(2); path(manifestPath); assert.match(expectedSha!, /^[a-f0-9]{64}$/u);
const manifestChunks: Uint8Array[] = [];
const manifest = await hashMotionSustainedFile(manifestPath, 65536, bytes => { manifestChunks.push(Uint8Array.from(bytes)); }); assert.equal(manifest.sha256, expectedSha);
try { console.log(JSON.stringify(await qualify(parse(JSON.parse(Buffer.concat(manifestChunks).toString('utf8')) as unknown), manifest))); }
catch (error) { console.error(error); process.exitCode = 1; }
