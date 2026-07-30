#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DESKTOP_SMOKE_EXPECTED_BRIDGE,
	assertDesktopSmokePayload,
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './lib/desktop-smoke.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(ROOT, 'release/desktop');
const PRODUCT_ID = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const PRODUCT_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
const APP_SCHEME = PRODUCT_ID === 'framescaper' ? 'framescaper-app' : 'soundscaper-app';
const TARGET_ARCH = resolveSmokeArchitecture(process.env.SOUNDSCAPER_SMOKE_ARCH, process.arch);

const executable = await findPackagedExecutable();
const useXvfb = process.platform === 'linux' && process.env.SOUNDSCAPER_SMOKE_XVFB === 'true';
const command = useXvfb ? 'xvfb-run' : executable;
const profile = await mkdtemp(join(tmpdir(), `${PRODUCT_ID}-desktop-smoke-`));
const smokeAppData = join(profile, 'application-data');
const appArgs = [
	`--user-data-dir=${profile}`,
	'--soundscaper-smoke',
	`--soundscaper-smoke-app-data=${smokeAppData}`,
];
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
assertDesktopSmokePayload(payload, {
	arch: TARGET_ARCH,
	bridge: DESKTOP_SMOKE_EXPECTED_BRIDGE,
	platform: process.platform,
	title: PRODUCT_NAME,
	url: `${APP_SCHEME}://bundle/`,
});
console.log(line);

async function findPackagedExecutable() {
	const candidates = packagedExecutableCandidates({
		arch: TARGET_ARCH,
		outputRoot: OUTPUT_ROOT,
		platform: process.platform,
		productId: PRODUCT_ID,
		productName: PRODUCT_NAME,
	});
	for (const candidate of candidates) {
		try {
			await access(candidate);
			return candidate;
		} catch {
			// Try the next electron-builder output convention.
		}
	}
	throw new Error(`No packaged ${process.platform}/${TARGET_ARCH} ${PRODUCT_NAME} executable was found.`);
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
