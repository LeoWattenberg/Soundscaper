/* SPDX-License-Identifier: AGPL-3.0-only */

// Driving an optional compiled Audacity runner and inspecting what it produced.
// The runner is an external executable, so it is identified and version-checked
// before use, run under a timeout, and its output read back under a byte cap and
// proved checkpointed with no pending write-ahead log before anything is read
// from it. Split out of audit-aup4-interop.mjs; no behaviour changes here.

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
	createSoundscaperNativeGateSnapshot,
	inspectPortableSnapshot,
	portableSnapshotEvidence,
} from './aup4-interop-snapshot.mjs';
import {
	NATIVE_RUNNER_PROTOCOL_VERSION,
	sha256,
	sha256File,
} from './aup4-interop-values.mjs';

const NATIVE_RUNNER_ENVIRONMENT_VARIABLE = 'AUDACITY_AUP4_NATIVE_RUNNER';
const NATIVE_RUNNER_TIMEOUT_MS = 120_000;
const NATIVE_RUNNER_REVISION_TIMEOUT_MS = 10_000;
const NATIVE_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const execFileAsync = promisify(execFile);

export async function auditCompiledNativeRunner({
	SQL,
	runnerPath,
	audacityCommit,
	browserSnapshot,
	allowTestRunner,
	testRunnerInterpreter,
	testRunnerExecutor,
}) {
	const runner = await inspectNativeRunnerArtifact(runnerPath, {
		allowTestRunner,
		testRunnerInterpreter,
		testRunnerExecutor,
	});
	const revisionOutput = await queryNativeRunnerRevision(runner);
	assert.match(
		revisionOutput,
		new RegExp(`^${audacityCommit}[\\t\\n\\r ]*$`),
		`The AUP4 native runner revision must be exactly ${audacityCommit} followed only by optional trailing whitespace.`,
	);
	const revision = audacityCommit;
	const soundscaperSnapshot = createSoundscaperNativeGateSnapshot(SQL);
	const directions = [{
		id: 'audacity-fixture-browser-rewrite-native-save-browser-reopen',
		inputBytes: browserSnapshot,
	}, {
		id: 'soundscaper-fixture-native-save-browser-reopen',
		inputBytes: soundscaperSnapshot,
	}];
	const temporaryDirectory = await mkdtemp(join(tmpdir(), 'soundscaper-aup4-native-'));
	const evidenceDirections = [];
	try {
		for (const [index, direction] of directions.entries()) {
			const inputPath = join(temporaryDirectory, `direction-${index + 1}-input.aup4`);
			const outputPath = join(temporaryDirectory, `direction-${index + 1}-output.aup4`);
			const expected = await inspectPortableSnapshot(SQL, direction.inputBytes);
			await writeFile(inputPath, direction.inputBytes, { flag: 'wx' });
			await executeNativeRoundTrip(runner, inputPath, outputPath);
			assert.equal(sha256(await readFile(inputPath)), sha256(direction.inputBytes), 'The native runner modified its input file.');
			await assertNoPendingWal(inputPath, 'input');
			await assertCheckpointedOutput(outputPath);
			const outputBytes = await readBoundedNativeOutput(outputPath);
			const actual = await inspectPortableSnapshot(SQL, outputBytes);
			assert.deepEqual(
				actual.projectState,
				expected.projectState,
				`Native AUP4 semantics changed in ${direction.id}.`,
			);
			evidenceDirections.push({
				id: direction.id,
				input: portableSnapshotEvidence(direction.inputBytes, expected),
				output: portableSnapshotEvidence(outputBytes, actual),
			});
		}
	} finally {
		await rm(temporaryDirectory, { force: true, recursive: true });
	}
	const compiledNativeCodeExecuted = runner.nativeExecutable;
	return {
		compiledNativeCodeExecuted,
		evidence: {
			schemaVersion: 1,
			protocolVersion: NATIVE_RUNNER_PROTOCOL_VERSION,
			testOnly: !compiledNativeCodeExecuted,
			runner: {
				fileName: basename(runner.path),
				sha256: runner.sha256,
				byteLength: runner.byteLength,
				executableFormat: runner.executableFormat,
			},
			revision,
			directions: evidenceDirections,
		},
	};
}

export async function inspectNativeRunnerArtifact(value, options = {}) {
	const path = resolve(String(value));
	const info = await stat(path);
	assert.ok(info.isFile(), 'The AUP4 native runner must be a file.');
	const handle = await open(path, 'r');
	const header = Buffer.alloc(8);
	try {
		await handle.read(header, 0, header.length, 0);
	} finally {
		await handle.close();
	}
	const executableFormat = nativeExecutableFormat(header);
	const nativeExecutable = executableFormat !== null;
	if (!nativeExecutable && options.allowTestRunner !== true) {
		throw new TypeError('The AUP4 native runner must be a direct ELF, PE, Mach-O, or universal Mach-O executable.');
	}
	const testRunnerInterpreter = !nativeExecutable && options.testRunnerInterpreter
		? resolve(String(options.testRunnerInterpreter))
		: null;
	return {
		path,
		command: testRunnerInterpreter || path,
		argumentPrefix: testRunnerInterpreter ? [path] : [],
		testRunnerExecutor: options.testRunnerExecutor,
		byteLength: info.size,
		sha256: await sha256File(path),
		executableFormat: executableFormat || 'non-native-test-double',
		nativeExecutable,
	};
}

export function nativeExecutableFormat(header) {
	if (header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF') return 'elf';
	if (header[0] === 0x4d && header[1] === 0x5a) return 'pe';
	const magic = header.readUInt32BE(0);
	if (new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]).has(magic)) return 'mach-o';
	if (new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]).has(magic)) return 'universal-mach-o';
	return null;
}

export async function queryNativeRunnerRevision(runner) {
	if (runner.testRunnerExecutor) {
		const result = await runner.testRunnerExecutor(['--revision']);
		return String(result?.stdout || '');
	}
	const { stdout } = await execFileAsync(runner.command, [...runner.argumentPrefix, '--revision'], {
		encoding: 'utf8',
		maxBuffer: 64 * 1024,
		timeout: NATIVE_RUNNER_REVISION_TIMEOUT_MS,
		windowsHide: true,
	});
	return stdout;
}

export async function executeNativeRoundTrip(runner, inputPath, outputPath) {
	if (runner.testRunnerExecutor) {
		await runner.testRunnerExecutor(['--roundtrip', inputPath, outputPath]);
		return;
	}
	await execFileAsync(runner.command, [...runner.argumentPrefix, '--roundtrip', inputPath, outputPath], {
		encoding: 'utf8',
		maxBuffer: 1024 * 1024,
		timeout: NATIVE_RUNNER_TIMEOUT_MS,
		windowsHide: true,
	});
}

export async function assertCheckpointedOutput(outputPath) {
	const outputInfo = await stat(outputPath);
	assert.ok(outputInfo.isFile() && outputInfo.size > 0, 'The AUP4 native runner did not create an output project.');
	assert.ok(outputInfo.size <= NATIVE_OUTPUT_LIMIT_BYTES, 'The AUP4 native runner output exceeds the audit limit.');
	await assertNoPendingWal(outputPath, 'output');
}

export async function assertNoPendingWal(projectPath, role) {
	const walInfo = await statIfExists(`${projectPath}-wal`);
	assert.ok(!walInfo || walInfo.size === 0, `The AUP4 native runner left an uncheckpointed ${role} WAL.`);
}

export async function readBoundedNativeOutput(outputPath) {
	const info = await stat(outputPath);
	assert.ok(info.size <= NATIVE_OUTPUT_LIMIT_BYTES, 'The AUP4 native runner output exceeds the audit limit.');
	return new Uint8Array(await readFile(outputPath));
}

export async function statIfExists(path) {
	try {
		return await stat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

export function resolveConfiguredNativeRunner(options) {
	if (options.nativeRunner === false) return null;
	const configured = options.nativeRunner || process.env[NATIVE_RUNNER_ENVIRONMENT_VARIABLE];
	return configured ? String(configured) : null;
}

