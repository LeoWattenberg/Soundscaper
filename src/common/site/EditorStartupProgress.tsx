/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useSyncExternalStore } from 'react';

import { bundledSiteCopyForLocale } from '../i18n/site-copy.js';
import { createEditorStartupProgressStore, editorStartupProgress } from './editor-startup-progress.ts';

export interface EditorStartupProgressProps {
	readonly copy?: Readonly<Record<string, unknown>>;
	readonly locale?: string;
	readonly store?: ReturnType<typeof createEditorStartupProgressStore>;
}

/** The site and both product bootstraps share one measured startup indicator. */
export function EditorStartupProgress({ copy, locale, store = editorStartupProgress }: EditorStartupProgressProps) {
	const snapshot = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot,
	);
	useEffect(() => {
		document.documentElement.querySelector('[data-initial-load-progress]')?.remove();
	}, []);
	const bundled = bundledSiteCopyForLocale(locale ?? (typeof document === 'undefined' ? 'en' : document.documentElement.lang));
	const loading = siteText(copy, 'loadingEditorFiles', bundled.loadingEditorFiles);
	const preparing = siteText(copy, 'preparingEditor', bundled.preparingEditor);
	const hasPercent = snapshot.phase === 'loading' && snapshot.percent !== null;
	const label = snapshot.phase === 'preparing' ? preparing : loading;
	return (
		<div className="website-editor-loading" data-editor-startup-progress>
			<div className="website-editor-loading-heading">
				<span aria-live="polite">{label}</span>
				{hasPercent && <strong>{snapshot.percent}%</strong>}
			</div>
			<progress
				max={100}
				{...(hasPercent ? { value: snapshot.percent, 'aria-valuenow': snapshot.percent } : {})}
				aria-label={label}
			/>
		</div>
	);
}

function siteText(copy: Readonly<Record<string, unknown>> | undefined, key: string, fallback: string): string {
	return typeof copy?.[key] === 'string' ? copy[key] as string : fallback;
}
