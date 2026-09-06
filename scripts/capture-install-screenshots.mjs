#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Capture the install-dialog screenshots the product manifests declare.
 *
 * This is deliberately not part of `npm run build`, and must not become part of
 * it: it needs a browser and a built product site, and the build is kept cheap.
 * Run it by hand when the editor's interface changes:
 *
 *   npm run prepare:browser:products
 *   node --import tsx scripts/capture-install-screenshots.mjs
 *
 * It drives the same built sites and the same Playwright browser the browser
 * suite uses, opens the editor with audio actually on the timeline, and writes
 * one PNG per declared screenshot into `public/install-screenshots/`. Those
 * files are committed, exactly as `public/logo/` is, because an install dialog
 * has to show the real product: a mock there is a promise about an interface
 * that does not exist. The cost of committing them is that they go stale on
 * their own — nothing recaptures them when the interface moves, and no gate can
 * tell a current screenshot from a year-old one.
 *
 * `--check` is the half that runs anywhere. It opens no browser, needs no
 * built site, and confirms only that every screenshot the manifests declare
 * exists, is a PNG, is exactly the size it was declared at, and is small enough
 * for the offline install core to carry. That is what CI runs, through
 * `tests/product-install-screenshots.test.js`, so a manifest promising an image
 * the repository does not have fails there rather than in a browser's install
 * dialog.
 */

import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { argv, env, exit, stderr, stdout } from 'node:process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
	INSTALL_SCREENSHOTS,
	INSTALL_SCREENSHOT_DIRECTORY,
	productScreenshotNames,
} from './lib/product-web-manifest.mjs';

const REPOSITORY_ROOT = resolve(import.meta.dirname, '..');
const PRODUCT_IDS = Object.freeze(['soundscaper', 'framescaper']);

/**
 * The most one screenshot may weigh.
 *
 * These files join the offline install core, which is capped at 8 MiB for every
 * product and which Framescaper already fills to about 6.7 MiB. Two screenshots
 * at this ceiling leave that build most of a megabyte of headroom, and a
 * capture that somehow lands above it fails here — with the byte count — rather
 * than in a build that says only that the install inventory is too large.
 */
export const MAXIMUM_SCREENSHOT_BYTES = 384 * 1024;

/** The PNG signature and the header chunk every conforming encoder writes first. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * How long the preview server and the editor are each given.
 *
 * Generous on purpose. This runs by hand on whatever machine is free, and the
 * editor has to boot, decode several takes and render their waveforms before
 * there is anything worth photographing; a capture that gives up early wastes
 * the whole run, and one 60-second wait already has.
 */
const SERVER_TIMEOUT_MS = 120_000;
const EDITOR_TIMEOUT_MS = 120_000;

/**
 * Products that edit the moving image import one video as well.
 *
 * Half of Framescaper's interface is its program preview, and a capture with
 * nothing in it advertises an editor whose preview reads "add video to the
 * timeline". The clip is the repository's own 1280x720 synthetic benchmark
 * fixture — bytes this project generated and owns, carrying no third-party
 * media — so the screenshot shows the real compositor rendering a real frame.
 */
const PRODUCTS_EDITING_VIDEO = Object.freeze(['framescaper']);
const VIDEO_TAKE_NAME = 'Camera A.webm';

/**
 * The takes each capture lands on the timeline.
 *
 * An empty editor is a screenshot of nothing: the timeline is the product, so
 * the dialog has to show clips in it. Three sources of different lengths and
 * levels give three tracks whose waveforms differ, which is what an arrangement
 * looks like, and they fill the taller narrow frame as well as the wide one.
 */
const CAPTURE_TAKES = Object.freeze([
	Object.freeze({ name: 'Take one.wav', frequency: 220, duration: 6.5, amplitude: 0.62 }),
	Object.freeze({ name: 'Take two.wav', frequency: 330, duration: 4.25, amplitude: 0.4 }),
	Object.freeze({ name: 'Room tone.wav', frequency: 110, duration: 5.5, amplitude: 0.22 }),
]);

/** Every screenshot both product manifests declare, as files in the repository. */
export function installScreenshotDeclarations(repositoryRoot = REPOSITORY_ROOT) {
	return PRODUCT_IDS.flatMap((productId) => productScreenshotNames(productId).map((name, index) => {
		const { formFactor, width, height } = INSTALL_SCREENSHOTS[index];
		return Object.freeze({
			productId,
			formFactor,
			width,
			height,
			type: 'image/png',
			src: `${INSTALL_SCREENSHOT_DIRECTORY}/${name}.png`,
			path: resolve(repositoryRoot, 'public', INSTALL_SCREENSHOT_DIRECTORY, `${name}.png`),
		});
	}));
}

/**
 * Confirm every declared screenshot exists as declared, without capturing.
 *
 * Returns one record per declaration so a caller can report byte counts; throws
 * naming every declaration that failed rather than only the first, because a
 * recapture fixes all of them in one pass.
 */
export async function checkInstallScreenshots({ repositoryRoot = REPOSITORY_ROOT, productIds = PRODUCT_IDS } = {}) {
	const declarations = installScreenshotDeclarations(repositoryRoot)
		.filter((declaration) => productIds.includes(declaration.productId));
	const records = [];
	const failures = [];
	for (const declaration of declarations) {
		let bytes;
		try {
			bytes = await readFile(declaration.path);
		} catch {
			failures.push(`${declaration.src} is declared but the repository has no such file`);
			continue;
		}
		const geometry = pngGeometry(bytes);
		if (!geometry) {
			failures.push(`${declaration.src} is declared as image/png and is not a PNG`);
			continue;
		}
		if (geometry.width !== declaration.width || geometry.height !== declaration.height) {
			failures.push(`${declaration.src} is declared ${declaration.width}x${declaration.height}`
				+ ` and is ${String(geometry.width)}x${String(geometry.height)}`);
			continue;
		}
		if (bytes.byteLength > MAXIMUM_SCREENSHOT_BYTES) {
			failures.push(`${declaration.src} is ${String(bytes.byteLength)} bytes,`
				+ ` above the ${String(MAXIMUM_SCREENSHOT_BYTES)}-byte install-core ceiling`);
			continue;
		}
		records.push(Object.freeze({ ...declaration, byteLength: bytes.byteLength }));
	}
	if (failures.length > 0) {
		throw new Error(`Declared install screenshots do not match the repository:\n${failures.map((line) => `  ${line}`).join('\n')}`
			+ '\nRun: node --import tsx scripts/capture-install-screenshots.mjs');
	}
	return Object.freeze(records);
}

/** The dimensions a PNG's own header states, or null for anything else. */
export function pngGeometry(bytes) {
	if (bytes.byteLength < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
	if (bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
	return Object.freeze({ width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
}

async function capture({ productIds }) {
	const sites = await import('./lib/browser-product-test-sites.mjs');
	const { chromium } = await import('@playwright/test');
	// A built fixture is verified against the origin it was built for — its
	// documents carry that origin — so the capture serves it on exactly that
	// port rather than one of its own. Those are the browser suite's ports, so
	// a capture and a browser run cannot be in flight at the same time; the
	// preview server holds the port strictly and says so if one already is.
	const plan = sites.ordinaryBrowserProductSitePlan({
		...env,
		PLAYWRIGHT_PORT: await fixturePort(sites, 'soundscaper'),
		PLAYWRIGHT_FRAMESCAPER_PORT: await fixturePort(sites, 'framescaper'),
	});
	const seed = await onboardingSeed();
	const captured = [];
	for (const productId of productIds) {
		const site = plan.sites.find((candidate) => candidate.productId === productId);
		try {
			await sites.verifyBrowserProductSite(site);
		} catch (error) {
			throw new Error(`The ${productId} product site at ${site.outputDirectory} is not one this capture can drive:`
				+ ` ${error instanceof Error ? error.message : String(error)}`
				+ ' Rebuild it with `npm run prepare:browser:products`.', { cause: error });
		}
		const server = await startPreviewServer(site);
		const browser = await chromium.launch();
		try {
			for (const declaration of installScreenshotDeclarations().filter((entry) => entry.productId === productId)) {
				captured.push(await captureOne({ browser, declaration, origin: site.origin, productId, seed }));
			}
		} finally {
			await browser.close();
			await server.close();
		}
	}
	return captured;
}

/** The port one built fixture was built for, from the evidence it recorded. */
async function fixturePort(sites, productId) {
	const path = resolve(REPOSITORY_ROOT, sites.BROWSER_PRODUCT_FIXTURE_ROOT, productId, sites.BROWSER_PRODUCT_EVIDENCE);
	try {
		return new URL(JSON.parse(await readFile(path, 'utf8')).origin).port;
	} catch (error) {
		throw new Error(`The ${productId} product site is not built at ${path}.`
			+ ' Run `npm run prepare:browser:products` first.', { cause: error });
	}
}

async function captureOne({ browser, declaration, origin, productId, seed }) {
	const context = await browser.newContext({
		viewport: { width: declaration.width, height: declaration.height },
		deviceScaleFactor: 1,
		// The manifest's splash is the light surface, so the dialog beside it is
		// the light editor. Motion is stilled so two captures of one interface
		// differ only where the interface does.
		colorScheme: 'light',
		reducedMotion: 'reduce',
		serviceWorkers: 'block',
	});
	await context.addInitScript(({ key, value }) => {
		try {
			globalThis.localStorage?.setItem(key, value);
		} catch {
			// A storage-less context falls back to the onboarding dialog itself.
		}
	}, { key: seed.key(productId), value: seed.value() });
	const page = await context.newPage();
	try {
		await page.goto(`${origin}/en/`, { waitUntil: 'domcontentloaded', timeout: EDITOR_TIMEOUT_MS });
		const editor = page.locator('[data-audio-editor]');
		await editor.waitFor({ state: 'visible', timeout: EDITOR_TIMEOUT_MS });
		await page.waitForFunction(
			() => document.querySelector('[data-audio-editor]')?.getAttribute('data-audio-editor-bound') === 'true',
			undefined,
			{ timeout: EDITOR_TIMEOUT_MS },
		);
		await placeTakesOnTimeline(page, editor, productId);
		// The start URL opens the editor inside the site page, under a heading and
		// beside the brand navigation, and an install dialog that showed that would
		// be a picture of a web page rather than of the application being
		// installed. The editor's own Fullscreen control is what fills the window
		// with it, so the capture presses it: one real button on the real page,
		// never a state written around the interface.
		await editor.getByRole('button', { name: 'Fullscreen', exact: true }).click();
		await page.waitForFunction(
			() => document.querySelector('[data-audio-editor]')
				?.classList.contains('kw-audio-editor--viewport-fullscreen') === true,
			undefined,
			{ timeout: EDITOR_TIMEOUT_MS },
		);
		// The pointer is left where the last click landed, and whatever now sits
		// under it opens a tooltip in the picture. Park it in the corner, drop the
		// focus ring that click left behind, and let both settle before the shutter.
		await page.mouse.move(0, 0);
		await page.evaluate(() => { document.activeElement?.blur?.(); });
		await page.evaluate(() => document.fonts.ready);
		await delay(750);
		await mkdir(resolve(declaration.path, '..'), { recursive: true });
		await page.screenshot({
			path: declaration.path,
			type: 'png',
			animations: 'disabled',
			caret: 'hide',
			scale: 'css',
		});
		return declaration;
	} finally {
		await context.close();
	}
}

/**
 * Import the takes through the editor's own import input.
 *
 * This is the path a dropped batch takes, so the arrangement in the screenshot
 * is one a person could have made — never a state written straight into
 * storage, which could show a timeline the editor cannot actually produce.
 */
async function placeTakesOnTimeline(page, editor, productId) {
	// An open Project bin makes the routed import file its takes there instead of
	// on the timeline — deliberately, because that is what the panel is for — so
	// the capture closes it the way a person would, through its own menu.
	const bin = editor.locator('[data-workspace-panel="project-bin"]');
	if (await bin.isVisible()) {
		await bin.locator('.kw-audio-editor__workspace-panel-header [data-workspace-panel-menu] > button').click();
		const menu = page.locator('.kw-audio-editor__workspace-panel-menu');
		await menu.waitFor({ state: 'visible', timeout: 10_000 });
		await menu.getByRole('menuitem', { name: 'Close', exact: true }).click();
		await bin.waitFor({ state: 'hidden', timeout: 10_000 });
	}
	const editsVideo = PRODUCTS_EDITING_VIDEO.includes(productId);
	await editor.locator('[data-import-input]').first().setInputFiles([
		...editsVideo ? [await repositoryVideoTake()] : [],
		...CAPTURE_TAKES.map(waveTake),
	]);
	await page.waitForFunction(
		(expected) => {
			const editorElement = document.querySelector('[data-audio-editor]');
			if (editorElement?.querySelector('[data-status]')?.getAttribute('data-state') !== 'success') return false;
			const waveforms = [...editorElement.querySelectorAll('canvas.clip-body__waveform')];
			return waveforms.length >= expected
				&& waveforms.every((canvas) => canvas.getAttribute('data-waveform-source') !== null);
		},
		CAPTURE_TAKES.length,
		{ timeout: EDITOR_TIMEOUT_MS },
	);
	if (!editsVideo) return;
	// The preview states in words that it has nothing to show until it does.
	await page.waitForFunction(
		() => document.querySelector('.kw-audio-editor__video-preview-empty') === null,
		undefined,
		{ timeout: EDITOR_TIMEOUT_MS },
	);
}

/** The repository's own video fixture, under the name the timeline will show. */
async function repositoryVideoTake() {
	const { videoPreviewBenchmarkMedia } = await import('../tests/browser/fixtures/video-preview-benchmark-media.js');
	return {
		name: VIDEO_TAKE_NAME,
		mimeType: videoPreviewBenchmarkMedia.file.mimeType,
		buffer: videoPreviewBenchmarkMedia.file.buffer,
	};
}

/** One take as a 16-bit PCM WAV, so the import path is the ordinary one. */
function waveTake({ name, frequency, duration, amplitude }) {
	const sampleRate = 48_000;
	const channelCount = 2;
	const frameCount = Math.round(duration * sampleRate);
	const dataLength = frameCount * channelCount * 2;
	const buffer = Buffer.alloc(44 + dataLength);
	buffer.write('RIFF', 0);
	buffer.writeUInt32LE(36 + dataLength, 4);
	buffer.write('WAVE', 8);
	buffer.write('fmt ', 12);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(channelCount, 22);
	buffer.writeUInt32LE(sampleRate, 24);
	buffer.writeUInt32LE(sampleRate * channelCount * 2, 28);
	buffer.writeUInt16LE(channelCount * 2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write('data', 36);
	buffer.writeUInt32LE(dataLength, 40);
	for (let frame = 0; frame < frameCount; frame += 1) {
		// An envelope rather than a flat tone: a rectangle of ink says nothing
		// about what the editor draws, and a shaped take reads as recorded audio.
		const position = frame / frameCount;
		const envelope = Math.min(1, position * 12) * Math.min(1, (1 - position) * 6)
			* (0.55 + (0.45 * Math.sin(position * Math.PI * 7)));
		for (let channel = 0; channel < channelCount; channel += 1) {
			const phase = channel === 0 ? 0 : Math.PI / 3;
			const sample = Math.sin(((2 * Math.PI * frequency * frame) / sampleRate) + phase)
				* amplitude * envelope;
			buffer.writeInt16LE(Math.round(sample * 32_767), 44 + (((frame * channelCount) + channel) * 2));
		}
	}
	return { name, mimeType: 'audio/wav', buffer };
}

/**
 * The finished-onboarding record, read from the module that owns its shape.
 *
 * It is imported here rather than restated because a copy that drifts would
 * silently put the workspace chooser in front of the editor in every capture.
 * The import is dynamic so `--check` still runs under plain node, which cannot
 * load a TypeScript module.
 */
async function onboardingSeed() {
	const module = await import('../src/common/editor/ui/first-launch-setup.ts');
	return { key: module.firstLaunchSetupStorageKey, value: module.firstLaunchSetupSeedValue };
}

async function startPreviewServer(site) {
	const outputDirectory = resolve(REPOSITORY_ROOT, site.outputDirectory);
	const port = new URL(site.origin).port;
	const child = spawn(process.execPath, [
		resolve(REPOSITORY_ROOT, 'node_modules/vite/bin/vite.js'),
		'preview',
		'--outDir', outputDirectory,
		'--host', '127.0.0.1',
		'--port', port,
		'--strictPort',
		'--logLevel', 'error',
	], { cwd: REPOSITORY_ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
	let diagnostics = '';
	child.stderr.setEncoding('utf8');
	child.stderr.on('data', (chunk) => { diagnostics += chunk; });
	const deadline = Date.now() + SERVER_TIMEOUT_MS;
	for (;;) {
		if (child.exitCode !== null) {
			throw new Error(`The ${site.productId} preview server exited early.\n${diagnostics}`);
		}
		try {
			const response = await fetch(`${site.origin}/en/`, { redirect: 'manual' });
			await response.arrayBuffer();
			if (response.status === 200) break;
		} catch {
			// The server has not bound its port yet.
		}
		if (Date.now() > deadline) throw new Error(`The ${site.productId} preview server never answered ${site.origin}/en/.`);
		await delay(250);
	}
	return {
		close: async () => {
			child.kill('SIGTERM');
			await new Promise((settle) => { child.once('exit', settle); });
		},
	};
}

async function main() {
	const requested = argv.slice(2);
	const unknown = requested.filter((argument) => argument !== '--check'
		&& !PRODUCT_IDS.some((productId) => argument === `--product=${productId}`));
	if (unknown.length > 0) {
		stderr.write(`Usage: capture-install-screenshots.mjs [--check] [--product=${PRODUCT_IDS.join('|')}]\n`);
		exit(2);
	}
	const named = PRODUCT_IDS.filter((productId) => requested.includes(`--product=${productId}`));
	const productIds = named.length > 0 ? named : PRODUCT_IDS;
	if (requested.includes('--check')) {
		const records = await checkInstallScreenshots({ productIds });
		for (const record of records) {
			stdout.write(`${record.src} ${String(record.width)}x${String(record.height)} ${String(record.byteLength)} bytes\n`);
		}
		return;
	}
	const captured = await capture({ productIds });
	for (const record of captured) stdout.write(`captured ${record.src}\n`);
	await checkInstallScreenshots({ productIds });
}

if (resolve(argv[1] ?? '') === resolve(import.meta.dirname, 'capture-install-screenshots.mjs')) {
	await main().catch((error) => {
		stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
		exit(1);
	});
}
