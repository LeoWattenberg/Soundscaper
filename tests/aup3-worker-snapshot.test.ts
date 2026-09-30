/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createAudacityXmlNode } from '../src/common/editor/audacity-binary-xml.js';
import {
	commitAup3Autosave,
	initializeAup3Database,
	prepareAup3PortableExport,
} from '../src/common/editor/aup3-database.ts';
import { createAup4SnapshotWrites } from '../src/common/editor/aup4-worker-snapshot.js';
import { createEffect, createMissingEffect } from '../src/common/editor/effects.js';
import { SQL } from './helpers/aup4-database-harness.js';

test('worker snapshot staging writes the selected AUP3 profile and reports stripped opaque fields', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const entry = {
			projectId: 'legacy-export',
			database,
			pool: null,
			targetGeneration: 'aup3',
			lastExportCompatibilityReport: null,
		};
		const snapshots = createAup4SnapshotWrites({ requireWritableProject: () => entry });
		const context = {
			id: 'request-1',
			checkCancelled() {},
			progress() {},
		};
		const project = {
			id: 'project',
			title: 'Legacy export',
			sampleRate: 48_000,
			tempo: 180,
			selection: {},
			metadata: {},
			sources: [
				{ id: 'source', kind: 'audio', frameCount: 3, channelCount: 1, sampleRate: 48_000 },
				{
					id: 'video-source', kind: 'video', name: 'Video', storageKey: 'video-source',
					mimeType: 'video/mp4', frameCount: 3, width: 1920, height: 1080,
					frameRate: 30, videoCodec: 'h264', audioCodec: null, hasAudio: false,
				},
			],
			clips: [{
				id: 'clip', kind: 'audio', sourceId: 'source', timelineStartFrame: 0, sourceStartFrame: 0,
				durationFrames: 3, sourceDurationFrames: 3,
				rawAudioTempo: 120, stretchToTempo: false,
				opaqueExtensions: { audacityCutLineCount: 1 },
			}, {
				id: 'video-clip', kind: 'video', sourceId: 'video-source', timelineStartFrame: 0,
				sourceStartFrame: 0, durationFrames: 3, sourceDurationFrames: 3,
			}],
			tracks: [
				{
					id: 'track', type: 'audio', clipIds: ['clip'], effects: [
						createEffect('audacity-invert', { id: 'invert' }),
						createMissingEffect({
							id: 'missing-superverb',
							enabled: true,
							missing: {
								name: 'SuperVerb',
								nativeId: 'Effect_VST3_Acme_SuperVerb_Acme SuperVerb',
								reason: 'plugin-unavailable',
								source: 'aup4',
							},
							opaqueAudacityNode: {
								kind: 'node',
								node: createAudacityXmlNode('effect', [
									{ kind: 'attribute', name: 'active', type: 'bool', value: true },
									{
										kind: 'attribute', name: 'id', type: 'string',
										value: 'Effect_VST3_Acme_SuperVerb_Acme SuperVerb',
									},
								], [{ kind: 'blob', name: 'state', value: Uint8Array.of(4, 5) }]),
							},
						}),
					],
				},
				{ id: 'video-track', type: 'video', clipIds: ['video-clip'], effects: [] },
			],
			master: { effects: [] },
			opaqueAudacityNodes: [{
				kind: 'node',
				node: createAudacityXmlNode('vendor-state', [], [{
					kind: 'blob', name: 'payload', value: Uint8Array.of(1, 2, 3),
				}]),
			}],
		};

		const started = snapshots.begin({ projectId: entry.projectId, project }, context);
		snapshots.appendSource({
			projectId: entry.projectId,
			snapshotId: started.snapshotId,
			source: { sourceId: 'source', sampleRate: 48_000, channels: [Float32Array.of(-1, 0, 1)] },
		}, context);
		const result = snapshots.finalize({
			projectId: entry.projectId,
			snapshotId: started.snapshotId,
		}, context);

		assert.equal(result.compatibilityReport.format, 'audacity-project');
		assert.equal(result.compatibilityReport.targetGeneration, 'aup3');
		assert.ok(result.compatibilityReport.items.some((item: { code: string; disposition: string }) => (
			item.code === 'AUP3_PROFILE_ATTRIBUTES_CONVERTED' && item.disposition === 'converted'
		)));
		assert.ok(result.compatibilityReport.items.some((item: { code: string; disposition: string }) => (
			item.code === 'AUP3_PROFILE_ATTRIBUTES_OMITTED' && item.disposition === 'omitted'
		)));
		assert.ok(result.compatibilityReport.items.some((item: { code: string; disposition: string }) => (
			item.code === 'AUP3_UNSUPPORTED_BINARY_FIELDS_OMITTED' && item.disposition === 'omitted'
		)));
		assert.ok(result.compatibilityReport.items.some((item: { code: string; disposition: string }) => (
			item.code === 'AUP3_TEMPO_FOLLOW_MODE_OMITTED' && item.disposition === 'omitted'
		)));
		assert.ok(result.compatibilityReport.items.some((item: { code: string; disposition: string }) => (
			item.code === 'AUP3_CUT_LINE_AUDIO_OMITTED' && item.disposition === 'omitted'
		)));
		const realtimeOmission = result.compatibilityReport.items.find((item: { code: string }) => (
			item.code === 'AUP3_REALTIME_EFFECTS_OMITTED'
		));
		assert.equal(realtimeOmission?.disposition, 'omitted');
		assert.equal(realtimeOmission?.severity, 'warning');
		assert.deepEqual({
			active: realtimeOmission?.data.fields[0]?.active,
			type: realtimeOmission?.data.fields[0]?.type,
			nativeId: realtimeOmission?.data.fields[0]?.nativeId,
		}, {
			active: true,
			type: 'audacity-invert',
			nativeId: 'Effect_Audacity_Audacity_Invert_Built-in Effect: Invert',
		});
		const binaryStateOmission = result.compatibilityReport.items.find((item: { code: string }) => (
			item.code === 'AUP3_EFFECT_BINARY_STATE_OMITTED'
		));
		assert.equal(binaryStateOmission?.disposition, 'omitted');
		assert.equal(binaryStateOmission?.severity, 'warning');
		assert.deepEqual({
			active: binaryStateOmission?.data.fields[0]?.active,
			nativeId: binaryStateOmission?.data.fields[0]?.nativeId,
			byteLength: binaryStateOmission?.data.fields[0]?.byteLength,
		}, {
			active: true,
			nativeId: 'Effect_VST3_Acme_SuperVerb_Acme SuperVerb',
			byteLength: 2,
		});
		assert.equal(result.compatibilityReport.items.some((item: { message?: string }) => (
			/AUP4/u.test(item.message ?? '')
		)), false);
		assert.equal(entry.lastExportCompatibilityReport, result.compatibilityReport);
		assert.equal(commitAup3Autosave(database), true);
		const validation = prepareAup3PortableExport(database);
		assert.equal(validation.summary?.xmlVersion, '1.3.0');
		assert.equal(validation.summary?.audacityVersion, '3.7.9');
	} finally {
		database.close();
	}
});

test('worker reports an inactive Audacity 3 realtime-effect omission as informational', () => {
	const database = new SQL.Database();
	try {
		initializeAup3Database(database);
		const entry = {
			projectId: 'inactive-effect-export',
			database,
			pool: null,
			targetGeneration: 'aup3',
			lastExportCompatibilityReport: null,
		};
		const snapshots = createAup4SnapshotWrites({ requireWritableProject: () => entry });
		const context = { id: 'request-2', checkCancelled() {}, progress() {} };
		const started = snapshots.begin({
			projectId: entry.projectId,
			project: {
				id: 'project', title: 'Inactive effect', sampleRate: 48_000,
				selection: {}, metadata: {}, sources: [], clips: [],
				tracks: [{
					id: 'track', type: 'audio', clipIds: [], effectsActive: false,
					effects: [createEffect('audacity-invert', { id: 'invert' })],
				}],
				master: { effects: [] },
			},
		}, context);
		const result = snapshots.finalize({
			projectId: entry.projectId, snapshotId: started.snapshotId,
		}, context);
		const omission = result.compatibilityReport.items.find((item: { code: string }) => (
			item.code === 'AUP3_REALTIME_EFFECTS_OMITTED'
		));
		assert.equal(omission?.severity, 'info');
		assert.equal(omission?.data.fields[0]?.active, false);
		assert.equal(omission?.data.fields[0]?.type, 'audacity-invert');
	} finally {
		database.close();
	}
});
