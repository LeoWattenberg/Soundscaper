/* SPDX-License-Identifier: AGPL-3.0-only */

// The reference project the audit round-trips, and an independent reading of any
// portable snapshot. The snapshot is inspected straight out of SQLite rather
// than through the browser codec, so what the codec claims to have written can be
// compared against what the file actually contains. Split out of
// audit-aup4-interop.mjs; no behaviour changes here.

import assert from 'node:assert/strict';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	createAudacityXmlNode,
	encodeAudacityBinaryXml,
} from '../../src/common/editor/audacity-binary-xml.js';
import {
	initializeAup4Database,
	insertAup4SampleBlock,
	prepareAup4SerializedDatabase,
	readAup4SampleBlock,
	validateAup4Database,
	writeAup4Document,
} from '../../src/common/editor/aup4-database.js';
import { decodeAup4ProjectTree } from '../../src/common/editor/aup4-conversion.js';
import {
	AUP4_SAMPLE_FORMAT_FLOAT32,
	createAup4ProjectTree,
	createAup4SampleBlock,
	decodeAup4Float32Samples,
} from '../../src/common/editor/aup4-profile.js';
import {
	canonicalize,
	channelHash,
	sha256,
	sqlScalar,
	stableStringify,
} from './aup4-interop-values.mjs';

const UTF8 = new TextEncoder();

export function createSoundscaperNativeGateSnapshot(SQL) {
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

export async function inspectPortableSnapshot(SQL, bytes) {
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

export function portableSnapshotEvidence(bytes, snapshot) {
	return {
		sha256: sha256(bytes),
		byteLength: bytes.byteLength,
		database: snapshot.report,
		projectStateSha256: snapshot.projectStateSha256,
		sampleBlocksSha256: snapshot.sampleBlocksSha256,
		channelSha256: snapshot.projectState.pcm.flatMap((source) => source.channelSha256),
	};
}

export function portableProjectState(decoded) {
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

export function portableEffectState(effect) {
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

export function validateRegeneratedSampleBlocks(database, root) {
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

export function portableClipState(clip) {
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

