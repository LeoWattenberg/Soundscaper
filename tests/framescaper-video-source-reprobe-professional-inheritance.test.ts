/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createVideoSource } from '../src/common/editor/project-media-factory.ts';
import {
	createVideoTimingAssetPublication,
	decodeVideoTimingAsset,
} from '../src/common/editor/video-timing-asset.ts';
import { normalizeVideoSourceCharacteristics } from '../src/common/editor/video-source-characteristics.ts';
import {
	normalizeVideoSourceCharacteristicsV25,
} from '../src/common/editor/video-source-professional-characteristics-v25.ts';
import { planVideoSourceUpgrade } from '../src/common/editor/video-source-upgrade.ts';
import {
	applyFramescaperProjectCommand,
	type FramescaperProjectCommand,
} from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import {
	FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
} from '../src/framescaper/editor-project-runtime-profile.ts';

const CONTENT_SHA256 = 'ef'.repeat(32);
const FABRICATED_RATE = Object.freeze({ num: 30, den: 1 });
const EXACT_RATE = Object.freeze({ num: 24, den: 1 });

test('a Framescaper re-probe carries professional facts through the V17 command projection', () => {
	const source = createVideoSource({
		kind: 'video', id: 'video-source', storageKey: 'video-source', name: 'phone.mp4',
		mimeType: 'video/mp4', contentSha256: CONTENT_SHA256,
		frameCount: 480_000, sampleRate: 48_000, width: 640, height: 360,
		frameRate: FABRICATED_RATE, sourceFrameCount: 300,
		timingAsset: null,
		timingDecision: {
			mode: 'conform-cfr-at-ingest', rate: FABRICATED_RATE,
			reason: 'timing-probe-unavailable', failures: [],
		},
		videoCodec: 'h264', audioCodec: null, hasAudio: false,
	}, 48_000);
	const professional = normalizeVideoSourceCharacteristicsV25({
		backend: 'framescaper-media-host', codedWidth: 640, codedHeight: 360,
		hasAlpha: true, videoCodec: 'h264', bitDepth: 10,
		pixelFormat: 'yuva420p10le', chromaFormat: '4:2:0',
		alphaMode: 'straight', alphaInterpretation: 'transparency',
	}, { rate: FABRICATED_RATE });
	const project = createFramescaperProject(FRAMESCAPER_PROJECT_RUNTIME_PROFILE, {
		id: 'professional-reprobe', now: '2026-08-31T12:00:00.000Z',
		sources: [{ ...source, characteristics: professional }],
	});
	const publication = createVideoTimingAssetPublication(CONTENT_SHA256, {
		timescale: 24_000,
		presentationTicks: Array.from({ length: 240 }, (_value, index) => BigInt(index) * 1_000n),
		finalFrameDurationTicks: 1_000n,
	});
	const plan = planVideoSourceUpgrade({
		source: firstSource(project),
		probe: {
			decision: 'timing-asset', backend: 'ffmpeg', nominalRate: EXACT_RATE,
			timing: decodeVideoTimingAsset(publication.bytes),
			characteristics: normalizeVideoSourceCharacteristics({
				backend: 'ffmpeg', codedWidth: 640, codedHeight: 360,
				hasAlpha: true, videoCodec: 'h264',
			}, { rate: EXACT_RATE }),
		},
		timingAsset: publication.reference,
	});
	const unreported = applyFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: { characteristics: null }, clips: [],
		} as FramescaperProjectCommand,
	);
	const unreportedCharacteristics = firstSource(unreported).characteristics as Readonly<Record<string, unknown>>;
	assert.equal(unreportedCharacteristics.backend, null);
	assert.equal(unreportedCharacteristics.bitDepth, 10);

	const plannedCharacteristics = plan.changes.characteristics as Readonly<Record<string, unknown>>;
	assert.throws(() => applyFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: {
				...plan.changes,
				characteristics: { ...plannedCharacteristics, bitDepth: 12 },
			},
			clips: plan.clips,
		} as FramescaperProjectCommand,
	), /cannot change professional source characteristics/u);

	const upgraded = applyFramescaperProjectCommand(
		FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
		project,
		{
			type: 'source/reprobe', sourceId: plan.sourceId,
			changes: plan.changes, clips: plan.clips,
		} as FramescaperProjectCommand,
	);
	const upgradedSource = firstSource(upgraded);
	const characteristics = upgradedSource.characteristics as Readonly<Record<string, unknown>>;

	assert.deepEqual(upgradedSource.frameRate, EXACT_RATE);
	assert.equal(upgradedSource.sourceFrameCount, 240);
	assert.equal(characteristics.backend, 'ffmpeg');
	assert.equal(characteristics.bitDepth, 10);
	assert.equal(characteristics.pixelFormat, 'yuva420p10le');
	assert.equal(characteristics.chromaFormat, '4:2:0');
	assert.equal(characteristics.alphaMode, 'straight');
	assert.equal(characteristics.alphaInterpretation, 'transparency');
});

function firstSource(project: unknown): Readonly<Record<string, unknown>> {
	assert.ok(project && typeof project === 'object' && !Array.isArray(project));
	const sources = (project as Readonly<Record<string, unknown>>).sources;
	assert.ok(Array.isArray(sources) && sources.length > 0);
	const source = sources[0];
	assert.ok(source && typeof source === 'object' && !Array.isArray(source));
	return source as Readonly<Record<string, unknown>>;
}
