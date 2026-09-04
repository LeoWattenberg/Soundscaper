#!/usr/bin/env node
/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

import { encodeAudacityBinaryXml } from '../src/common/editor/audacity-binary-xml.js';
import {
	initializeAup4Database,
	insertAup4SampleBlock,
	prepareAup4SerializedDatabase,
	readAup4SampleBlock,
	validateAup4Database,
	writeAup4Document,
} from '../src/common/editor/aup4-database.js';
import { decodeAup4ProjectTree } from '../src/common/editor/aup4-conversion.js';
import {
	createAup4ProjectTree,
	createAup4SampleBlock,
	decodeAup4Float32Samples,
} from '../src/common/editor/aup4-profile.js';
import {
	AUP4_NATIVE_RICH_SHA256,
	aup4NativeRichFixture,
} from '../tests/fixtures/aup4-native-rich.js';
import { auditCompiledNativeRunner, resolveConfiguredNativeRunner } from './lib/aup4-interop-native-runner.mjs';
import { portableClipState } from './lib/aup4-interop-snapshot.mjs';
import {
	assertGateStatus,
	channelHash,
	loadSqlJs,
	readGateStatus,
	sha256,
} from './lib/aup4-interop-values.mjs';

const NATIVE_RUNNER_ENVIRONMENT_VARIABLE = 'AUDACITY_AUP4_NATIVE_RUNNER';


/**
 * Exercise the browser AUP4 codec against a project created by the pinned
 * Audacity source tree. When an optional compiled-native runner is supplied,
 * execute and independently inspect both native load/write directions too.
 */
export async function auditAup4FixtureInterop(options = {}) {
	const gateStatus = await readGateStatus();
	assertGateStatus(gateStatus);
	const SQL = await loadSqlJs();
	const fixtureBytes = aup4NativeRichFixture();
	const fixtureSha256 = sha256(fixtureBytes);
	assert.equal(fixtureSha256, AUP4_NATIVE_RICH_SHA256);
	assert.equal(fixtureSha256, gateStatus.fixtureCodecInterop.fixtureSha256);

	const nativeFixtureDatabase = new SQL.Database(prepareAup4SerializedDatabase(fixtureBytes));
	let decodedFixture;
	let nativeBlock;
	let fixtureReport;
	try {
		fixtureReport = validateAup4Database(nativeFixtureDatabase);
		assert.equal(fixtureReport.compatible, true);
		assert.equal(fixtureReport.readOnly, false);
		assert.equal(fixtureReport.summary.audioTrackCount, 2);
		assert.equal(fixtureReport.references.distinctSampleBlockCount, 1);
		nativeBlock = readAup4SampleBlock(nativeFixtureDatabase, 1);
		assert.ok(nativeBlock);
		const regenerated = createAup4SampleBlock(decodeAup4Float32Samples(nativeBlock.samples));
		for (const field of ['samples', 'summary256', 'summary64k']) {
			assert.deepEqual(regenerated[field], nativeBlock[field]);
		}
		let nextId = 0;
		decodedFixture = await decodeAup4ProjectTree(
			fixtureReport.document.root,
			async (blockId) => readAup4SampleBlock(nativeFixtureDatabase, blockId),
			{
				projectId: 'native-rich',
				title: 'testClipboard.aup4',
				idFactory: (prefix) => `${prefix}-${++nextId}`,
			},
		);
	} finally {
		nativeFixtureDatabase.close();
	}

	const firstClipState = decodedFixture.project.clips.map(portableClipState);
	const firstChannelHashes = decodedFixture.sources.flatMap((source) => source.channels.map(channelHash));
	assert.equal(decodedFixture.project.tracks.filter((track) => track.type === 'audio').length, 2);
	assert.equal(decodedFixture.project.clips.length, 5);
	assert.ok(decodedFixture.project.clips.every((clip) => clip.stretchToTempo));

	const browserDatabase = new SQL.Database();
	let browserSnapshot;
	let browserReport;
	let secondDecoded;
	let rewrittenBlock;
	try {
		initializeAup4Database(browserDatabase);
		const channelBlocks = new Map();
		const sampleBlockIds = new Map();
		for (const source of decodedFixture.sources) {
			for (let channel = 0; channel < source.channels.length; channel += 1) {
				const samples = source.channels[channel];
				const block = createAup4SampleBlock(samples);
				const sampleHash = sha256(block.samples);
				let blockId = sampleBlockIds.get(sampleHash);
				if (blockId == null) {
					blockId = insertAup4SampleBlock(browserDatabase, block);
					sampleBlockIds.set(sampleHash, blockId);
				}
				channelBlocks.set(`${source.sourceId}:${channel}`, [{
					blockId,
					start: 0,
					sampleCount: samples.length,
				}]);
			}
		}
		writeAup4Document(
			browserDatabase,
			encodeAudacityBinaryXml(createAup4ProjectTree(decodedFixture.project, channelBlocks)),
			{ autosave: false, now: 0 },
		);
		browserSnapshot = browserDatabase.export();
	} finally {
		browserDatabase.close();
	}

	const reopenedBrowserDatabase = new SQL.Database(browserSnapshot);
	try {
		browserReport = validateAup4Database(reopenedBrowserDatabase);
		assert.equal(browserReport.compatible, true);
		assert.equal(browserReport.readOnly, false);
		assert.equal(browserReport.summary.audioTrackCount, 2);
		assert.equal(browserReport.references.distinctSampleBlockCount, 1);
		let nextId = 0;
		secondDecoded = await decodeAup4ProjectTree(
			browserReport.document.root,
			async (blockId) => readAup4SampleBlock(reopenedBrowserDatabase, blockId),
			{
				projectId: 'browser-reopened',
				idFactory: (prefix) => `${prefix}-${++nextId}`,
			},
		);
		rewrittenBlock = readAup4SampleBlock(reopenedBrowserDatabase, 1);
		assert.deepEqual(secondDecoded.project.clips.map(portableClipState), firstClipState);
		assert.deepEqual(
			secondDecoded.sources.flatMap((source) => source.channels.map(channelHash)),
			firstChannelHashes,
		);
		for (const field of ['samples', 'summary256', 'summary64k']) {
			assert.deepEqual(rewrittenBlock[field], nativeBlock[field]);
		}
	} finally {
		reopenedBrowserDatabase.close();
	}

	const browserSnapshotSha256 = sha256(browserSnapshot);
	const sampleBlockReport = {
		samplesSha256: sha256(rewrittenBlock.samples),
		summary256Sha256: sha256(rewrittenBlock.summary256),
		summary64kSha256: sha256(rewrittenBlock.summary64k),
	};
	assert.equal(browserSnapshotSha256, gateStatus.fixtureCodecInterop.expectedBrowserSnapshotSha256);
	assert.equal(browserSnapshot.byteLength, gateStatus.fixtureCodecInterop.expectedBrowserSnapshotByteLength);
	assert.deepEqual(sampleBlockReport, gateStatus.fixtureCodecInterop.expectedSampleBlock);

	const configuredRunner = resolveConfiguredNativeRunner(options);
	const nativeAudit = configuredRunner
		? await auditCompiledNativeRunner({
			SQL,
			runnerPath: configuredRunner,
			audacityCommit: gateStatus.audacityCommit,
			browserSnapshot,
			allowTestRunner: options.allowTestRunner === true,
			testRunnerInterpreter: options.testRunnerInterpreter,
			testRunnerExecutor: options.testRunnerExecutor,
		})
		: null;
	const nativeLoaderGatePassed = nativeAudit?.compiledNativeCodeExecuted === true;
	const compiledGate = gateStatus.compiledNativeLoaderInterop;
	const report = {
		schemaVersion: gateStatus.schemaVersion,
		audacityCommit: gateStatus.audacityCommit,
		fixtureCodecInterop: {
			status: 'passed',
			compiledNativeCodeExecuted: false,
			pipeline: [...gateStatus.fixtureCodecInterop.pipeline],
			fixture: {
				path: gateStatus.fixtureCodecInterop.fixturePath,
				sha256: fixtureSha256,
			},
			browserSnapshot: {
				sha256: browserSnapshotSha256,
				byteLength: browserSnapshot.byteLength,
			},
			project: {
				sampleRate: fixtureReport.summary.sampleRate,
				audioTrackCount: fixtureReport.summary.audioTrackCount,
				clipCount: decodedFixture.project.clips.length,
				sourceCount: decodedFixture.sources.length,
				groupIds: [...new Set(decodedFixture.project.clips.map((clip) => clip.groupId))],
				stretchToTempoClipCount: decodedFixture.project.clips.filter((clip) => clip.stretchToTempo).length,
				channelSha256: firstChannelHashes,
			},
			sampleBlock: sampleBlockReport,
		},
		compiledNativeLoaderInterop: nativeAudit ? {
			status: nativeAudit.compiledNativeCodeExecuted ? 'passed' : 'test-double',
			requiredForV2Release: compiledGate.requiredForV2Release,
			compiledNativeCodeExecuted: nativeAudit.compiledNativeCodeExecuted,
			availableEvidence: nativeAudit.evidence,
			blockedReason: nativeAudit.compiledNativeCodeExecuted
				? null
				: 'The configured runner was an explicitly allowed test double, not a compiled native executable.',
		} : {
			status: compiledGate.status,
			requiredForV2Release: compiledGate.requiredForV2Release,
			compiledNativeCodeExecuted: false,
			availableEvidence: null,
			blockedReason: compiledGate.blockedReason,
		},
		nativeLoaderReleaseGatePassed: nativeLoaderGatePassed,
	};
	if (options.requireNative && !nativeLoaderGatePassed) report.enforcementFailure = 'COMPILED_NATIVE_LOADER_GATE_PENDING';
	return report;
}

export async function readAup4InteropGateStatus() {
	return readGateStatus();
}

export function aup4InteropAuditExitCode(report, options = {}) {
	return options.requireNative && !report?.nativeLoaderReleaseGatePassed ? 2 : 0;
}

export function aup4InteropOptionsFromArgs(argv = process.argv.slice(2), environment = process.env) {
	let nativeRunner;
	for (let index = 0; index < argv.length; index += 1) {
		const argument = String(argv[index]);
		if (argument.startsWith('--native-runner=')) {
			nativeRunner = argument.slice('--native-runner='.length);
			continue;
		}
		if (argument !== '--native-runner') continue;
		const value = argv[index + 1];
		if (!value || String(value).startsWith('--')) {
			throw new TypeError('--native-runner requires an executable path.');
		}
		nativeRunner = String(value);
		index += 1;
	}
	if (nativeRunner === '') throw new TypeError('--native-runner requires an executable path.');
	return {
		requireNative: argv.includes('--require-native'),
		nativeRunner: nativeRunner || environment?.[NATIVE_RUNNER_ENVIRONMENT_VARIABLE] || null,
	};
}

function isMainModule() {
	if (!process.argv[1]) return false;
	return pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isMainModule()) {
	try {
		const options = aup4InteropOptionsFromArgs();
		const report = await auditAup4FixtureInterop(options);
		process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
		process.exitCode = aup4InteropAuditExitCode(report, options);
	} catch (error) {
		process.stderr.write(`${error?.stack || error}\n`);
		process.exitCode = 1;
	}
}
