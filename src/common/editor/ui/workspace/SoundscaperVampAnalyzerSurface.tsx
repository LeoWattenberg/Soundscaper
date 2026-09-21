/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-owned asynchronous catalog shell for the lazy Vamp dialog. */

import React, { useEffect, useMemo, useState } from 'react';

import {
	createSoundscaperVampAnalyzerSession,
} from './soundscaper-vamp-analyzer-runtime.ts';
import { createDesktopVampAnalysisAction } from '../../controller/analysis/internal/vamp-analysis-action.ts';
import type { SoundscaperVampAnalyzerSurfaceInput } from './SoundscaperNativeServicesSurface.tsx';

const VampAnalyzerDialog = React.lazy(() => import('../dialogs/VampAnalyzerDialog.tsx'));

export interface SoundscaperVampAnalyzerSurfaceProps {
	readonly input: Readonly<SoundscaperVampAnalyzerSurfaceInput>;
	readonly onClose: () => void;
}

export default function SoundscaperVampAnalyzerSurface({
	input,
	onClose,
}: Readonly<SoundscaperVampAnalyzerSurfaceProps>) {
	const port = useMemo(() => createDesktopVampAnalysisAction({
		bridge: input.bridge,
		engine: input.engine,
		getProject: () => input.controller.project,
	}), [input.bridge, input.controller, input.engine]);
	const session = useMemo(() => createSoundscaperVampAnalyzerSession({
		controller: input.controller,
		durationFrames: input.durationFrames,
		selectedTrackId: input.selectedTrackId,
		port,
	}), [input, port]);
	const [catalog, setCatalog] = useState<unknown>(Object.freeze([]));
	const [catalogMessage, setCatalogMessage] = useState('Loading enabled Vamp analyzers…');
	useEffect(() => {
		if (session === null) return undefined;
		let active = true;
		void session.loadCatalog().then((value) => {
			if (!active) return;
			setCatalog(value);
			setCatalogMessage('No enabled Vamp analyzers are available.');
		}).catch((error: unknown) => {
			if (!active) return;
			setCatalog(Object.freeze([]));
			setCatalogMessage(error instanceof Error ? error.message : String(error));
		});
		return () => { active = false; };
	}, [session]);
	if (session === null) return null;
	return <React.Suspense fallback={null}>
		<VampAnalyzerDialog
			key={`${session.projectId}:${String(session.projectRevision)}`}
			catalog={catalog}
			projectId={session.projectId}
			scope={session.scope}
			startFrame={session.startFrame}
			endFrame={session.endFrame}
			sampleRate={session.sampleRate}
			analyze={session.analyze}
			publishLabels={session.publishLabels}
			onClose={onClose}
			copy={{ noAnalyzers: catalogMessage }}
		/>
	</React.Suspense>;
}
