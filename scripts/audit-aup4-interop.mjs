import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
	mkdtemp,
	open,
	readFile,
	rm,
	stat,
	writeFile,
} from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import initSqlJs from 'sql.js';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
	encodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
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
	AUP4_SAMPLE_FORMAT_FLOAT32,
	createAup4ProjectTree,
	createAup4SampleBlock,
	decodeAup4Float32Samples,
} from '../src/common/editor/aup4-profile.js';
import {
	AUP4_NATIVE_RICH_SHA256,
	aup4NativeRichFixture,
} from '../tests/fixtures/aup4-native-rich.js';

const GATE_STATUS_URL = new URL('../tests/fixtures/aup4-interop-gate.json', import.meta.url);
const NATIVE_RUNNER_ENVIRONMENT_VARIABLE = 'AUDACITY_AUP4_NATIVE_RUNNER';
const NATIVE_RUNNER_PROTOCOL_VERSION = 1;
const NATIVE_RUNNER_TIMEOUT_MS = 120_000;
const NATIVE_RUNNER_REVISION_TIMEOUT_MS = 10_000;
const NATIVE_OUTPUT_LIMIT_BYTES = 64 * 1024 * 1024;
const UTF8 = new TextEncoder();
const execFileAsync = promisify(execFile);
let sqlPromise;

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

async function auditCompiledNativeRunner({
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

function createSoundscaperNativeGateSnapshot(SQL) {
	const database = new SQL.Database();
	try {
		initializeAup4Database(database);
		const left = Float32Array.of(
			0, 0.125, -0.25, 0.5, -0.75, 1, -0.5, 0.25,
			0.0625, -0.125, 0.375, -0.625, 0.875, -1, 0.5, 0,
		);
		const right = Float32Array.of(
			0.5, -0.375, 0.25, -0.125, 0, 0.125, -0.25, 0.375,
			-0.5, 0.625, -0.75, 0.875, -1, 0.75, -0.5, 0.25,
		);
		const leftBlockId = insertAup4SampleBlock(database, createAup4SampleBlock(left));
		const rightBlockId = insertAup4SampleBlock(database, createAup4SampleBlock(right));
		const missingNativeId = 'Effect_VST3_Acme_SuperVerb_/plugins/SuperVerb.vst3';
		const missingOpaqueNode = createAudacityXmlNode('effect', [
			{ kind: 'attribute', name: 'active', type: 'bool', value: true },
			{ kind: 'attribute', name: 'id', type: 'string', value: missingNativeId },
		], [{
			kind: 'node',
			node: createAudacityXmlNode('parameters', [], [{
				kind: 'node',
				node: createAudacityXmlNode('parameter', [
					{ kind: 'attribute', name: 'name', type: 'string', value: 'FutureKnob' },
					{ kind: 'attribute', name: 'value', type: 'string', value: '0.625' },
				]),
			}]),
		}]);
		const project = {
			schemaVersion: 2,
			id: 'soundscaper-native-gate',
			title: 'Soundscaper native gate',
			sampleRate: 48_000,
			masterChannels: 2,
			tempo: { bpm: 137, timeSignature: { numerator: 7, denominator: 8 } },
			snap: { enabled: true, type: 4, triplets: true },
			timeDisplay: { format: 'bar:beat' },
			metadata: {
				title: 'Soundscaper native gate',
				artist: 'Soundscaper audit',
				comments: 'Pinned executable interchange fixture',
			},
			selection: {
				startFrame: 2_400,
				endFrame: 8_400,
				trackIds: ['sound-track'],
				clipIds: ['sound-clip'],
			},
			view: { zoom: 128, horizontalPosition: 0.05, verticalPosition: 1 },
			sources: [{
				id: 'sound-source',
				name: 'Interchange PCM',
				frameCount: left.length,
				channelCount: 2,
				sampleRate: 48_000,
				originalSampleRate: 48_000,
				sampleFormat: 'float32',
			}],
			clips: [{
				id: 'sound-clip',
				sourceId: 'sound-source',
				title: 'Pitched stereo clip',
				timelineStartFrame: 2_400,
				sourceStartFrame: 2,
				sourceDurationFrames: 12,
				durationFrames: 18,
				envelope: [
					{ frame: 0, value: 0.25 },
					{ frame: 9, value: 1.5 },
					{ frame: 18, value: 0.75 },
				],
				groupId: 'linked-edit',
				pitchCents: 300,
				speedRatio: 2 / 3,
				preserveFormants: true,
				stretchToTempo: true,
			}],
			tracks: [{
				id: 'sound-track',
				type: 'audio',
				name: 'Soundscaper stereo',
				gain: 0.75,
				pan: -0.25,
				mute: false,
				solo: true,
				displayMode: 'multiview',
				spectrogram: {
					minimumFrequency: 40,
					maximumFrequency: 18_000,
					windowSize: 4096,
					gain: 24,
					range: 72,
				},
				effectsActive: false,
				effects: [{
					id: 'echo',
					type: 'audacity-echo',
					enabled: true,
					params: { delaySeconds: 0.375, decay: 0.42 },
				}, {
					id: 'missing-superverb',
					type: 'missing',
					enabled: true,
					bypassed: true,
					params: {},
					missing: {
						name: 'SuperVerb',
						nativeId: missingNativeId,
						reason: 'plugin-unavailable',
						source: 'aup4',
					},
					opaqueAudacityNode: { kind: 'node', node: missingOpaqueNode },
				}],
				clipIds: ['sound-clip'],
			}, {
				id: 'sound-labels',
				type: 'label',
				name: 'Markers',
				labels: [{
					id: 'label-a',
					title: 'Verse',
					startFrame: 2_400,
					endFrame: 4_800,
				}, {
					id: 'label-b',
					title: 'Hit',
					startFrame: 7_200,
					endFrame: 7_200,
				}],
			}],
			master: {
				effectsActive: true,
				effects: [{
					id: 'master-invert',
					type: 'audacity-invert',
					enabled: false,
					params: {},
				}],
			},
		};
		const channelBlocks = new Map([
			['sound-source:0', [{ blockId: leftBlockId, start: 0, sampleCount: left.length }]],
			['sound-source:1', [{ blockId: rightBlockId, start: 0, sampleCount: right.length }]],
		]);
		writeAup4Document(
			database,
			encodeAudacityBinaryXml(createAup4ProjectTree(project, channelBlocks)),
			{ autosave: false, now: 0 },
		);
		return database.export();
	} finally {
		database.close();
	}
}

async function inspectPortableSnapshot(SQL, bytes) {
	const database = new SQL.Database(prepareAup4SerializedDatabase(bytes));
	try {
		const report = validateAup4Database(database, { allowHistoryRecovery: false });
		assert.equal(report.compatible, true);
		assert.equal(report.readOnly, false);
		assert.equal(report.source, 'project', 'A native gate output must have an empty autosave table.');
		assert.equal(String(sqlScalar(database, 'PRAGMA integrity_check')).toLowerCase(), 'ok');
		const autosaveRows = Number(sqlScalar(database, 'SELECT count(*) FROM autosave'));
		const historyRows = Number(sqlScalar(database, 'SELECT count(*) FROM project_history'));
		assert.equal(autosaveRows, 0, 'A native gate output must not retain autosave data.');
		assert.ok(historyRows >= 1, 'A native gate output must contain committed history.');
		const sampleBlocks = validateRegeneratedSampleBlocks(database, report.document.root);
		let nextId = 0;
		const decoded = await decodeAup4ProjectTree(
			report.document.root,
			async (blockId) => readAup4SampleBlock(database, blockId),
			{
				projectId: 'native-gate-reopen',
				title: 'native-gate.aup4',
				idFactory: (prefix) => `${prefix}-${++nextId}`,
			},
		);
		const projectState = portableProjectState(decoded);
		return {
			report: {
				sampleRate: report.summary.sampleRate,
				audioTrackCount: report.summary.audioTrackCount,
				labelTrackCount: report.summary.labelTrackCount,
				referenceCount: report.references.blockReferenceCount,
				distinctSampleBlockCount: report.references.distinctSampleBlockCount,
				autosaveRows,
				historyRows,
				integrity: 'ok',
			},
			projectState,
			projectStateSha256: sha256(UTF8.encode(stableStringify(projectState))),
			sampleBlocks,
			sampleBlocksSha256: sha256(UTF8.encode(stableStringify(sampleBlocks))),
		};
	} finally {
		database.close();
	}
}

function portableSnapshotEvidence(bytes, snapshot) {
	return {
		sha256: sha256(bytes),
		byteLength: bytes.byteLength,
		database: snapshot.report,
		projectStateSha256: snapshot.projectStateSha256,
		sampleBlocksSha256: snapshot.sampleBlocksSha256,
		channelSha256: snapshot.projectState.pcm.flatMap((source) => source.channelSha256),
	};
}

function portableProjectState(decoded) {
	const project = decoded.project;
	const clipIndexById = new Map(project.clips.map((clip, index) => [clip.id, index]));
	const trackNameById = new Map(project.tracks.map((track) => [track.id, track.name]));
	const clipTitleById = new Map(project.clips.map((clip) => [clip.id, clip.title]));
	return canonicalize({
		sampleRate: project.sampleRate,
		tempo: project.tempo,
		snap: project.snap,
		timeDisplay: project.timeDisplay,
		metadata: project.metadata,
		selection: {
			startFrame: project.selection?.startFrame,
			endFrame: project.selection?.endFrame,
			trackNames: (project.selection?.trackIds || []).map((id) => trackNameById.get(id)),
			clipTitles: (project.selection?.clipIds || []).map((id) => clipTitleById.get(id)),
		},
		view: project.view,
		sources: project.sources.map((source) => ({
			name: source.name,
			frameCount: source.frameCount,
			channelCount: source.channelCount,
			sampleRate: source.sampleRate,
			originalSampleRate: source.originalSampleRate,
			sampleFormat: source.sampleFormat,
		})),
		clips: project.clips.map((clip) => ({
			...portableClipState(clip),
			preserveFormants: clip.preserveFormants,
			stretchToTempo: clip.stretchToTempo,
			envelope: clip.envelope,
		})),
		tracks: project.tracks.map((track) => track.type === 'label' ? {
			type: 'label',
			name: track.name,
			labels: track.labels.map((label) => ({
				title: label.title,
				startFrame: label.startFrame,
				endFrame: label.endFrame,
			})),
		} : {
			type: 'audio',
			name: track.name,
			gain: track.gain,
			pan: track.pan,
			mute: track.mute,
			solo: track.solo,
			displayMode: track.displayMode,
			spectrogram: track.spectrogram,
			effectsActive: track.effectsActive,
			effects: track.effects.map(portableEffectState),
			clipIndexes: track.clipIds.map((id) => clipIndexById.get(id)),
		}),
		master: {
			effectsActive: project.master?.effectsActive,
			effects: (project.master?.effects || []).map(portableEffectState),
		},
		pcm: decoded.sources.map((source) => ({
			sampleRate: source.sampleRate,
			channelSha256: source.channels.map(channelHash),
		})),
	});
}

function portableEffectState(effect) {
	return {
		type: effect.type,
		enabled: effect.enabled !== false,
		params: effect.params || {},
		...(effect.type === 'missing' ? {
			missing: effect.missing,
			opaqueAudacityNodeSha256: sha256(UTF8.encode(stableStringify(effect.opaqueAudacityNode))),
		} : {}),
	};
}

function validateRegeneratedSampleBlocks(database, root) {
	const blockIds = new Set();
	const silentSampleCounts = [];
	const visit = (node) => {
		if (node?.name === 'waveblock') {
			const blockId = Number(audacityXmlAttribute(node, 'blockid', 0));
			if (blockId > 0) blockIds.add(blockId);
			else if (blockId < 0) silentSampleCounts.push(-blockId);
		}
		for (const child of audacityXmlChildren(node)) visit(child);
	};
	visit(root);
	const blocks = [];
	for (const blockId of [...blockIds].sort((left, right) => left - right)) {
		const block = readAup4SampleBlock(database, blockId);
		assert.ok(block, `AUP4 sample block ${blockId} is missing.`);
		assert.equal(block.sampleformat, AUP4_SAMPLE_FORMAT_FLOAT32);
		const regenerated = createAup4SampleBlock(decodeAup4Float32Samples(block.samples));
		for (const field of ['samples', 'summary256', 'summary64k']) {
			assert.deepEqual(regenerated[field], block[field], `AUP4 sample block ${blockId} has a stale ${field}.`);
		}
		assert.equal(regenerated.summin, block.summin);
		assert.equal(regenerated.summax, block.summax);
		assert.ok(Math.abs(regenerated.sumrms - block.sumrms) < 1e-12);
		blocks.push({
			sampleCount: regenerated.sampleCount,
			samplesSha256: sha256(block.samples),
			summary256Sha256: sha256(block.summary256),
			summary64kSha256: sha256(block.summary64k),
		});
	}
	return {
		blocks,
		silentSampleCounts: silentSampleCounts.sort((left, right) => left - right),
	};
}

async function inspectNativeRunnerArtifact(value, options = {}) {
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

function nativeExecutableFormat(header) {
	if (header[0] === 0x7f && header.subarray(1, 4).toString('ascii') === 'ELF') return 'elf';
	if (header[0] === 0x4d && header[1] === 0x5a) return 'pe';
	const magic = header.readUInt32BE(0);
	if (new Set([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe]).has(magic)) return 'mach-o';
	if (new Set([0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca]).has(magic)) return 'universal-mach-o';
	return null;
}

async function queryNativeRunnerRevision(runner) {
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

async function executeNativeRoundTrip(runner, inputPath, outputPath) {
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

async function assertCheckpointedOutput(outputPath) {
	const outputInfo = await stat(outputPath);
	assert.ok(outputInfo.isFile() && outputInfo.size > 0, 'The AUP4 native runner did not create an output project.');
	assert.ok(outputInfo.size <= NATIVE_OUTPUT_LIMIT_BYTES, 'The AUP4 native runner output exceeds the audit limit.');
	await assertNoPendingWal(outputPath, 'output');
}

async function assertNoPendingWal(projectPath, role) {
	const walInfo = await statIfExists(`${projectPath}-wal`);
	assert.ok(!walInfo || walInfo.size === 0, `The AUP4 native runner left an uncheckpointed ${role} WAL.`);
}

async function readBoundedNativeOutput(outputPath) {
	const info = await stat(outputPath);
	assert.ok(info.size <= NATIVE_OUTPUT_LIMIT_BYTES, 'The AUP4 native runner output exceeds the audit limit.');
	return new Uint8Array(await readFile(outputPath));
}

async function statIfExists(path) {
	try {
		return await stat(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return null;
		throw error;
	}
}

function resolveConfiguredNativeRunner(options) {
	if (options.nativeRunner === false) return null;
	const configured = options.nativeRunner || process.env[NATIVE_RUNNER_ENVIRONMENT_VARIABLE];
	return configured ? String(configured) : null;
}

async function readGateStatus() {
	return JSON.parse(await readFile(GATE_STATUS_URL, 'utf8'));
}

function assertGateStatus(status) {
	assert.equal(status.schemaVersion, 1);
	assert.match(status.audacityCommit, /^[0-9a-f]{40}$/);
	assert.equal(status.fixtureCodecInterop.status, 'automated');
	assert.equal(status.fixtureCodecInterop.fixtureCreatedByPinnedAudacity, true);
	assert.equal(status.fixtureCodecInterop.compiledNativeCodeExecuted, false);
	assert.deepEqual(status.fixtureCodecInterop.pipeline, [
		'verify-audacity-created-fixture',
		'browser-decode',
		'browser-write',
		'browser-reopen',
	]);
	assert.equal(status.compiledNativeLoaderInterop.requiredForV2Release, true);
	assert.equal(status.compiledNativeLoaderInterop.status, 'pending');
	assert.equal(status.compiledNativeLoaderInterop.compiledNativeCodeExecuted, false);
	assert.equal(status.compiledNativeLoaderInterop.availableEvidence, null);
	assert.equal(status.compiledNativeLoaderInterop.runnerProtocol.version, NATIVE_RUNNER_PROTOCOL_VERSION);
}

function loadSqlJs() {
	if (!sqlPromise) sqlPromise = initSqlJs();
	return sqlPromise;
}

function portableClipState(clip) {
	return {
		title: clip.title,
		timelineStartFrame: clip.timelineStartFrame,
		sourceStartFrame: clip.sourceStartFrame,
		sourceDurationFrames: clip.sourceDurationFrames,
		durationFrames: clip.durationFrames,
		groupId: clip.groupId,
		pitchCents: clip.pitchCents,
		speedRatio: clip.speedRatio,
		stretchToTempo: clip.stretchToTempo,
	};
}

function canonicalize(value) {
	if (Array.isArray(value)) return value.map(canonicalize);
	if (!value || typeof value !== 'object') {
		return typeof value === 'number' && Number.isFinite(value)
			? Number(value.toFixed(12))
			: value;
	}
	return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}

function stableStringify(value) {
	return JSON.stringify(canonicalize(value));
}

function sqlScalar(database, sql) {
	const result = database.exec(sql);
	return result[0]?.values?.[0]?.[0];
}

function channelHash(channel) {
	return sha256(new Uint8Array(channel.buffer, channel.byteOffset, channel.byteLength));
}

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

async function sha256File(path) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(path)) hash.update(chunk);
	return hash.digest('hex');
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
