/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	assistanceWorkflowModelBindingsSha256V1,
	assistanceWorkflowRecipeSha256V1,
	type AssistanceWorkflowV1,
} from '../src/common/editor/assistance/workflow.ts';
import {
	assistanceWorkflowSettingsSha256V1,
	defaultAssistanceWorkflowSettingsV1,
} from '../src/common/editor/assistance/workflow-settings-v1.ts';
import {
	createLocalAssistancePreparationRuntime,
} from '../src/common/editor/controller/local-assistance-runtime.ts';
import {
	resolveLocalAssistanceSelectedMediaAuthority,
} from '../src/common/editor/controller/local-assistance-selected-media.ts';
import { AssistanceDerivativeRepository } from
	'../src/common/editor/storage/assistance-derivative-repository.ts';
import { getMemoryDatabase } from '../src/common/editor/storage/memory-backend.ts';
import type { StorageRepositoryPort } from '../src/common/editor/storage/repository-port.ts';

const JOB_ID = '01'.repeat(20);
const MODEL_SHA256 = '34'.repeat(32);
const MEDIA_TYPE = 'application/vnd.soundscaper.audio-tags+json';

test('Guided reaction acceptance publishes labels before retaining authenticated PANNs scores', async () => {
	const project = audioProject();
	const authority = resolveLocalAssistanceSelectedMediaAuthority({
		getProject: () => project,
		getSelectedClipId: () => 'voice-clip',
		captureProject: () => null,
		assertProject: () => undefined,
		renderDryTrackRange: async () => [],
	});
	const workflow = reactionWorkflow(authority.fence);
	const terminal = workflow.outputs.find(({ slotId }) => slotId === 'reaction-ranges')!;
	const semantic = reactionRanges();
	const terminalBody = new Blob([JSON.stringify(semantic)], {
		type: 'application/vnd.soundscaper.reaction-ranges+json',
	});
	const repository = derivativeRepository();
	const commands: unknown[] = [];
	const save = repository.save.bind(repository);
	repository.save = async (...args: Parameters<typeof repository.save>) => {
		assert.equal(commands.length, 1, 'disposable retention follows canonical publication');
		return save(...args);
	};
	const runtime = createLocalAssistancePreparationRuntime({
		assistanceStore: inertAssistanceStore(),
		assistanceDerivativeRepository: repository,
		createId: (prefix) => `${prefix}1`,
		preflightStorage: async () => undefined,
		getProject: () => project,
		getSelectedClipId: () => 'voice-clip',
		captureProject: () => ({ id: project.id, revision: project.revision }),
		assertProject: (token) => assert.deepEqual(token,
			{ id: project.id, revision: project.revision }),
		renderDryTrackRange: async () => [new Float32Array(48_000)],
		commit: (command) => {
			commands.push(command);
			project.revision += 1;
		},
	});
	const result = await runtime.acceptGuidedWorkflowResult({
		workflow,
		reviewedResult: {
			reviewVersion: 1,
			jobId: JOB_ID,
			workflowId: 'mark-reactions',
			outputs: [{ stageId: terminal.stageId, slotId: terminal.slotId, claim: terminal,
				mediaType: terminalBody.type, byteLength: terminalBody.size, sha256: '56'.repeat(32),
				body: terminalBody, semantic }],
			choices: [{ id: semantic.ranges[0]!.id, kind: 'reaction', label: 'Reaction range 1',
				selected: false, enabled: true }],
		},
		selectedChoiceIds: [semantic.ranges[0]!.id],
		readOutput: async ({ claim }) => {
			assert.equal(`${claim.stageId}:${claim.slotId}`, 'tag-reactions:audio-tags');
			return new Blob([JSON.stringify(audioTags())], { type: MEDIA_TYPE });
		},
	});
	assert.deepEqual(result, { outcome: 'accepted', selectedIds: [semantic.ranges[0]!.id] });
	assert.equal(commands.length, 1);
	assert.deepEqual((await repository.listProject(project.id)).map(({ kind }) => kind),
		['audio-tags']);
});

function reactionWorkflow(fence: ReturnType<typeof resolveLocalAssistanceSelectedMediaAuthority>['fence']):
	AssistanceWorkflowV1 {
	const workflowId = 'mark-reactions';
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	const stageIds = ['tag-reactions', 'merge-reaction-ranges'];
	const models = [{ bindingVersion: 1 as const, stageId: 'tag-reactions', slotId: 'audio-tagger',
		modelId: 'panns-cnn10', version: '1.0.0', artifactSha256s: [MODEL_SHA256] }];
	return {
		contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1, settingsVersion: 1,
		settings, stageIds, models,
		inputs: [claim('input', 'tag-reactions', 'audio', 1),
			claim('input', 'merge-reaction-ranges', 'audio-tags', 2)],
		outputs: [claim('output', 'tag-reactions', 'audio-tags', 3),
			claim('output', 'merge-reaction-ranges', 'reaction-ranges', 4)],
		fence: {
			fenceVersion: 1, schemaFamily: fence.schemaFamily, schemaVersion: fence.schemaVersion,
			projectId: fence.projectId,
			revision: fence.revision, sequenceId: fence.sequenceId, transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
			sourceRanges: [{ slotId: 'primary-audio', mediaKind: 'audio', sourceId: fence.sourceId,
				sourceSha256: fence.sourceSha256, sourceSampleRate: 48_000,
				occurrenceIds: fence.occurrenceIds, sourceStartFrame: fence.sourceStartFrame,
				sourceEndFrame: fence.sourceEndFrame,
				linkMembershipSha256: fence.linkMembershipSha256,
				timingAuthoritySha256: fence.timingAuthoritySha256, retimeKind: 'identity' }],
		},
	};
}

function audioProject() {
	return {
		id: 'project-a', schemaFamily: 'framescaper', schemaVersion: 1,
		revision: 8, sampleRate: 48_000,
		primarySequenceId: 'sequence-a',
		selection: { startFrame: 0, endFrame: 48_000, clipIds: ['voice-clip'],
			trackIds: ['voice-track'] },
		sources: [{ id: 'source-a', name: 'Interview', kind: 'audio',
			contentSha256: '12'.repeat(32), sampleRate: 48_000, frameCount: 96_000 }],
		clips: [{ id: 'voice-clip', title: 'Interview', kind: 'audio', sourceId: 'source-a',
			sequenceId: 'sequence-a', timelineStartFrame: 0, durationFrames: 48_000,
			sourceStartFrame: 0, sourceDurationFrames: 48_000, reversed: false, speedRatio: 1,
			pitchCents: 0, stretchToTempo: false, anchor: 'sample', warpMap: null, avLinkId: null }],
		tracks: [{ id: 'voice-track', type: 'audio', name: 'Voice', clipIds: ['voice-clip'] }],
	};
}

function reactionRanges() {
	return { schemaVersion: 1, kind: 'reaction-ranges' as const, sampleRate: 32_000,
		threshold: 0.5, ranges: [{ id: 'reaction:laughter:0:32000', kind: 'reaction' as const,
			label: 'Laughter', startSample: 0, endSample: 32_000, score: 0.75,
			selected: false as const }] };
}

function audioTags() {
	return { schemaVersion: 1, sampleRate: 32_000, windowSamples: 32_000,
		windows: [{ startSample: 0,
			scores: { laughter: 0.75, applause: 0.1, cheering: 0 } }] };
}

function derivativeRepository(): AssistanceDerivativeRepository {
	const memory = getMemoryDatabase(`guided-runtime-reactions-${String(Date.now())}`);
	const port: StorageRepositoryPort = { memory, database: async () => null };
	return new AssistanceDerivativeRepository(port);
}

function inertAssistanceStore() {
	return {
		getMediaAssetMetadata: async () => null,
		loadMediaAsset: async () => null,
		beginMediaAssetWrite: async () => { throw new Error('not reached'); },
		beginSourceWrite: async () => { throw new Error('not reached'); },
		deleteSource: async () => undefined,
	};
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction,
	stageId: string,
	slotId: string,
	index: number,
) {
	return { claimVersion: 1 as const, direction, claimId: index.toString(16).padStart(40, '0'),
		jobId: JOB_ID, stageId, slotId };
}
