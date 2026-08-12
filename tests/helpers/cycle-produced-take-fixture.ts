/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorProjectCurrent } from '../../src/common/editor/project-current.ts';
import type { AudioEditorCommand } from '../../src/common/editor/commands/protocol.ts';
import {
	createTakeCycleRecordingRepositoryComposition,
	type TakeCyclePublishedProject,
} from '../../src/common/editor/controller/take-cycle-recording-repository-composition.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../../src/common/editor/controller/lifecycle.ts';
import type { TakeCyclePassOperation } from '../../src/common/editor/controller/take-cycle-recording-service.ts';
import { createEditorHistory, executeEditorCommand } from '../../src/common/editor/history.js';
import { createAudioTrackV10 } from '../../src/common/editor/project-v10.ts';
import { createAudioEditorProjectV17, type AudioEditorProjectV17 } from '../../src/common/editor/project-v17.ts';
import { createScapeDigest, scapeHex } from '../../src/common/editor/scape-archive-media.ts';
import { serializeScapeProjectDocument } from '../../src/common/editor/scape-project-document.ts';
import { createProjectStore, type AudioEditorProjectStore } from '../../src/common/editor/storage.js';
import type { ProjectRepositoryPort } from '../../src/common/editor/storage/project-repository.ts';
import type { TakeCycleRecoveryEnvelopeRepository } from '../../src/common/editor/storage/take-cycle-recovery-envelope-repository.ts';
import type { SourceRepository } from '../../src/common/editor/storage/source-repository.ts';
import { packPlanarFloat32 } from '../../src/common/editor/wavpack/pcm.js';

const NOW = '2026-08-12T12:00:00.000Z';
const PROJECT_ID = 'cycle-produced-cross-product-project';
const TRACK_ID = 'cycle-produced-vocal-track';
const SEQUENCE_ID = 'cycle-produced-main-sequence';
const GROUP_ID = 'cycle-produced-group';
const CHANNELS = Object.freeze([
	Object.freeze([0.125, -0.25, 0.5, -1, 0.75, -0.5, 0.25, 0]),
	Object.freeze([-0.375, 0.625, -0.875, 1, -0.125, 0.5, -0.75, 0.25]),
]);

export interface CycleProducedAudioSource extends Readonly<Record<string, unknown>> {
	readonly id: string;
	readonly kind: 'audio';
	readonly storageKey: string;
	readonly name: string;
	readonly mimeType: string;
	readonly frameCount: number;
	readonly channelCount: number;
	readonly sampleRate: number;
	readonly chunkFrames: number;
}

export interface CycleProducedPcm {
	readonly source: CycleProducedAudioSource;
	readonly channels: readonly (readonly number[])[];
}

export interface CycleProducedTakeFixture {
	readonly project: AudioEditorProjectCurrent;
	readonly pcm: readonly CycleProducedPcm[];
	readonly store: AudioEditorProjectStore;
	readonly productionPath: 'finalize' | 'recovery';
}

/** Build a current take project through the durable repository finalizer or its restart replay. */
export async function createCycleProducedTakeFixture(
	productionPath: 'finalize' | 'recovery' = 'finalize',
): Promise<CycleProducedTakeFixture> {
	const store = createProjectStore({
		indexedDB: null,
		preferOpfs: false,
		databaseName: uniqueName(`cycle-produced-${productionPath}`),
	});
	try {
		const projects = store.projectRepository as ProjectRepositoryPort;
		const sources = store.sourceRepository as SourceRepository;
		const recovery = store.takeCycleRecoveryEnvelopeRepository as TakeCycleRecoveryEnvelopeRepository;
		const base = createAudioEditorProjectV17({
			id: PROJECT_ID,
			title: 'Cycle-produced cross-product project',
			now: NOW,
			sampleRate: 48_000,
			tracks: [createAudioTrackV10({ id: TRACK_ID, name: 'Cycle vocal', clipIds: [] })],
			sequences: [{ id: SEQUENCE_ID, trackIds: [TRACK_ID] }],
			primarySequenceId: SEQUENCE_ID,
		});
		await projects.save(base);
		const lifetime = new EditorControllerLifetime();
		lifetime.markReady();
		const generation = new EditorProjectGeneration();
		generation.activate(base.id);
		let history = createEditorHistory(base);
		const publication = (value: TakeCyclePublishedProject): void => {
			if (!value.command) {
				history = createEditorHistory(value.target);
				return;
			}
			if (serializeScapeProjectDocument(history.present) !== serializeScapeProjectDocument(value.base)) {
				throw new Error('Cycle fixture history lost its exact publication base.');
			}
			history = executeEditorCommand(history, value.command as AudioEditorCommand, { now: NOW });
		};
		const composition = createComposition({
			lifetime, generation, projects, sources, recovery, publishCurrentProject: publication,
		});
		if (productionPath === 'finalize') {
			await composition.finalize(finalizationRequest());
		} else {
			const processLoss = new AbortController();
			const interrupted = createComposition({
				lifetime, generation, projects: failProjectPublication(projects, processLoss), sources, recovery,
				publishCurrentProject: publication,
			});
			await interrupted.finalize(finalizationRequest(), { signal: processLoss.signal }).then(
				() => { throw new Error('The interrupted cycle fixture unexpectedly published.'); },
				(error: unknown) => {
					if (!/simulated process loss/u.test(String(error))) throw error;
				},
			);
			const envelope = await recovery.load(PROJECT_ID);
			if (!envelope || envelope.state !== 'published') {
				throw new Error(`The interrupted cycle fixture retained ${String(envelope?.state)} envelope state.`);
			}
			const restartedLifetime = new EditorControllerLifetime();
			restartedLifetime.markReady();
			const restartedGeneration = new EditorProjectGeneration();
			restartedGeneration.activate(PROJECT_ID);
			const restarted = createComposition({
				lifetime: restartedLifetime,
				generation: restartedGeneration,
				projects,
				sources,
				recovery,
				publishCurrentProject: publication,
				readPassChunks: () => { throw new Error('Restart replay must not reread capture PCM.'); },
			});
			await restarted.recover({ currentGeneration: 7, decision: 'recover' });
		}
		const project = await projects.load(PROJECT_ID) as AudioEditorProjectV17 | null;
		if (!project || project.takeGroups[0]?.laneOrder.length !== 2 || project.sources.length !== 2) {
			throw new Error('The cycle fixture did not publish two ordered take lanes.');
		}
		if (history.undoStack.length !== (productionPath === 'finalize' ? 1 : 0)) {
			throw new Error('The cycle fixture published unexpected history semantics.');
		}
		return Object.freeze({
			project,
			pcm: Object.freeze(project.sources.map((source, index) => Object.freeze({
				source: source as CycleProducedAudioSource,
				channels: Object.freeze([CHANNELS[index]!]),
			}))),
			store,
			productionPath,
		});
	} catch (error) {
		await store.close();
		throw error;
	}
}

interface CompositionInput {
	readonly lifetime: EditorControllerLifetime;
	readonly generation: EditorProjectGeneration;
	readonly projects: ProjectRepositoryPort;
	readonly sources: SourceRepository;
	readonly recovery: TakeCycleRecoveryEnvelopeRepository;
	readonly publishCurrentProject: (publication: TakeCyclePublishedProject) => void;
	readonly readPassChunks?: (operation: TakeCyclePassOperation) => AsyncIterable<readonly Float32Array[]>;
}

function createComposition(input: CompositionInput) {
	return createTakeCycleRecordingRepositoryComposition({
		lifetime: input.lifetime,
		recoveryRepository: input.recovery,
		projects: input.projects,
		sources: input.sources,
		captureProject: () => input.generation.capture(),
		assertProject: (token) => input.generation.assertCurrent(token),
		resolveLaneTarget: () => ({ sequenceId: SEQUENCE_ID, trackId: TRACK_ID }),
		describeSource: () => ({
			name: 'Cycle take', sampleRate: 48_000, channelCount: 1, chunkFrames: 8, frameCount: 8,
		}),
		readPassChunks: input.readPassChunks ?? ((operation) => oneChunk(CHANNELS[operation.entryIndex]!)),
		createCompRegionId: () => 'cycle-produced-comp-region',
		publishCurrentProject: input.publishCurrentProject,
		now: () => NOW,
	});
}

function finalizationRequest() {
	return {
		publicationGeneration: 7,
		lanes: [{
			envelopeId: 'cycle-produced-envelope',
			groupId: GROUP_ID,
			laneId: 'cycle-produced-lane-a',
			loopStartSample: 96,
			loopEndSample: 104,
			captureSpans: [{ startSample: 96, endSample: 112 }],
			interrupted: false,
			publications: CHANNELS.map((channels, index) => ({
				journalId: `cycle-produced-journal-${String(index)}`,
				laneId: `cycle-produced-lane-${index === 0 ? 'a' : 'b'}`,
				takeId: `cycle-produced-take-${index === 0 ? 'a' : 'b'}`,
				mediaId: `cycle-produced-source-${index === 0 ? 'a' : 'b'}`,
				...pcmEvidence(channels),
			})),
		}],
	};
}

function failProjectPublication(
	projects: ProjectRepositoryPort,
	processLoss: AbortController,
): ProjectRepositoryPort {
	return {
		createIfAbsent: projects.createIfAbsent?.bind(projects),
		save: projects.save.bind(projects),
		async saveIfCurrent() {
			processLoss.abort(new DOMException('simulated process loss', 'AbortError'));
			throw processLoss.signal.reason;
		},
		maintainCurrentProject: projects.maintainCurrentProject?.bind(projects),
		load: projects.load.bind(projects),
		list: projects.list.bind(projects),
		listRevisions: projects.listRevisions.bind(projects),
		deleteIfCurrent: projects.deleteIfCurrent?.bind(projects),
		delete: projects.delete.bind(projects),
	};
}

async function* oneChunk(channels: readonly number[]): AsyncIterable<readonly Float32Array[]> {
	yield Object.freeze([Float32Array.from(channels)]);
}

function pcmEvidence(channels: readonly number[]): Readonly<{ byteLength: number; sha256: string }> {
	const digest = createScapeDigest();
	const header = new Uint8Array(4);
	new DataView(header.buffer).setUint32(0, channels.length, true);
	const payload = new Uint8Array(packPlanarFloat32([Float32Array.from(channels)]));
	digest.update(header);
	digest.update(payload);
	return Object.freeze({ byteLength: header.byteLength + payload.byteLength, sha256: scapeHex(digest.digest()) });
}

function uniqueName(prefix: string): string {
	return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
