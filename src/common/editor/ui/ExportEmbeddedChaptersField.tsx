/* SPDX-License-Identifier: AGPL-3.0-only */

import EditorHelpTooltip from './EditorHelpTooltip.tsx';
import PreferenceCheckbox from './EditorPreferenceCheckbox.tsx';
import { exportDialogHasChapterLabels, exportDialogSupportsEmbeddedChapters } from './export-dialog-embedded-chapters.ts';

interface ExportEmbeddedChaptersFieldProps {
	readonly copy: Readonly<{
		embedLabelChapters: string;
		embedLabelChaptersHint: string;
		embedLabelChaptersNoLabels: string;
		helpMenu: string;
	}>;
	readonly settings: Readonly<Record<string, unknown>>;
	readonly desktop: boolean;
	readonly project: unknown;
	readonly exporting: boolean;
	readonly onChange: (name: string, value: boolean) => void;
}

/** The menu-opened export dialog is the opt-in entry point for chapter metadata. */
export default function ExportEmbeddedChaptersField({
	copy, settings, desktop, project, exporting, onChange,
}: ExportEmbeddedChaptersFieldProps) {
	if (!exportDialogSupportsEmbeddedChapters(settings, desktop)) return null;
	const hasLabels = exportDialogHasChapterLabels(project);
	return <>
		<div className="audio-editor-export-check" data-export-field="embedLabelChapters">
			<span aria-hidden="true" />
			<span className="audio-editor-help-label">
				<PreferenceCheckbox
					label={copy.embedLabelChapters}
					checked={settings.embedLabelChapters === true}
					disabled={exporting || !hasLabels}
					onChange={(checked) => onChange('embedLabelChapters', checked)}
				/>
				<EditorHelpTooltip subject={copy.embedLabelChapters} description={copy.embedLabelChaptersHint} helpLabel={copy.helpMenu} hook="embedLabelChapters" />
			</span>
		</div>
		{!hasLabels && <p className="audio-editor-panel-hint" data-export-chapters-hint>{copy.embedLabelChaptersNoLabels}</p>}
	</>;
}
