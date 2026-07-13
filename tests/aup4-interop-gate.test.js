import assert from 'node:assert/strict';
import test from 'node:test';

import {
	auditAup4FixtureInterop,
	aup4InteropAuditExitCode,
	readAup4InteropGateStatus,
} from '../scripts/audit-aup4-interop.mjs';

test('AUP4 fixture-codec audit is deterministic and does not claim compiled native execution', async () => {
	const report = await auditAup4FixtureInterop();
	assert.equal(report.audacityCommit, '908ad0a526e5bfdab68de780e893cebe172d27eb');
	assert.deepEqual(report.fixtureCodecInterop.browserSnapshot, {
		sha256: '6f1129a79fb9f0b9d99ea1ca323c2b014f035ea7e003dddc395bf78a8aad5b0c',
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
	assert.equal(status.compiledNativeLoaderInterop.requiredEvidence.length, 4);

	const report = await auditAup4FixtureInterop({ requireNative: true });
	assert.equal(report.fixtureCodecInterop.status, 'passed');
	assert.equal(report.nativeLoaderReleaseGatePassed, false);
	assert.equal(report.enforcementFailure, 'COMPILED_NATIVE_LOADER_GATE_PENDING');
	assert.equal(aup4InteropAuditExitCode(report, { requireNative: true }), 2);
	assert.equal(aup4InteropAuditExitCode(report), 0);
});
