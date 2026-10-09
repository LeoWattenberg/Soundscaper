/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { exportClipsRequireUnfreeze } from '../../export-clip-boundaries.ts';

interface ExportOutputHintsProps {
	readonly copy: Readonly<Record<string, string>>;
	readonly project: unknown;
	readonly noLabelsHint: string | null;
	readonly singleFileOnly?: boolean;
}

export default function ExportOutputHints({ copy, project, noLabelsHint, singleFileOnly = false }: ExportOutputHintsProps) {
	return <>
		{noLabelsHint && <p className="audio-editor-panel-hint" data-export-no-labels>{noLabelsHint}</p>}
		{!singleFileOnly && exportClipsRequireUnfreeze(project) && <p className="audio-editor-panel-hint" data-export-clips-unavailable>
			{copy.exportOutputClipsFrozen}
		</p>}
	</>;
}
