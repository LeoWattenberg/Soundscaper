/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	audacityXmlAttribute,
	audacityXmlChildren,
	decodeAudacityBinaryXml,
} from '../src/common/editor/audacity-binary-xml.js';
import { decodeAudacityProjectTree } from '../src/common/editor/aup4-conversion.js';
import { mergeCompatibilityReports } from '../src/common/editor/aup4-worker-values.js';
import { createAup3ProjectDocument } from '../src/common/editor/aup3-profile.ts';
import { createAup3ProjectData } from './aup3-fixture.js';

test('AUP3 plan-import report merging preserves its source generation', () => {
	const report = mergeCompatibilityReports(
		{ direction: 'open', sourceGeneration: 'aup4', items: [] },
		{ direction: 'open', sourceGeneration: 'aup3', items: [] },
	);
	assert.equal(report.format, 'audacity-project');
	assert.equal(report.sourceGeneration, 'aup3');
});

test('AUP3 import records cut-line loss for a later compatibility report', async () => {
	const fixture = createAup3ProjectData({
		tracks: [{
			name: 'Cut lines', height: 180, minimized: true,
			clips: [{ samples: [0.25, -0.5, 0.75], cutline: true }],
		}],
	});
	const root = decodeAudacityBinaryXml(fixture.dictionary, fixture.document).root;
	let sequence = 0;
	const decoded = await decodeAudacityProjectTree(root, () => null, {
		idFactory: (prefix: string) => `${prefix}-${String(++sequence)}`,
		planAudio: true,
		sourceGeneration: 'aup3',
	});
	const track = decoded.project.tracks[0];
	const clip = decoded.project.clips[0];
	assert.equal(track?.collapsed, true);
	assert.equal(track?.height, 180);
	assert.equal(clip?.opaqueExtensions?.audacityCutLineCount, 1);

	const exported = createAup3ProjectDocument(decoded.project);
	assert.ok(exported.omissions.entries.some((entry) => (
		entry.reason === 'unsupported-aup3-cutline'
	)));
});

test('AUP3 export writes native expanded height and minimized track state', () => {
	const project = {
		id: 'collapsed-project', title: 'Collapsed', sampleRate: 48_000,
		selection: {}, metadata: {},
		sources: [{ id: 'source', frameCount: 3, channelCount: 1, sampleRate: 48_000 }],
		clips: [{
			id: 'clip', sourceId: 'source', timelineStartFrame: 0,
			durationFrames: 3, sourceDurationFrames: 3,
		}],
		tracks: [{
			id: 'track', type: 'audio', name: 'Collapsed', clipIds: ['clip'], effects: [],
			collapsed: true, height: 180,
		}],
		master: { effects: [] },
	};
	const document = createAup3ProjectDocument(project).document;
	const root = document.roots.find((entry) => entry.kind === 'node')?.node;
	const waveTrack = (audacityXmlChildren as unknown as (
		node: unknown, name: string,
	) => unknown[])(root, 'wavetrack')[0];
	assert.equal(audacityXmlAttribute(waveTrack, 'height'), 180);
	assert.equal(audacityXmlAttribute(waveTrack, 'minimized'), true);
});
