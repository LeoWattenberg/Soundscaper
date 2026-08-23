/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createGrayVideoFrameV1 } from '../src/common/editor/video-motion-processing-v27.ts';
import { applyFramescaperOwnedFinishingCommandV27 } from '../src/framescaper/editor-project-v27-finishing-command.ts';
import {
	createFramescaperMotionAnalysisActionsV27,
	type FramescaperMotionAnalysisProgressV27,
} from '../src/framescaper/editor-motion-analysis-actions-v27.ts';

const SHA = '12'.repeat(32);

test('selected V27 motion action publishes a digest body then one stale-safe history command', async () => {
	const project = motionProject();
	const publications: Array<{ key: string; bytes: Uint8Array; metadata: unknown }> = [];
	const metadata = new Map<string, Readonly<Record<string, unknown>>>();
	const commits: unknown[] = [];
	const progress: FramescaperMotionAnalysisProgressV27[] = [];
	const owner = {
		project,
		actions: { edit: { commit(command: unknown) {
			commits.push(command);
			applyFramescaperOwnedFinishingCommandV27(project, command as never);
			return command;
		} } },
	};
	const actions = createFramescaperMotionAnalysisActionsV27({
		owner,
		store: {
			getMediaAssetMetadata: async (key) => metadata.get(key) ?? null,
			beginMediaAssetWrite: async (key, bodyMetadata, options) => {
				assert.equal(options.expectedSha256, key.slice('motion-sha256:'.length));
				const chunks: Uint8Array[] = [];
				let bytesWritten = 0;
				return {
					maximumChunkBytes: 17,
					get bytesWritten() { return bytesWritten; },
					write: async (bytes) => {
						assert.ok(bytes.byteLength <= 17);
						chunks.push(bytes.slice());
						bytesWritten += bytes.byteLength;
					},
					commitOwned: async () => {
						const bytes = Uint8Array.from(chunks.flatMap((chunk) => [...chunk]));
						assert.equal(bytes.byteLength, options.expectedBytes);
						const stored = { size: bytes.byteLength, sha256: options.expectedSha256 };
						publications.push({ key, bytes, metadata: bodyMetadata });
						metadata.set(key, stored);
						return {
							metadata: stored,
							discardIfCurrent: async () => metadata.delete(key),
						};
					},
					abort: async () => undefined,
				};
			},
		},
		frameProvider: async (request) => {
			request.onProgress({ phase: 'decoding', completed: 1, total: 2 });
			return [
				{ frameNumber: request.startFrame, frame: gray(0) },
				{ frameNumber: request.endFrame - 1, frame: gray(1) },
			];
		},
	});
	assert.deepEqual(actions.targets(), [{
		stackId: 'stack-1', sourceId: 'video-source', sourceName: 'Video',
		startFrame: 0, endFrame: 10, analysisId: 'analysis:stack-1', freshness: 'missing',
	}]);
	const reference = await actions.analyze({
		processorStackId: 'stack-1', startFrame: 0, endFrame: 2,
		onProgress: (value) => { progress.push(value); },
	});
	assert.equal(publications.length, 1);
	assert.equal(publications[0]?.key, reference.storageKey);
	assert.equal(new TextDecoder().decode(publications[0]?.bytes), JSON.stringify({
		schemaVersion: 1,
		analysisId: 'analysis:stack-1', sourceId: 'video-source', processorStackId: 'stack-1',
		inputSha256: SHA, settingsSha256: reference.settingsSha256,
		analysisWidth: 8, analysisHeight: 8,
		startFrame: 0, endFrame: 2,
		transforms: [{ frameNumber: 1, transform: {
			scale: 1, rotationRadians: 0, translateX: 0, translateY: 0,
			inlierCount: 0, meanError: 0,
		} }],
	}));
	assert.equal(commits.length, 1);
	assert.deepEqual(commits[0], {
		type: 'video-motion-analysis/set', motionAnalysisId: 'analysis:stack-1',
		expectedMotionAnalysis: null, motionAnalysis: reference,
	});
	assert.equal(progress.at(-1)?.phase, 'complete');
	assert.equal(actions.targets()[0]?.freshness, 'current');
	assert.deepEqual(await actions.analyze({
		processorStackId: 'stack-1', startFrame: 0, endFrame: 2,
	}), reference);
	assert.equal(publications.length, 1, 'deterministic recompute reuses the authenticated body');
	assert.equal(commits.length, 1, 'an identical reference is not published as a no-op history command');
});

test('selected V27 motion action cancels cleanly and rolls back a body when publication loses currentness', async () => {
	const project = motionProject();
	let deleted = '';
	let commit = false;
	const owner = {
		project,
		actions: { edit: { commit() { commit = true; } } },
	};
	const actions = createFramescaperMotionAnalysisActionsV27({
		owner,
		store: {
			getMediaAssetMetadata: async () => null,
			beginMediaAssetWrite: async (key, _metadata, options) => {
				let bytesWritten = 0;
				return {
					maximumChunkBytes: 1_024,
					get bytesWritten() { return bytesWritten; },
					write: async (bytes) => { bytesWritten += bytes.byteLength; },
					commitOwned: async () => {
						project.videoProcessorStacks[0]!.processors[0]!.quality = 0.2;
						return {
							metadata: { size: options.expectedBytes, sha256: options.expectedSha256 },
							discardIfCurrent: async () => { deleted = key; return true; },
						};
					},
					abort: async () => undefined,
				};
			},
		},
		frameProvider: async (request) => [
			{ frameNumber: request.startFrame, frame: gray(0) },
			{ frameNumber: request.endFrame - 1, frame: gray(1) },
		],
	});
	await assert.rejects(() => actions.analyze({
		processorStackId: 'stack-1', startFrame: 0, endFrame: 2,
	}), /changed|stale|current/iu);
	assert.match(deleted, /^motion-sha256:/u);
	assert.equal(commit, false);

	const abort = new AbortController();
	abort.abort(new Error('operator cancelled'));
	await assert.rejects(() => actions.analyze({
		processorStackId: 'stack-1', startFrame: 0, endFrame: 2, signal: abort.signal,
	}), /operator cancelled/iu);
});

function gray(offset: number) {
	const samples = Array.from({ length: 64 }, () => 0);
	samples[18 + offset] = 1;
	return createGrayVideoFrameV1({ width: 8, height: 8, samples });
}

function motionProject() {
	return {
		schemaVersion: 27, id: 'project-1', revision: 1,
		sources: [{
			kind: 'video', id: 'video-source', name: 'Video', storageKey: 'video-source',
			contentSha256: SHA, sourceFrameCount: 10, frameRate: { num: 10, den: 1 },
		}],
		videoProcessorStacks: [{
			schemaVersion: 1, id: 'stack-1', sourceId: 'video-source',
			processors: [{
				schemaVersion: 1, id: 'tracking-1', kind: 'tracking', enabled: true,
				maximumFeatures: 32, quality: 0.01, minimumDistance: 2,
				windowRadius: 2, pyramidLevels: 2,
			}],
		}],
		videoMotionAnalyses: [],
	};
}
