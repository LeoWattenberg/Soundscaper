#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	DESKTOP_VIDEO_TIMING_PROBE_MODE,
	DESKTOP_VIDEO_TIMING_PROBE_PREFIX,
	DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS,
	createDesktopVideoTimingProbeEvidence,
	createDesktopVideoTimingProbePlan,
	encodeDesktopVideoTimingProbePlan,
	formatDesktopVideoTimingProbeEvidence,
} from '../desktop/video-timing-probe-smoke.js';
import { videoTimingProbeMedia } from '../tests/browser/fixtures/video-timing-probe-media.js';
import { packagedExecutableCandidates, resolveSmokeArchitecture } from './lib/desktop-smoke.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(ROOT, 'release/desktop');
const PRODUCT_ID = process.env.SCAPE_PRODUCT === 'framescaper' ? 'framescaper' : 'soundscaper';
const PRODUCT_NAME = PRODUCT_ID === 'framescaper' ? 'Framescaper' : 'Soundscaper';
const TARGET_ARCH = resolveSmokeArchitecture(process.env.SOUNDSCAPER_SMOKE_ARCH, process.arch);
const executable = await findPackagedExecutable();
const workspace = await mkdtemp(join(tmpdir(), `${PRODUCT_ID}-desktop-video-timing-probe-`));
const profile = join(workspace, 'profile');

try {
	const fixtures = [];
	for (const fixture of videoTimingProbeMedia) {
		const path = join(workspace, fixture.file.name);
		await writeFile(path, fixture.file.buffer, { flag: 'wx' });
		fixtures.push({
			id: fixture.id,
			kind: fixture.kind,
			path,
			name: fixture.file.name,
			sourceSha256: fixture.sourceSha256,
			nominalRate: fixture.nominalRate,
			timescale: fixture.timescale,
			presentationTicks: fixture.presentationTicks.map(String),
			finalFrameDurationTicks: String(fixture.finalFrameDurationTicks),
			timingSha256: fixture.timingSha256,
		});
	}
	const plan = createDesktopVideoTimingProbePlan({
		schemaVersion: 1,
		mode: DESKTOP_VIDEO_TIMING_PROBE_MODE,
		productId: PRODUCT_ID,
		token: randomBytes(16).toString('hex'),
		fixtures,
	});
	const appArgs = [
		`--user-data-dir=${profile}`,
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${DESKTOP_VIDEO_TIMING_PROBE_MODE}`,
		`--soundscaper-smoke-plan=${encodeDesktopVideoTimingProbePlan(plan)}`,
		`--soundscaper-smoke-app-data=${join(workspace, 'application-data')}`,
	];
	const useXvfb = process.platform === 'linux' && process.env.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const result = await run(useXvfb ? 'xvfb-run' : executable, useXvfb
		? ['-a', executable, ...appArgs]
		: appArgs);
	if (result.code !== 0) {
		throw new Error(`Packaged video timing-probe smoke exited with code ${result.code}.\n${result.output}`);
	}
	const prefix = `${DESKTOP_VIDEO_TIMING_PROBE_PREFIX} `;
	const lines = result.output.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
	if (lines.length !== 1) {
		throw new Error(`Packaged video timing-probe smoke must emit exactly one result.\n${result.output}`);
	}
	let payload;
	try { payload = JSON.parse(lines[0].slice(prefix.length)); } catch (error) {
		throw new Error('Packaged video timing-probe smoke emitted invalid result JSON.', { cause: error });
	}
	const evidence = createDesktopVideoTimingProbeEvidence({
		arch: TARGET_ARCH,
		platform: process.platform,
		result: payload,
	}, plan);
	const evidencePath = resolve(process.env.SOUNDSCAPER_VIDEO_TIMING_PROBE_RESULT
		|| join(OUTPUT_ROOT, `desktop-video-timing-probe-${PRODUCT_ID}-${evidence.target}.json`));
	await mkdir(dirname(evidencePath), { recursive: true });
	await writeFile(evidencePath, formatDesktopVideoTimingProbeEvidence(evidence), { flag: 'wx' });
	console.log(lines[0]);
} finally {
	await rm(workspace, { recursive: true, force: true });
}

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
		const child = spawn(binary, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const append = (chunk) => {
			output += String(chunk);
			if (output.length > 1024 * 1024) {
				child.kill();
				reject(new Error('Packaged video timing-probe smoke produced too much output.'));
			}
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.once('error', reject);
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error('Packaged video timing-probe smoke timed out.'));
		}, DESKTOP_VIDEO_TIMING_PROBE_TIMEOUT_MS + 10_000);
		child.once('exit', (code) => {
			clearTimeout(timeout);
			resolvePromise({ code, output });
		});
	});
}
