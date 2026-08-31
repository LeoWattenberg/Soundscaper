#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	HOSTED_CI_ENVIRONMENT_ID,
	createCiDiagnosticsReport,
	hostedCiDiagnosticSpecs,
} from './lib/ci-diagnostics.mjs';

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG_PATH = resolve(REPOSITORY_ROOT, 'config/quality-budgets.json');
const DEFAULT_OUTPUT_DIRECTORY = 'test-results/ci-diagnostics';

const COLLECTION_VARIABLES = Object.freeze({
	AUDIO_EDITOR_FFMPEG_BROWSER: '1',
	SOUNDSCAPER_M1_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M3_LONGFORM_BENCHMARK: '1',
	SOUNDSCAPER_M3_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M4B2_KEYFRAME_PARITY: '1',
	SOUNDSCAPER_M4_OBSERVED_ENVIRONMENT_ID: HOSTED_CI_ENVIRONMENT_ID,
	SOUNDSCAPER_M4_PRODUCTION_PARITY: '1',
	SOUNDSCAPER_VIDEO_PREVIEW_BENCHMARK: '1',
});

export async function collectCiDiagnostics(options, dependencies = {}) {
	const { outputDirectory, allowLocal } = options;
	if (typeof outputDirectory !== 'string' || !outputDirectory) {
		throw new TypeError('Hosted CI diagnostics output directory must be non-empty.');
	}
	const processEnvironment = dependencies.processEnvironment ?? process.env;
	if (!allowLocal && processEnvironment.GITHUB_ACTIONS !== 'true') {
		throw new Error('Hosted CI diagnostics run on a GitHub runner; pass --allow-local to rehearse them.');
	}
	const runRoot = resolve(REPOSITORY_ROOT, outputDirectory);
	await mkdir(dirname(runRoot), { recursive: true });
	await mkdir(runRoot, { recursive: false });
	const collectors = dependencies.collectors;
	const runPlaywright = dependencies.runPlaywright ?? ((environment) => runDiagnosticSpecs(
		environment, hostedCiDiagnosticSpecs(collectors),
	));
	const { consoleOutput, exit } = await runPlaywright(processEnvironment);
	await mkdir(runRoot, { recursive: true });
	const config = dependencies.config ?? JSON.parse(await readFile(CONFIG_PATH, 'utf8'));
	const result = createCiDiagnosticsReport({
		consoleOutput,
		config,
		sourceRevision: resolveSourceRevision(processEnvironment),
		playwrightExit: exit,
	}, collectors === undefined ? {} : { collectors });
	await Promise.all([
		writeFile(resolve(runRoot, 'console.log'), consoleOutput, { flag: 'wx' }),
		writeFile(resolve(runRoot, 'raw.json'), `${JSON.stringify(result.raw, null, '\t')}\n`, { flag: 'wx' }),
		writeFile(resolve(runRoot, 'report.json'), `${JSON.stringify(result.report, null, '\t')}\n`, { flag: 'wx' }),
	]);
	return Object.freeze({ ...result, runRoot });
}

export function parseCiDiagnosticsCliOptions(argv) {
	if (!Array.isArray(argv) || argv.some((value) => typeof value !== 'string')) {
		throw new TypeError('Hosted CI diagnostics arguments must be strings.');
	}
	let outputDirectory = null;
	let allowLocal = false;
	for (const argument of argv) {
		if (argument === '--allow-local') {
			if (allowLocal) throw new Error('Repeated --allow-local option.');
			allowLocal = true;
			continue;
		}
		if (argument.startsWith('-')) throw new Error(`Unknown hosted CI diagnostics option ${argument}.`);
		if (outputDirectory !== null) throw new Error('Hosted CI diagnostics accept one output directory.');
		outputDirectory = argument;
	}
	return Object.freeze({
		outputDirectory: outputDirectory ?? DEFAULT_OUTPUT_DIRECTORY,
		allowLocal,
	});
}

async function runDiagnosticSpecs(processEnvironment, specs) {
	const transcripts = [];
	let exit = { code: 0, signal: null };
	for (const spec of specs) {
		const run = await runDiagnosticSpec(spec, processEnvironment);
		transcripts.push(`=== ${spec} ===\n${run.consoleOutput}`);
		if (exit.code === 0 && exit.signal === null) exit = run.exit;
	}
	return { consoleOutput: transcripts.join('\n'), exit };
}

async function runDiagnosticSpec(spec, processEnvironment) {
	const args = ['run', 'test:browser:built', '--', spec, '--project=chromium', '--workers=1', '--retries=0'];
	try {
		const { stdout, stderr } = await execFileAsync('npm', args, {
			cwd: REPOSITORY_ROOT,
			encoding: 'utf8',
			maxBuffer: 256 * 1024 * 1024,
			env: { ...processEnvironment, ...COLLECTION_VARIABLES },
		});
		return { consoleOutput: `${stdout}\n${stderr}`, exit: { code: 0, signal: null } };
	} catch (error) {
		return {
			consoleOutput: `${error.stdout ?? ''}\n${error.stderr ?? ''}`,
			exit: { code: typeof error.code === 'number' ? error.code : 1, signal: error.signal ?? null },
		};
	}
}

function resolveSourceRevision(environment) {
	const revision = environment.GITHUB_SHA;
	return typeof revision === 'string' && /^[a-f\d]{40}$/u.test(revision) ? revision : null;
}

function isMainModule() {
	return process.argv[1] !== undefined
		&& pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
}

if (isMainModule()) {
	collectCiDiagnostics(parseCiDiagnosticsCliOptions(process.argv.slice(2)))
		.then((result) => {
			for (const workload of result.report.workloads) {
				console.log(`${workload.diagnosticKey} (${workload.gate}): ${workload.status}`);
			}
			for (const skipped of result.report.notAttempted) {
				console.log(`not attempted: ${skipped.diagnosticKey}: ${skipped.reason}`);
			}
			for (const warning of result.report.warnings) console.warn(`warning: ${warning}`);
			for (const failure of result.report.failures) console.error(`failure: ${failure}`);
			console.log(`Hosted CI diagnostics written to ${result.runRoot}`);
			process.exitCode = result.passed ? 0 : 1;
		})
		.catch((error) => {
			console.error(`Hosted CI diagnostics failed: ${error.message}`);
			process.exitCode = 1;
		});
}
