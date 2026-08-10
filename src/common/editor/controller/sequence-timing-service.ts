/* SPDX-License-Identifier: AGPL-3.0-only */

import { createUpdateSequenceTimingCommand } from '../commands/factories.ts';
import type { AudioEditorCommand, SequenceTimingCommandChanges } from '../commands/protocol.ts';
import {
	snapSampleToSequenceFrame,
	stepSampleBySequenceFrames,
	type SequenceFrameSnapMode,
} from '../sequence-frame-navigation.ts';
import {
	resolveSequenceTimingView,
	sampleAtSequenceTimecodeLabel,
	sequenceTimecodeLabelAtSample,
	type SequenceTimingProject,
	type SequenceTimingView,
} from '../sequence-timing-model.ts';
import type { EditorControllerLifetime } from './lifecycle.ts';

export interface SequenceTimingServiceDependencies {
	readonly lifetime: Pick<EditorControllerLifetime, 'assertActive'>;
	readonly getProject: () => unknown;
	readonly editingBlocked: () => boolean;
	readonly commit: (command: AudioEditorCommand) => unknown;
	readonly publishProjectState: () => void;
	readonly getPositionFrames: () => number;
	readonly seek: (frame: number) => unknown;
}

export interface SequenceTimingService {
	view(sequenceId?: string): SequenceTimingView;
	update(sequenceId: string, changes: SequenceTimingCommandChanges): void;
	label(sample: number, sequenceId?: string): string;
	playheadLabel(sequenceId?: string): string;
	snapSample(sample: number, mode?: SequenceFrameSnapMode, sequenceId?: string): number;
	stepPlayhead(frameDelta: number, sequenceId?: string): number;
	seekLabel(label: string, sequenceId?: string): number;
}

/**
 * Sequence timing for the surfaces that read and write it. Labels and frame
 * navigation are derived on demand from the document's own sequence, so no
 * surface holds a copy of timing that a rate change could leave stale.
 */
export function createSequenceTimingService(
	dependencies: SequenceTimingServiceDependencies,
): Readonly<SequenceTimingService> {
	const project = (): SequenceTimingProject => dependencies.getProject() as SequenceTimingProject;
	const sampleRate = (): number => {
		const rate = Number(project().sampleRate);
		if (!Number.isSafeInteger(rate) || rate <= 0) throw new RangeError('A project sample rate is required.');
		return rate;
	};
	const view = (sequenceId?: string): SequenceTimingView => {
		dependencies.lifetime.assertActive();
		return resolveSequenceTimingView(project(), sequenceId);
	};

	return Object.freeze({
		view,
		update(sequenceId: string, changes: SequenceTimingCommandChanges): void {
			dependencies.lifetime.assertActive();
			if (dependencies.editingBlocked()) throw new RangeError('Editing is blocked.');
			dependencies.commit(createUpdateSequenceTimingCommand(sequenceId, changes));
			dependencies.publishProjectState();
		},
		label(sample: number, sequenceId?: string): string {
			return sequenceTimecodeLabelAtSample(view(sequenceId), sample, sampleRate());
		},
		playheadLabel(sequenceId?: string): string {
			return sequenceTimecodeLabelAtSample(
				view(sequenceId),
				Math.max(0, dependencies.getPositionFrames()),
				sampleRate(),
			);
		},
		snapSample(sample: number, mode: SequenceFrameSnapMode = 'nearest', sequenceId?: string): number {
			return snapSampleToSequenceFrame(sample, view(sequenceId).rate, sampleRate(), mode);
		},
		stepPlayhead(frameDelta: number, sequenceId?: string): number {
			const target = stepSampleBySequenceFrames(
				Math.max(0, dependencies.getPositionFrames()),
				frameDelta,
				view(sequenceId).rate,
				sampleRate(),
			);
			dependencies.seek(target);
			return target;
		},
		seekLabel(label: string, sequenceId?: string): number {
			const target = sampleAtSequenceTimecodeLabel(view(sequenceId), label, sampleRate());
			dependencies.seek(target);
			return target;
		},
	});
}
