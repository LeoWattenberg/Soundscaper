/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useRef, useSyncExternalStore } from 'react';

import {
	dismissStaleBuild,
	reloadStaleBuild,
	staleBuildSnapshot,
	subscribeStaleBuild,
} from '../offline/stale-build-runtime.ts';

/**
 * The prompt a tab shows once it has proved the origin retired its build.
 *
 * It is deliberately plain. Everything this dialog could reuse - the editor
 * dialog shell, the design system, the resolved translation catalog - lives in
 * a chunk that may be exactly what failed to load, so the component depends on
 * nothing but React, the eagerly bundled site copy, and `site.css`. For the same
 * reason it is mounted by the site shell rather than the editor: it has to
 * survive an editor that could not mount at all.
 */
export default function StaleBuildDialog({ copy }) {
	const snapshot = useSyncExternalStore(subscribeStaleBuild, staleBuildSnapshot, staleBuildSnapshot);
	const reloadButton = useRef(null);
	const surface = useRef(null);
	const open = snapshot.prompting || snapshot.status === 'reloading';

	useEffect(() => {
		if (!open) return undefined;
		reloadButton.current?.focus();
		const onKeyDown = (event) => {
			if (event.key === 'Escape') {
				event.preventDefault();
				dismissStaleBuild();
				return;
			}
			if (event.key !== 'Tab') return;
			const focusable = Array.from(surface.current?.querySelectorAll('button') ?? []);
			if (focusable.length === 0) return;
			const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
			if (document.activeElement !== edge) return;
			event.preventDefault();
			(event.shiftKey ? focusable[focusable.length - 1] : focusable[0]).focus();
		};
		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [open]);

	if (!open) return null;
	const reloading = snapshot.status === 'reloading';
	return (
		<div className="stale-build-overlay" data-stale-build-overlay>
			<div
				ref={surface}
				className="stale-build-dialog"
				role="alertdialog"
				aria-modal="true"
				aria-labelledby="stale-build-title"
				aria-describedby="stale-build-message"
			>
				<h2 id="stale-build-title">{copy.staleBuildTitle}</h2>
				<p id="stale-build-message">{copy.staleBuildMessage}</p>
				<div className="stale-build-actions">
					<button type="button" onClick={() => dismissStaleBuild()} disabled={reloading}>
						{copy.staleBuildCancel}
					</button>
					<button
						ref={reloadButton}
						type="button"
						className="stale-build-confirm"
						data-stale-build-reload
						disabled={reloading}
						onClick={() => { void reloadStaleBuild(); }}
					>
						{copy.staleBuildReload}
					</button>
				</div>
			</div>
		</div>
	);
}
