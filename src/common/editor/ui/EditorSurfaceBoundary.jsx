/* SPDX-License-Identifier: AGPL-3.0-only */
import React from 'react';

import { reportStaleBuildCandidate } from '../../offline/stale-build-runtime.ts';

/**
 * A boundary the size of one surface.
 *
 * The editor's root boundary replaces the whole application with an error
 * message, so a document one surface cannot draw — a projection the timeline
 * refuses, a menu the hierarchy cannot answer — used to take the toolbar, the
 * panels and the dialogs down with it. This boundary keeps the failure where it
 * happened: the surface shows the message in its own place, in the same words
 * the root boundary uses, and everything around it keeps working.
 *
 * The message stays until the document changes. A render that failed on one
 * revision may well succeed on the next — an undo, a fix made through another
 * surface — so the boundary retries whenever `resetKey` moves, and never on a
 * re-render alone, which would retry the same failure at every keystroke.
 */
export default class EditorSurfaceBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	componentDidCatch(error) {
		// A retired chunk reaches a surface the same way it reaches the root.
		reportStaleBuildCandidate(error);
	}

	componentDidUpdate(previous) {
		if (this.state.error !== null && previous.resetKey !== this.props.resetKey) {
			// The setState in componentDidUpdate is the documented way to recover a
			// boundary: it only runs when the key moved, so it cannot loop.
			this.setState({ error: null });
		}
	}

	render() {
		if (this.state.error === null) return this.props.children;
		const { copy, surface } = this.props;
		const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
		return (
			<div className="audio-editor-surface-error" role="alert" data-editor-surface-error={surface}>
				<strong>{copy.surfaceRenderFailed}</strong>
				<p>{copy.genericError.replace('{message}', message)}</p>
			</div>
		);
	}
}
