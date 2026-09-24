/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand, CommandObject } from '../../../../commands/protocol.ts';
import { createAudioSource } from '../../../../project-media-factory.ts';
import { createNonImportedSourceProvenance } from '../../../../source-provenance-root.ts';
import { createTakeCompDocumentGroupsV17, type TakeCompDocumentGroup } from '../../../../take-comp-document-v17.ts';
import { normalizeCompRegionId } from '../../../../take-comp-domain.ts';
import type { TakeCycleProjectPreparationOperation, TakeCyclePublicationDescriptor } from '../../take-cycle-recording-service.ts';
import type { TakeCycleProjectDocument } from './take-cycle-project-document.ts';

interface TakeCycleLaneTarget {
	readonly sequenceId: string;
	readonly trackId: string;
}

interface PreparedSource {
	readonly publication: TakeCyclePublicationDescriptor;
	readonly description: Readonly<{
		readonly name: string;
		readonly recordingDeviceLabel?: string;
		readonly sampleRate: number;
		readonly channelCount: number;
		readonly chunkFrames: number;
		readonly frameCount: number;
	}>;
}

export function projectCommand(
	base: TakeCycleProjectDocument,
	operation: TakeCycleProjectPreparationOperation,
	target: TakeCycleLaneTarget,
	sources: readonly PreparedSource[],
	regionIdValue: string,
): AudioEditorCommand {
	const track = base.tracks.find(({ id }) => id === target.trackId);
	const sequence = base.sequences.find(({ id }) => id === target.sequenceId);
	if (!track || track.type !== 'audio') throw new ReferenceError(`Unknown take cycle audio track: ${target.trackId}.`);
	if (!sequence || !sequence.trackIds.includes(target.trackId)) {
		throw new ReferenceError(`Take cycle track ${target.trackId} does not belong to sequence ${target.sequenceId}.`);
	}
	const sourceCommands = sources.map(({ publication, description }) => ({
		type: 'source/add' as const,
		source: commandObject(createAudioSource({
			id: publication.mediaId,
			storageKey: publication.mediaId,
			name: description.name,
			mimeType: 'audio/wav',
			frameCount: description.frameCount,
			channelCount: description.channelCount,
			sampleRate: description.sampleRate,
			originalSampleRate: description.sampleRate,
			sampleFormat: 'float32',
			chunkFrames: description.chunkFrames,
			provenance: createNonImportedSourceProvenance('recorded', {
				recordingDeviceLabel: description.recordingDeviceLabel,
			}),
		})),
	}));
	const takes = operation.plan.passes.map((pass, index) => ({
		id: pass.takeId,
		laneId: pass.laneId,
		sourceId: sources[index]!.publication.mediaId,
		startSample: pass.timelineStartSample,
		endSample: pass.timelineEndSample,
		sourceStartSample: 0,
	}));
	const existing = createTakeCompDocumentGroupsV17(base.takeGroups, base).find(({ id }) => id === operation.plan.groupId);
	let group: TakeCompDocumentGroup;
	let groupCommand: AudioEditorCommand;
	if (existing) {
		if (existing.sequenceId !== target.sequenceId || existing.trackId !== target.trackId
			|| existing.startSample !== operation.plan.loopStartSample
			|| existing.endSample !== operation.plan.loopEndSample) {
			throw new Error('Take cycle lane does not match its existing group ownership and extent.');
		}
		const repeatedLaneId = operation.plan.laneIds.find((laneId) => (
			existing.lanes.some(({ id }) => id === laneId)
		));
		if (repeatedLaneId) {
			throw new Error(`Take cycle lane ${repeatedLaneId} already exists.`);
		}
		group = {
			...existing,
			laneOrder: [...existing.laneOrder, ...operation.plan.laneIds],
			lanes: [...existing.lanes, ...operation.plan.laneIds.map((id) => ({ id }))],
			takes: [...existing.takes, ...takes],
		};
		groupCommand = {
			type: 'take-comp/group-update', groupId: existing.id, group: commandObject(group),
		};
	} else {
		const first = takes[0]!;
		group = {
			id: operation.plan.groupId,
			sequenceId: target.sequenceId,
			trackId: target.trackId,
			startSample: operation.plan.loopStartSample,
			endSample: operation.plan.loopEndSample,
			laneOrder: [...operation.plan.laneIds],
			lanes: operation.plan.laneIds.map((id) => ({ id })),
			takes,
			compRegions: [{
				id: normalizeCompRegionId(regionIdValue),
				takeId: first.id,
				startSample: first.startSample,
				endSample: first.endSample,
			}],
		};
		groupCommand = { type: 'take-comp/group-add', group: commandObject(group) };
	}
	return { type: 'batch', commands: [...sourceCommands, groupCommand] };
}

function commandObject(value: object): CommandObject {
	return value as unknown as CommandObject;
}
