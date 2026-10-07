/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { parseDawprojectDocument } from '../src/common/editor/dawproject-import.ts';
import { buildDawprojectProject } from '../src/common/editor/dawproject-import-project.ts';
import { walkXml } from '../src/common/editor/dawproject-xml.ts';
import { importSoundscaperAudacityProject } from '../src/soundscaper/editor-audacity-project-import.ts';

for (const scope of ['track', 'master'] as const) {
	test(`native ${scope} envelopes become exact baseline gain lanes without changing decoded state`, () => {
		const envelope = [{ frame: 12_000, value: 1 }, { frame: 24_000, value: 0.2 }];
		const decoded = createAudioEditorProjectV17({
			id: 'native-envelope', tracks: [createAudioTrack({ id: 'voice', gain: 0.5,
				...(scope === 'track' ? { envelope } : {}) })],
			master: { gain: 0.25, ...(scope === 'master' ? { envelope } : {}) },
		});
		const original = structuredClone(decoded);
		const imported = importSoundscaperAudacityProject(decoded);
		assert.equal(imported.automationLanes.length, 1);
		const lane = imported.automationLanes[0]!;
		assert.deepEqual(lane.address, { kind: 'strip', strip: scope === 'track'
			? { kind: 'track', id: 'voice' } : { kind: 'master' }, parameterId: 'gain' });
		const gain = scope === 'track' ? 0.5 : 0.25;
		assert.deepEqual(lane.points.map(({ position, value }) => [position, value]),
			[[0, gain], [12_000, gain], [24_000, gain * 0.2]]);
		assert.deepEqual(lane.segments, [{ kind: 'linear' }, { kind: 'linear' }]);
		assert.equal(lane.timebase, 'absolute-samples');
		assert.deepEqual(decoded, original);
	});

	test(`DAWproject absolute ${scope} automation is promoted without multiplying its static fader`, () => {
		const source = { id: 'original', sampleRate: 48_000, tracks: [createAudioTrack({ id: 'voice', name: 'Voice', gain: 0.5 })],
			master: { gain: 0.25 }, sources: [], clips: [],
			automationLanes: [{ id: 'authored', address: { kind: 'strip', strip: scope === 'track'
				? { kind: 'track', id: 'voice' } : { kind: 'master' }, parameterId: 'gain' },
				timebase: 'absolute-samples', points: [{ id: 'start', position: 0, value: 0.5 },
					{ id: 'end', position: 24_000, value: 0.2 }], segments: [{ kind: 'linear' }] }],
		};
		const original = structuredClone(source);
		const exported = createDawprojectExport({ project: source });
		let serial = 0;
		const plan = buildDawprojectProject(parseDawprojectDocument(exported.projectXml), {
			media: new Map(), createStableId: prefix => `${prefix}-${String(++serial)}`,
		});
		const imported = importSoundscaperAudacityProject(createAudioEditorProjectV17(plan.project as never));
		assert.equal(imported.automationLanes.length, 1);
		assert.deepEqual(imported.automationLanes[0]!.points.map(({ position, value }) => [position, value]),
			[[0, 0.5], [24_000, 0.2]]);
		assert.deepEqual(source, original);
	});
}

test('legacy multiplicative envelopes export absolute DAWproject parameter values', () => {
	const source = { id: 'legacy', sampleRate: 48_000, tracks: [createAudioTrack({ id: 'voice', gain: 0.5,
		envelope: [{ frame: 0, value: 1 }, { frame: 24_000, value: 0.2 }] })], sources: [], clips: [] };
	const exported = createDawprojectExport({ project: source });
	const points = [...walkXml(exported.document)].filter(element => element.name === 'RealPoint');
	assert.deepEqual(points.map(point => point.attributes.value), ['0.5', '0.1']);
});

test('native imports with no envelope leave the static fader and lane inventory alone', () => {
	const decoded = createAudioEditorProjectV17({ tracks: [createAudioTrack({ id: 'voice', gain: 0.5 })] });
	const imported = importSoundscaperAudacityProject(decoded);
	assert.equal(imported.tracks[0]!.gain, 0.5);
	assert.deepEqual(imported.automationLanes, []);
});
