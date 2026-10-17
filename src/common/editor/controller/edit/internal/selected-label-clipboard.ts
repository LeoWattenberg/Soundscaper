/* SPDX-License-Identifier: AGPL-3.0-only */

import { normalizeLabelClipboardDescriptor, type LabelClipboardDescriptor } from '../../../commands/label-clipboard-codec.ts';
import type { AudioEditorClipboard, AudioEditorCommand } from '../../../commands/protocol.ts';
import { isRecord, labelClipboardTarget, selectedLabelsForProject, type SelectedLabelState } from '../../../label-clipboard-selection.ts';
import { scaleSampleFrame, type HoldTempoMap } from '../../../timeline-time.ts';
import { sampleFrameToBeat } from '../../../timeline-tempo-inverse.ts';
import { setLocalizedStatus } from '../../../../i18n/presentation-message.ts';

interface State extends SelectedLabelState {
	clipboard: AudioEditorClipboard | null;
	selectedTrackId: string | null;
	selectedClipId: string | null;
	selectedAnnotationId?: string | null;
}

interface Dependencies {
	readonly state: State;
	getProject(): unknown;
	getPositionFrames(): number;
	createId(prefix: string): string;
	updateSelection(command: AudioEditorCommand): unknown;
	commit(command: AudioEditorCommand, selection?: { selectTrackId: string; selectClipId: null }): unknown;
	prepareClipboard(descriptor: AudioEditorClipboard): () => unknown;
	publish(): void;
	readonly copy: Readonly<{ labelTrackMissing: string }>;
	setStatus(message: string, state?: string, localization?: import('../../../../i18n/presentation-message.ts').LocalizedPresentationMessage): void;
}

const CUT_ACTIONS = new Set(['cut', 'cut-leave-gap', 'cut-per-clip-ripple', 'cut-per-track-ripple', 'cut-all-tracks-ripple']);
const PASTE_ACTIONS = new Set(['paste', 'paste-overlap', 'paste-insert', 'paste-all-tracks-ripple']);

/** Selected labels precede media/range clipboard edits; every mutation still enters native admission. */
export function createSelectedLabelClipboardService(d: Dependencies) {
	return Object.freeze({ select, handle });

	function select(trackId: string, labelId: string | null, options: { additive?: boolean } = {}) {
		const project = requireProject();
		if (labelId === null) {
			d.state.selectedLabels = [];
			d.state.selectedLabelsProjectId = project.id;
			d.publish();
			return [];
		}
		const label = readLabel(project, trackId, labelId);
		if (!label) throw new ReferenceError(`Unknown label selection: ${labelId}.`);
		const previous = options.additive ? selectedLabelsForProject(project, d.state) : [];
		const refs = previous.some(ref => ref.trackId === trackId && ref.labelId === labelId)
			? previous : [...previous, { trackId, labelId }];
		d.state.selectedTrackId = trackId;
		d.state.selectedClipId = null;
		d.state.selectedAnnotationId = null;
		d.updateSelection({ type: 'selection/set', startFrame: label.startFrame, endFrame: label.endFrame,
			trackIds: [trackId], clipIds: [], frequencyRange: null });
		d.state.selectedLabelsProjectId = project.id;
		d.state.selectedLabels = refs;
		d.publish();
		return refs;
	}

	function handle(action: string): boolean {
		const paste = PASTE_ACTIONS.has(action);
		if (action !== 'copy' && !CUT_ACTIONS.has(action) && !paste) return false;
		if (paste ? d.state.clipboard?.schemaVersion !== 7 : !d.state.selectedLabels?.length) return false;
		const project = requireProject();
		const refs = paste ? [] : selectedLabelsForProject(project, d.state);
		if (refs.length && (action === 'copy' || CUT_ACTIONS.has(action))) {
			const labels = refs.map(ref => readLabel(project, ref.trackId, ref.labelId)!);
			const first = labels.reduce((frame, label) => Math.min(frame, label.startFrame), Number.MAX_SAFE_INTEGER);
			const last = labels.reduce((frame, label) => Math.max(frame, label.endFrame), 0);
			const descriptor = normalizeLabelClipboardDescriptor({ schemaVersion: 7, sampleRate: project.sampleRate,
				durationFrames: Math.max(1, last - first), tracks: [], annotations: [], takeGroups: [],
				labels: labels.map(label => ({ title: label.title, color: label.color, anchor: label.anchor,
					startOffsetFrame: label.startFrame - first, endOffsetFrame: label.endFrame - first,
					opaqueExtensions: label.opaqueExtensions })),
			});
			const publishClipboard = d.prepareClipboard(descriptor);
			if (action !== 'copy') {
				d.commit({ type: 'batch', commands: refs.map(ref => ({ type: 'label/remove', ...ref })) });
				d.state.selectedLabels = [];
			}
			publishClipboard();
			d.publish();
			return true;
		}
		if (!PASTE_ACTIONS.has(action) || d.state.clipboard?.schemaVersion !== 7) return false;
		const descriptor = normalizeLabelClipboardDescriptor(d.state.clipboard);
		const target = labelClipboardTarget(project, d.state.selectedTrackId);
		if (!target) {
			setLocalizedStatus(d.setStatus, d.copy, 'labelTrackMissing', undefined, 'info');
			return true;
		}
		const labels = pastedLabels(project, descriptor);
		d.commit({ type: 'batch', commands: labels.map(label => ({ type: 'label/add', trackId: target.id, label })) },
			{ selectTrackId: target.id, selectClipId: null });
		d.state.selectedLabelsProjectId = project.id;
		d.state.selectedLabels = labels.map(label => ({ trackId: target.id, labelId: label.id }));
		d.publish();
		return true;
	}

	function pastedLabels(project: Project, descriptor: LabelClipboardDescriptor) {
		const atFrame = nonNegativeFrame(d.getPositionFrames());
		return descriptor.labels.map(label => {
			const startFrame = nonNegativeFrame(atFrame + scaleSampleFrame(label.startOffsetFrame, descriptor.sampleRate, project.sampleRate, 'point'));
			const endFrame = nonNegativeFrame(atFrame + scaleSampleFrame(label.endOffsetFrame, descriptor.sampleRate, project.sampleRate, 'point'));
			const common = { id: d.createId('label'), title: label.title, color: label.color,
				opaqueExtensions: structuredClone(label.opaqueExtensions) };
			if (label.anchor === 'sample') return { ...common, anchor: 'sample' as const, startFrame, endFrame };
			if (!project.tempoMap) throw new TypeError('Musical label paste requires the destination tempo map.');
			return { ...common, anchor: 'musical' as const,
				startBeat: sampleFrameToBeat(startFrame, project.tempoMap, project.sampleRate),
				endBeat: sampleFrameToBeat(endFrame, project.tempoMap, project.sampleRate) };
		});
	}

	function requireProject(): Project {
		const project = d.getProject();
		if (!isRecord(project) || typeof project.id !== 'string' || typeof project.sampleRate !== 'number' || !Array.isArray(project.tracks)) {
			throw new TypeError('A resolved project is required for label clipboard operations.');
		}
		return project as unknown as Project;
	}
}

interface Project {
	readonly id: string;
	readonly sampleRate: number;
	readonly tempoMap?: HoldTempoMap;
	readonly tracks: readonly unknown[];
}

function readLabel(project: Project, trackId: string, labelId: string) {
	const track = project.tracks.find(track => isRecord(track) && track.id === trackId && track.type === 'label');
	if (!isRecord(track) || !Array.isArray(track.labels)) return null;
	const label: unknown = (track.labels as unknown[]).find(label => isRecord(label) && label.id === labelId);
	if (!isRecord(label)) return null;
	return { title: typeof label.title === 'string' ? label.title : '',
		color: typeof label.color === 'string' ? label.color : 'auto',
		anchor: label.anchor === 'musical' ? 'musical' as const : 'sample' as const,
		startFrame: nonNegativeFrame(label.startFrame), endFrame: nonNegativeFrame(label.endFrame),
		opaqueExtensions: isRecord(label.opaqueExtensions) ? label.opaqueExtensions : {} };
}

function nonNegativeFrame(value: unknown): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new RangeError('A label clipboard frame must be a nonnegative safe integer.');
	return value;
}
