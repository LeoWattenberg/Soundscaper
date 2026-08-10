/* SPDX-License-Identifier: AGPL-3.0-only */

import { selectAudioEditorEditBlock } from '../edit-blocking.ts';
import { TimelineAnnotationPanel } from '../timeline/TimelineAnnotationPanel.jsx';
import { useTimelineAnnotationCreateFeedback } from '../timeline/useTimelineAnnotationCreateFeedback.js';

interface TimelineAnnotationWorkspacePanelProps {
	readonly controller: unknown;
	readonly snapshot: Readonly<Record<string, unknown>>;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly run: (action: () => unknown) => unknown;
}

/**
 * Docks the marker and region list beside the other workspace panels. The panel
 * owns its own creation feedback because it mounts outside the timeline, where
 * the ruler lane's announcement region is out of scope.
 */
export default function TimelineAnnotationWorkspacePanel({
	controller,
	snapshot,
	copy,
	locale,
	run,
}: TimelineAnnotationWorkspacePanelProps) {
	const project = snapshot.project as { sampleRate?: number } | null | undefined;
	const sampleRate = project?.sampleRate || 48_000;
	const { createAnnotation, status } = useTimelineAnnotationCreateFeedback({
		controller, copy, locale, sampleRate, run,
	});

	return (
		<div className="kw-audio-editor__markers-panel">
			<TimelineAnnotationPanel
				controller={controller}
				project={project}
				annotations={snapshot.timelineAnnotations || []}
				selectedAnnotationId={snapshot.selectedAnnotationId}
				copy={copy}
				locale={locale}
				sampleRate={sampleRate}
				blocked={selectAudioEditorEditBlock(snapshot).blocked}
				run={run}
				createAnnotation={createAnnotation}
			/>
			<span
				className="kw-audio-editor-sr-only"
				data-timeline-annotation-panel-create-status
				role="status"
				aria-live="polite"
				aria-atomic="true"
			>{status}</span>
		</div>
	);
}
