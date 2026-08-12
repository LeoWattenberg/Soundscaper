/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../commands/protocol.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';
import type { ControllerProject } from './track-domain-types.ts';
import {
	planTrackAlignment,
	planTrackSort,
	type TrackAlignmentMode,
} from './track-structural-operation-planner.ts';

export interface TrackStructuralOperationServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	getProject(): ControllerProject;
	getSelectedTrackId(): string | null;
	editingBlocked(): boolean;
	getPositionFrames(): number;
	commit(command: AudioEditorCommand): unknown;
}

export interface TrackStructuralOperationService {
	alignEndToEnd(): unknown;
	alignTogether(): unknown;
	alignStartToZero(): unknown;
	alignStartToPlayhead(): unknown;
	alignStartToSelectionEnd(): unknown;
	alignEndToPlayhead(): unknown;
	alignEndToSelectionEnd(): unknown;
	sortByTime(): unknown;
	sortByName(): unknown;
	muteAll(): unknown;
	unmuteAll(): unknown;
}

/** Controller boundary for Audacity-compatible structural track operations. */
export function createTrackStructuralOperationService(
	dependencies: TrackStructuralOperationServiceDependencies,
): Readonly<TrackStructuralOperationService> {
	return Object.freeze({
		alignEndToEnd: () => align('end-to-end'),
		alignTogether: () => align('together'),
		alignStartToZero: () => align('start-zero'),
		alignStartToPlayhead: () => align('start-playhead', () => dependencies.getPositionFrames()),
		alignStartToSelectionEnd: () => align('start-selection-end', selectionEnd),
		alignEndToPlayhead: () => align('end-playhead', () => dependencies.getPositionFrames()),
		alignEndToSelectionEnd: () => align('end-selection-end', selectionEnd),
		sortByTime: () => sort('time'),
		sortByName: () => sort('name'),
		muteAll: () => setAllMuted(true),
		unmuteAll: () => setAllMuted(false),
	});

	function align(
		mode: TrackAlignmentMode,
		target?: number | ((project: ControllerProject) => number),
	): unknown {
		assertWritable();
		const project = dependencies.getProject();
		const selectedTrackId = dependencies.getSelectedTrackId();
		const selectedTrackIds = project.selection?.trackIds?.length
			? project.selection.trackIds
			: selectedTrackId ? [selectedTrackId] : [];
		const targetFrame = typeof target === 'function' ? target(project) : target;
		const plan = planTrackAlignment(project, selectedTrackIds, mode, targetFrame);
		if (plan.transforms.length === 0) return null;
		return dependencies.commit({
			type: 'clip/transform-many', transforms: plan.transforms, overwrite: false,
			splitClipIds: {}, splitAvLinkIds: {}, videoEffectIds: {},
		});
	}

	function sort(criterion: 'time' | 'name'): unknown {
		assertWritable();
		const commands = planTrackSort(dependencies.getProject(), criterion);
		return commands.length === 0 ? null : dependencies.commit({ type: 'batch', commands });
	}

	function setAllMuted(mute: boolean): unknown {
		assertWritable();
		const tracks = dependencies.getProject().tracks.filter((track) => (
			track.type !== 'label' && track.mute !== mute
		));
		if (tracks.length === 0) return null;
		return dependencies.commit({
			type: 'batch',
			commands: tracks.map((track) => ({
				type: 'track/update' as const,
				trackId: track.id,
				changes: { mute },
			})),
		});
	}

	function selectionEnd(project: ControllerProject): number {
		return project.selection?.endFrame ?? dependencies.getPositionFrames();
	}

	function assertWritable(): void {
		dependencies.lifetime.assertActive();
		if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
	}
}
