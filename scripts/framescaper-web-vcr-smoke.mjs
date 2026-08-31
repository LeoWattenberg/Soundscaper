#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	validateFramescaperWebVcrDormantSmokeResult,
	validateFramescaperWebVcrPackagedSmokeResult,
} from '../desktop/framescaper-web-vcr-renderer-smoke.js';
import {
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE,
	FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX,
	encodeFramescaperWebVcrSmokePlan,
} from '../desktop/framescaper-web-vcr-smoke-plan.js';
import {
	packagedExecutableCandidates,
	resolveSmokeArchitecture,
} from './lib/desktop-smoke.mjs';
import {
	createFramescaperWebVcrHttpsFixture,
} from './lib/framescaper-web-vcr-https-fixture.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = resolve(ROOT, 'release/desktop');
const TARGET_ARCH = resolveSmokeArchitecture(process.env.SOUNDSCAPER_SMOKE_ARCH, process.arch);
const PRODUCT_ID = 'framescaper';
const PRODUCT_NAME = 'Framescaper';
const PARTITION_NAME = 'framescaper-web-vcr-v1';
const WORKFLOW_PREFIX = 'FRAMESCAPER_WEB_VCR_PACKAGED_WORKFLOW ';
const executable = await findPackagedExecutable();
const temporaryRoot = await mkdtemp(join(tmpdir(), 'framescaper-web-vcr-smoke-'));
const fixture = await createFramescaperWebVcrHttpsFixture();

try {
	const dormantProfile = join(temporaryRoot, 'dormant-profile');
	const dormantPlan = planFor(FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_MODE);
	const dormant = validateFramescaperWebVcrDormantSmokeResult(
		await launch(dormantPlan, dormantProfile, FRAMESCAPER_WEB_VCR_DORMANT_SMOKE_PREFIX, 60_000),
		dormantPlan,
	);
	const dormantFiles = await recursiveFiles(dormantProfile);
	if (dormantFiles.some((path) => path.split(/[\\/]/u).includes(PARTITION_NAME))) {
		throw new Error('Dormant packaged smoke materialized the persistent Web VCR partition.');
	}

	const activeProfile = join(temporaryRoot, 'active-profile');
	const activePlan = planFor(FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_MODE);
	const active = validateFramescaperWebVcrPackagedSmokeResult(
		await launch(activePlan, activeProfile, FRAMESCAPER_WEB_VCR_PACKAGED_SMOKE_PREFIX, 140_000),
		activePlan,
	);
	console.log(`${WORKFLOW_PREFIX}${JSON.stringify({
		schemaVersion: 1,
		productId: PRODUCT_ID,
		diagnosticOnly: true,
		diagnosticScope: 'packaged-feasibility-only',
		dormant: { ...dormant, persistentGuestProfileMaterialized: false },
		active,
	})}`);
} finally {
	await fixture.close();
	await rm(temporaryRoot, { recursive: true, force: true });
}

function planFor(mode) {
	return Object.freeze({
		schemaVersion: 1,
		mode,
		productId: PRODUCT_ID,
		token: randomBytes(16).toString('hex'),
		origin: fixture.origin,
		certificateSha256: fixture.certificateSha256,
	});
}

async function launch(plan, profile, prefix, timeoutMs) {
	const smokeAppData = join(profile, 'application-data');
	const appArguments = [
		`--user-data-dir=${profile}`,
		'--soundscaper-smoke',
		`--soundscaper-smoke-mode=${plan.mode}`,
		`--soundscaper-smoke-plan=${encodeFramescaperWebVcrSmokePlan(plan)}`,
		`--soundscaper-smoke-app-data=${smokeAppData}`,
	];
	const useXvfb = process.platform === 'linux' && process.env.SOUNDSCAPER_SMOKE_XVFB === 'true';
	const command = useXvfb ? 'xvfb-run' : executable;
	const args = useXvfb ? ['-a', executable, ...appArguments] : appArguments;
	const result = await run(command, args, timeoutMs, plan.mode);
	if (result.code !== 0) {
		throw new Error(`Packaged Web VCR ${plan.mode} smoke exited with code ${String(result.code)}.\n${result.output}`);
	}
	const lines = result.output.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
	if (lines.length !== 1) {
		throw new Error(`Packaged Web VCR ${plan.mode} smoke emitted ${String(lines.length)} result lines.\n${result.output}`);
	}
	let payload;
	try { payload = JSON.parse(lines[0].slice(prefix.length)); } catch (error) {
		throw new Error(`Packaged Web VCR ${plan.mode} smoke emitted invalid JSON.`, { cause: error });
	}
	return payload;
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
		try { await access(candidate); return candidate; } catch { /* Try the next packaging convention. */ }
	}
	throw new Error(`No packaged ${process.platform}/${TARGET_ARCH} Framescaper executable was found.`);
}

async function recursiveFiles(root) {
	try { return await readdir(root, { recursive: true }); } catch (error) {
		if (error?.code === 'ENOENT') return [];
		throw error;
	}
}

function run(command, args, timeoutMs, label) {
	return new Promise((resolvePromise, reject) => {
		const env = { ...process.env };
		delete env.ELECTRON_RUN_AS_NODE;
		const child = spawn(command, args, {
			cwd: ROOT,
			env,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		let settled = false;
		const finish = (operation) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			operation();
		};
		const append = (chunk) => {
			output += String(chunk);
			if (output.length > 2 * 1024 * 1024) {
				child.kill();
				finish(() => reject(new Error(`Packaged Web VCR ${label} smoke produced too much output.`)));
			}
		};
		child.stdout.on('data', append);
		child.stderr.on('data', append);
		child.once('error', (error) => finish(() => reject(error)));
		const timeout = setTimeout(() => {
			child.kill();
			finish(() => reject(new Error(`Packaged Web VCR ${label} smoke timed out.\n${output}`)));
		}, timeoutMs);
		child.once('exit', (code) => finish(() => resolvePromise({ code, output })));
	});
}
