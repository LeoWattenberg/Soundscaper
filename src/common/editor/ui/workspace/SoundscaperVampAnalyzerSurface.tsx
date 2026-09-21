/* SPDX-License-Identifier: AGPL-3.0-only */

/** Menu-owned asynchronous catalog shell for the lazy Vamp dialog. */

import React, { useEffect, useState } from 'react';

import type { SoundscaperVampAnalyzerSession } from './soundscaper-vamp-analyzer-runtime.ts';

const VampAnalyzerDialog = React.lazy(() => import('../dialogs/VampAnalyzerDialog.tsx'));

export interface SoundscaperVampAnalyzerSurfaceProps {
	readonly session: Readonly<SoundscaperVampAnalyzerSession>;
	readonly onClose: () => void;
}

export default function SoundscaperVampAnalyzerSurface({
	session,
	onClose,
}: Readonly<SoundscaperVampAnalyzerSurfaceProps>) {
	const [catalog, setCatalog] = useState<unknown>(Object.freeze([]));
	const [catalogMessage, setCatalogMessage] = useState('Loading enabled Vamp analyzers…');
	useEffect(() => {
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
