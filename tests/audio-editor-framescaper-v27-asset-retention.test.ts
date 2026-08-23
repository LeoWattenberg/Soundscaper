/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	collectFramescaperProjectAssetStorageKeysV27,
	collectProjectStorageKeys,
} from '../src/common/editor/retention.js';
import { digestMediaContent } from '../src/common/editor/storage/media-content-digest.ts';
import { parseCubeLutV1 } from '../src/common/editor/video-color-management-v27.ts';
import { applyFramescaperProjectCommandV27 } from '../src/framescaper/editor-project-v27-commands.ts';
import { FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-project-runtime-profile-v27.ts';
import { createFramescaperProjectStoreV27 } from '../src/framescaper/editor-project-store-v27.ts';
import { createFramescaperProjectV27 } from '../src/framescaper/editor-project-v27.ts';
import { framescaperV20Options } from './helpers/framescaper-v20-model-fixture.ts';

const PROFILE = FRAMESCAPER_V27_PROJECT_RUNTIME_PROFILE;

test('V27 exact roots include motion bodies and every presentation or preset LUT', async () => {
	const fixture = await finishingFixture();
	assert.deepEqual([...collectFramescaperProjectAssetStorageKeysV27(fixture.project)].sort(), [
		fixture.lut.storageKey, fixture.motion.storageKey,
	].sort());
	const all = collectProjectStorageKeys(fixture.project);
	assert.equal(all.has(fixture.motion.storageKey), true);
	assert.equal(all.has(fixture.lut.storageKey), true);

	const withPreset = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	withPreset.videoFinishingPresets = [{
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'lut-preset', name: 'LUT look',
		template: { enabled: true, opacity: 1, blendMode: 'normal', grade: grade(fixture.lut) },
	}];
	assert.deepEqual([...collectFramescaperProjectAssetStorageKeysV27(withPreset)].sort(), [
		fixture.lut.storageKey, fixture.motion.storageKey,
	].sort(), 'the same immutable LUT key is one root');
});

test('V27 generic roots retain freeze renders and attached proxy bodies', () => {
	const project = {
		schemaVersion: 27,
		sources: [{ id: 'freeze-source', storageKey: 'freeze-body' }, {
			id: 'video-source', storageKey: 'original-body',
			proxyAttachment: {
				storageKey: 'proxy-body', timingAsset: { storageKey: 'proxy-timing-body' },
			},
		}],
		clips: [{ sourceId: 'video-source' }], projectBin: { clips: [] },
		videoFreezeFallbacks: [{ renderedSourceId: 'freeze-source' }],
		videoMotionAnalyses: [], videoVisualPresentations: [], videoFinishingPresets: [],
	};
	assert.deepEqual([...collectProjectStorageKeys(project)].sort(), [
		'freeze-body', 'original-body', 'proxy-body', 'proxy-timing-body',
	].sort());
});

test('V27 asset roots reject aliases and stop before exposing a partial bounded result', async () => {
	const fixture = await finishingFixture();
	const alias = structuredClone(fixture.project) as unknown as Record<string, unknown>;
	alias.videoFinishingPresets = [{
		schemaVersion: 1, kind: 'video-finishing-preset', id: 'bad-preset', name: 'Bad alias',
		template: {
			enabled: true, opacity: 1, blendMode: 'normal',
			grade: grade({ ...fixture.lut, byteLength: fixture.lut.byteLength + 1 }),
		},
	}];
	assert.throws(() => collectFramescaperProjectAssetStorageKeysV27(alias), /alias|identity/iu);
	const target = new Set(['caller-root']);
	assert.throws(() => collectFramescaperProjectAssetStorageKeysV27(
		fixture.project, target, { maximumRoots: 1 },
	), /root.*limit|limit.*root/iu);
	assert.deepEqual([...target], ['caller-root']);
});

test('V27 save promotes referenced finishing bodies and pruning follows revisions', async (context) => {
	const fixture = await finishingFixture();
	const store = createFramescaperProjectStoreV27(PROFILE, {
		indexedDB: null, preferOpfs: false,
	});
	context.after(async () => { await store.close(); });
	await store.ready();
	assert.ok(await store.projectRepository.createIfAbsent!(fixture.initial as never));
	await store.writeMediaAsset(fixture.motion.storageKey, fixture.motion.body, {
		sha256: fixture.motion.sha256,
	});
	await store.writeMediaAsset(fixture.lut.storageKey, fixture.lut.body, {
		sha256: fixture.lut.sha256,
	});
	assert.equal(typeof (await store.getMediaAssetMetadata(fixture.motion.storageKey))
		?.pendingProjectUntil, 'string');
	await store.projectRepository.save(fixture.project as never);
	assert.equal((await store.getMediaAssetMetadata(fixture.motion.storageKey))
		?.pendingProjectUntil, undefined);
	assert.equal((await store.getMediaAssetMetadata(fixture.lut.storageKey))
		?.pendingProjectUntil, undefined);

	let pruned = await store.pruneUnreferencedSources({
		minimumAgeMs: 0, now: Date.now() + 86_400_000,
	});
	assert.equal(pruned.deletedSourceIds.includes(fixture.motion.storageKey), false);
	assert.equal(pruned.deletedSourceIds.includes(fixture.lut.storageKey), false);
	await store.deleteProject(String(fixture.project.id));
	pruned = await store.pruneUnreferencedSources({
		minimumAgeMs: 0, now: Date.now() + 86_400_000,
	});
	assert.equal(pruned.deletedSourceIds.includes(fixture.motion.storageKey), true);
	assert.equal(pruned.deletedSourceIds.includes(fixture.lut.storageKey), true);
});

async function finishingFixture() {
	const initial = createFramescaperProjectV27(PROFILE, {
		...framescaperV20Options(), id: 'v27-finishing-retention',
	});
	const motionBody = new Blob(['{"motion":"bounded"}'], {
		type: 'application/vnd.framescaper.motion-analysis+json',
	});
	const motionSha256 = await digestMediaContent(motionBody);
	const motion = {
		body: motionBody, sha256: motionSha256,
		storageKey: `motion-sha256:${motionSha256}`,
	};
	const lutText = identityCube();
	const parsed = parseCubeLutV1(lutText);
	const lut = {
		body: new Blob([lutText], { type: 'text/plain' }),
		storageKey: `lut-sha256:${parsed.sha256}`,
		sha256: parsed.sha256, byteLength: parsed.byteLength, size: parsed.size,
		domainMin: parsed.domainMin, domainMax: parsed.domainMax,
	};
	const stack = {
		schemaVersion: 1, id: 'tracking-stack', sourceId: 'video-source', processors: [{
			schemaVersion: 1, id: 'tracker', kind: 'tracking', enabled: true,
			maximumFeatures: 128, quality: 0.05, minimumDistance: 3,
			windowRadius: 3, pyramidLevels: 3,
		}],
	};
	const analysis = {
		schemaVersion: 1, id: 'tracking-analysis', sourceId: 'video-source',
		processorStackId: stack.id, inputSha256: '12'.repeat(32),
		settingsSha256: '34'.repeat(32), storageKey: motion.storageKey,
		sha256: motion.sha256, byteLength: motion.body.size, startFrame: 0, endFrame: 10,
	};
	const presentation = {
		schemaVersion: 1, id: 'graded-video', owner: { kind: 'clip', id: 'video-clip' },
		enabled: true, opacity: 1, blendMode: 'normal', grade: grade(lut),
		processorStackId: null, maskMatteIds: [],
	};
	const project = applyFramescaperProjectCommandV27(PROFILE, initial, {
		type: 'batch', commands: [{
			type: 'video-processor-stack/set', processorStackId: stack.id,
			expectedProcessorStack: null, processorStack: stack,
		}, {
			type: 'video-motion-analysis/set', motionAnalysisId: analysis.id,
			expectedMotionAnalysis: null, motionAnalysis: analysis,
		}, {
			type: 'video-visual-presentation/set', presentationId: presentation.id,
			expectedPresentation: null, presentation,
		}],
	});
	return { initial, project, motion, lut };
}

function grade(lut: Readonly<Record<string, unknown>>) {
	return {
		schemaVersion: 1, exposureStops: 0, contrast: 1, pivot: 0.18,
		lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1], saturation: 1,
		lut: {
			storageKey: lut.storageKey, sha256: lut.sha256, byteLength: lut.byteLength,
			size: lut.size, domainMin: lut.domainMin, domainMax: lut.domainMax,
		},
	};
}

function identityCube(): string {
	return [
		'LUT_3D_SIZE 2',
		'0 0 0', '0 0 1', '0 1 0', '0 1 1',
		'1 0 0', '1 0 1', '1 1 0', '1 1 1',
	].join('\n');
}
