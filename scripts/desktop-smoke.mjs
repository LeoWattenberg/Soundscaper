#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(ROOT, 'release/desktop');
const PRODUCT_ID = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const PRODUCT_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
const APP_SCHEME = PRODUCT_ID === 'framescaper' ? 'framescaper-app' : 'soundscaper-app';
const EDITOR_PATH_PREFIX = PRODUCT_ID === 'framescaper' ? '/framescaper' : '';
const EXPECTED_BRIDGE = Object.freeze([
	'abortWrite',
	'beginWrite',
	'checkForUpdates',
	'chooseFiles',
	'chooseSaveTarget',
	'editText',
	'finishWrite',
	'getEnvironment',
	'onCloseRequested',
	'onFullscreenChanged',
	'onMenuCommand',
	'onOpenProject',
	'openExternal',
	'releaseRead',
	'respondToClose',
	'setFullscreen',
	'setLocale',
	'signalReady',
	'writeChunk',
]);

const executable = await findPackagedExecutable();
const useXvfb = process.platform === 'linux' && process.env.SOUNDSCAPER_SMOKE_XVFB === 'true';
const command = useXvfb ? 'xvfb-run' : executable;
const profile = await mkdtemp(join(tmpdir(), `${PRODUCT_ID}-desktop-smoke-`));
const appArgs = [`--user-data-dir=${profile}`, '--soundscaper-smoke'];
const args = useXvfb ? ['-a', executable, ...appArgs] : appArgs;
let result;
try {
	result = await run(command, args);
} finally {
	await rm(profile, { recursive: true, force: true });
}
if (result.code !== 0) throw new Error(`Packaged desktop smoke exited with code ${result.code}.\n${result.output}`);
const line = result.output.split(/\r?\n/u).find((value) => value.startsWith('SOUNDSCAPER_DESKTOP_SMOKE '));
if (!line) throw new Error(`Packaged desktop smoke did not emit its result.\n${result.output}`);
const payload = JSON.parse(line.slice('SOUNDSCAPER_DESKTOP_SMOKE '.length));
assert(new RegExp(`^${APP_SCHEME}://bundle${EDITOR_PATH_PREFIX}/embed/[^/]+/$`, 'u').test(payload.url), 'Smoke loaded an unexpected URL.');
assert(payload.title === PRODUCT_NAME, 'Smoke loaded an unexpected document title.');
assert(payload.hasEditor === true, 'Smoke did not render the editor document.');
assert(payload.nodeExposed === false, 'Smoke exposed Node.js globals to the renderer.');
assert(JSON.stringify(payload.bridge) === JSON.stringify(EXPECTED_BRIDGE), 'Smoke bridge surface does not match the reviewed v1 contract.');
console.log(line);

async function findPackagedExecutable() {
	const archSuffix = process.arch === 'x64' ? '' : `-${process.arch}`;
	const candidates = process.platform === 'win32'
		? [
			resolve(OUTPUT_ROOT, `win${archSuffix}-unpacked/${PRODUCT_NAME}.exe`),
			resolve(OUTPUT_ROOT, `win-unpacked/${PRODUCT_NAME}.exe`),
		]
		: process.platform === 'darwin'
			? [
				resolve(OUTPUT_ROOT, `mac${archSuffix}/${PRODUCT_NAME}.app/Contents/MacOS/${PRODUCT_NAME}`),
				resolve(OUTPUT_ROOT, `mac/${PRODUCT_NAME}.app/Contents/MacOS/${PRODUCT_NAME}`),
			]
			: [
				resolve(OUTPUT_ROOT, `linux${archSuffix}-unpacked/${PRODUCT_ID}`),
				resolve(OUTPUT_ROOT, `linux-unpacked/${PRODUCT_ID}`),
			];
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder output convention.
		}
	}
	throw new Error(`No packaged ${process.platform}/${process.arch} ${PRODUCT_NAME} executable was found.`);
}

function run(binary, args) {
	return new Promise((resolvePromise, reject) => {
		const env = { ...process.env };
		delete env.ELECTRON_RUN_AS_NODE;
		const child = spawn(binary, args, {
			cwd: ROOT,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		const append = (chunk) => {
			output += String(chunk);
			if (output.length > 1024 * 1024) {
				child.kill();
				reject(new Error('Packaged desktop smoke produced too much output.'));
			}
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.once('error', reject);
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error('Packaged desktop smoke timed out.'));
		}, 30_000);
		child.once('exit', (code) => {
			clearTimeout(timeout);
			resolvePromise({ code, output });
		});
	});
}

function assert(condition, message) {
	if (!condition) throw new Error(message);
}
