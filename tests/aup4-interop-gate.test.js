import assert from 'node:assert/strict';
import { copyFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
	auditAup4FixtureInterop,
	aup4InteropAuditExitCode,
	aup4InteropOptionsFromArgs,
	readAup4InteropGateStatus,
} from '../scripts/audit-aup4-interop.mjs';

test('AUP4 fixture-codec audit is deterministic and does not claim compiled native execution', async () => {
	const report = await auditAup4FixtureInterop({ nativeRunner: false });
	assert.equal(report.audacityCommit, '908ad0a526e5bfdab68de780e893cebe172d27eb');
	assert.deepEqual(report.fixtureCodecInterop.browserSnapshot, {
		sha256: 'cbc92d61663f82ce9be11b97c0ac09dfe4c704620eb35a65dfeaf29374ef6b24',
		byteLength: 253_952,
	});
	assert.deepEqual(report.fixtureCodecInterop.project, {
		sampleRate: 44_100,
		audioTrackCount: 2,
		clipCount: 5,
		sourceCount: 5,
		groupIds: ['aup4-group-0', 'aup4-group-1', null],
		stretchToTempoClipCount: 5,
		channelSha256: Array(5).fill('9379743d5c98d7a075ee3814f97b4b67737087b097de33a2b2cdd6c8539d3264'),
	});
	assert.equal(report.fixtureCodecInterop.compiledNativeCodeExecuted, false);
	assert.equal(report.compiledNativeLoaderInterop.status, 'pending');
	assert.equal(report.compiledNativeLoaderInterop.compiledNativeCodeExecuted, false);
	assert.equal(report.compiledNativeLoaderInterop.availableEvidence, null);
	assert.equal(report.nativeLoaderReleaseGatePassed, false);
});

test('AUP4 release enforcement fails closed while the compiled pinned-native loader gate is pending', async () => {
	const status = await readAup4InteropGateStatus();
	assert.equal(status.compiledNativeLoaderInterop.requiredForV2Release, true);
	assert.equal(status.compiledNativeLoaderInterop.status, 'pending');
	assert.equal(status.compiledNativeLoaderInterop.runnerProtocol.version, 1);
	assert.equal(status.compiledNativeLoaderInterop.requiredEvidence.length, 6);

	const report = await auditAup4FixtureInterop({ requireNative: true, nativeRunner: false });
	assert.equal(report.fixtureCodecInterop.status, 'passed');
	assert.equal(report.nativeLoaderReleaseGatePassed, false);
	assert.equal(report.enforcementFailure, 'COMPILED_NATIVE_LOADER_GATE_PENDING');
	assert.equal(aup4InteropAuditExitCode(report, { requireNative: true }), 2);
	assert.equal(aup4InteropAuditExitCode(report), 0);
});

test('AUP4 native-runner options accept CLI and environment configuration with CLI precedence', () => {
	assert.deepEqual(aup4InteropOptionsFromArgs(
		['--require-native', '--native-runner', '/cli/runner'],
		{ AUDACITY_AUP4_NATIVE_RUNNER: '/environment/runner' },
	), {
		requireNative: true,
		nativeRunner: '/cli/runner',
	});
	assert.deepEqual(aup4InteropOptionsFromArgs(
		[],
		{ AUDACITY_AUP4_NATIVE_RUNNER: '/environment/runner' },
	), {
		requireNative: false,
		nativeRunner: '/environment/runner',
	});
	assert.throws(
		() => aup4InteropOptionsFromArgs(['--native-runner'], {}),
		/--native-runner requires an executable path/,
	);
});

test('AUP4 native-runner protocol test double exercises both directions without claiming native execution', async () => {
	const nativeRunner = fileURLToPath(new URL('./fixtures/aup4-native-runner-test-double.mjs', import.meta.url));
	const report = await auditAup4FixtureInterop({
		nativeRunner,
		allowTestRunner: true,
		// Keep the protocol test deterministic in restricted test sandboxes.
		// The inspected artifact remains non-native, so this path cannot pass the release gate.
		testRunnerExecutor: async ([command, inputPath, outputPath]) => {
			if (command === '--revision') {
				return { stdout: '908ad0a526e5bfdab68de780e893cebe172d27eb\n' };
			}
			assert.equal(command, '--roundtrip');
			await copyFile(inputPath, outputPath);
			return { stdout: '' };
		},
		requireNative: true,
	});
	assert.equal(report.compiledNativeLoaderInterop.status, 'test-double');
	assert.equal(report.compiledNativeLoaderInterop.compiledNativeCodeExecuted, false);
	assert.equal(report.compiledNativeLoaderInterop.availableEvidence.testOnly, true);
	assert.equal(report.compiledNativeLoaderInterop.availableEvidence.revision, report.audacityCommit);
	assert.deepEqual(
		report.compiledNativeLoaderInterop.availableEvidence.directions.map((direction) => direction.id),
		[
			'audacity-fixture-browser-rewrite-native-save-browser-reopen',
			'soundscaper-fixture-native-save-browser-reopen',
		],
	);
	assert.ok(report.compiledNativeLoaderInterop.availableEvidence.runner.sha256);
	assert.equal(report.nativeLoaderReleaseGatePassed, false);
	assert.equal(report.enforcementFailure, 'COMPILED_NATIVE_LOADER_GATE_PENDING');
	assert.equal(aup4InteropAuditExitCode(report, { requireNative: true }), 2);
});
