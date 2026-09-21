/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { VampAnalysisRequest, VampAnalysisResult } from '../src/common/editor/vamp-analysis.ts';
import {
	createSoundscaperVampAnalyzerSession,
	type SoundscaperVampAnalysisInput,
} from '../src/common/editor/ui/workspace/soundscaper-vamp-analyzer-runtime.ts';

const BINARY_SHA256 = 'ab'.repeat(32);

test('the workspace Vamp session binds the current selection and selected audio track', async () => {
	const inputs: SoundscaperVampAnalysisInput[] = [];
	const project = projectFixture();
	const controller = controllerFixture(project, {
		list: async () => [analyzerFixture()],
		analyze: async (input) => {
			inputs.push(input);
			return resultFixture(input.request);
		},
	});
	const session = createSoundscaperVampAnalyzerSession({
		controller,
		durationFrames: 48_000,
		selectedTrackId: 'voice',
		createTrackId: () => 'vamp-labels',
	});
	assert.ok(session);
	assert.deepEqual({
		projectId: session.projectId,
		scope: session.scope,
		startFrame: session.startFrame,
		endFrame: session.endFrame,
		sampleRate: session.sampleRate,
	}, {
		projectId: 'project-a', scope: 'track', startFrame: 1_000, endFrame: 9_000, sampleRate: 48_000,
	});
	assert.deepEqual(await session.loadCatalog(), [analyzerFixture()]);

	const trackRequest = requestFixture('track');
	await session.analyze(trackRequest, new AbortController().signal);
	const masterRequest = requestFixture('master');
	await session.analyze(masterRequest, new AbortController().signal);
	assert.deepEqual(inputs.map(({ projectId, projectRevision, selectedTrackId, request }) => ({
		projectId, projectRevision, selectedTrackId, scope: request.scope,
	})), [
		{ projectId: 'project-a', projectRevision: 7, selectedTrackId: 'voice', scope: 'track' },
		{ projectId: 'project-a', projectRevision: 7, selectedTrackId: null, scope: 'master' },
	]);
});

test('Vamp label publication is one fenced editor command', async () => {
	const project = projectFixture();
	const controller = controllerFixture(project);
	const session = createSoundscaperVampAnalyzerSession({
		controller, durationFrames: 48_000, selectedTrackId: 'voice',
		port: {
			list: async () => [analyzerFixture()],
			analyze: async (input) => resultFixture(input.request),
		},
		createTrackId: () => 'vamp-labels',
	});
	assert.ok(session);
	await session.publishLabels(resultFixture(requestFixture('track')), 'Detected onsets');
	assert.equal(controller.commands.length, 1);
	const command = controller.commands[0] as {
		readonly type: string;
		readonly track: Readonly<{ id: string; type: string; name: string; labels: readonly Readonly<Record<string, unknown>>[] }>;
	};
	assert.equal(command.type, 'track/add');
	assert.deepEqual(
		{ id: command.track.id, type: command.track.type, name: command.track.name },
		{ id: 'vamp-labels', type: 'label', name: 'Detected onsets' },
	);
	assert.deepEqual(command.track.labels.map(({ title, startFrame, endFrame }) => ({
		title, startFrame, endFrame,
	})), [{ title: 'Kick', startFrame: 5_800, endFrame: 5_800 }]);

	controller.project = { ...project, revision: 8 };
	await assert.rejects(
		() => session.publishLabels(resultFixture(requestFixture('track')), 'Stale result'),
		/project changed/iu,
	);
	assert.equal(controller.commands.length, 1);
});

test('the Vamp workspace seam rejects range drift and defaults to master for a non-audio selection', async () => {
	const project = {
		...projectFixture(),
		selection: { startFrame: 2_000, endFrame: 2_000 },
	};
	const controller = controllerFixture(project);
	const session = createSoundscaperVampAnalyzerSession({
		controller, durationFrames: 48_000, selectedTrackId: 'labels',
		port: {
			list: async () => [analyzerFixture()],
			analyze: async (input) => resultFixture(input.request),
		},
	});
	assert.ok(session);
	assert.equal(session.scope, 'master');
	assert.deepEqual([session.startFrame, session.endFrame], [0, 48_000]);
	await assert.rejects(
		() => session.analyze({ ...requestFixture('master'), startFrame: 1 }, new AbortController().signal),
		/range/iu,
	);
	await assert.rejects(
		() => session.analyze({
			...requestFixture('track'), startFrame: 0, endFrame: 48_000,
		}, new AbortController().signal),
		/selected audio track/iu,
	);
});

function projectFixture() {
	return {
		id: 'project-a', revision: 7, sampleRate: 48_000,
		selection: { startFrame: 1_000, endFrame: 9_000 },
		tracks: [{ id: 'voice', type: 'audio' }, { id: 'labels', type: 'label' }],
	};
}

function controllerFixture(
	initialProject: ReturnType<typeof projectFixture>,
	vamp?: Readonly<{
		list(): Promise<unknown>;
		analyze(input: SoundscaperVampAnalysisInput, signal: AbortSignal): Promise<unknown>;
	}>,
) {
	const commands: unknown[] = [];
	return {
		project: initialProject as Readonly<Record<string, unknown>>,
		commands,
		actions: {
			analysis: { vamp },
			edit: {
				commit(command: unknown) { commands.push(command); },
			},
		},
	};
}

function analyzerFixture() {
	return {
		analyzerId: 'installed-onsets', stableId: 'example:onsets', binarySha256: BINARY_SHA256,
		name: 'Percussion Onsets', maker: 'Example', programs: [], parameters: [],
		outputs: [{
			id: 'onsets', name: 'Onsets', description: 'Detected onsets', unit: '',
			sampleType: 'variable-sample-rate', sampleRate: null, hasDuration: false,
		}],
	};
}

function requestFixture(scope: 'track' | 'master'): VampAnalysisRequest {
	return {
		schemaVersion: 1, analyzerId: 'installed-onsets', stableId: 'example:onsets',
		binarySha256: BINARY_SHA256, outputId: 'onsets', program: null, parameters: [], scope,
		startFrame: 1_000, endFrame: 9_000, sampleRate: 48_000,
	};
}

function resultFixture(request: VampAnalysisRequest): Readonly<VampAnalysisResult> {
	return {
		schemaVersion: 1, request,
		features: [{
			timestamp: { seconds: 0, nanoseconds: 100_000_000 }, duration: null,
			values: [0.8], label: 'Kick',
		}],
	};
}
