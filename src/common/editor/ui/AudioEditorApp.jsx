import React, { Suspense, useSyncExternalStore } from 'react';

import { lazyEditorModule } from '../../offline/lazy-module.tsx';
import { reportStaleBuildCandidate } from '../../offline/stale-build-runtime.ts';
import './audio-editor-design-system.css';
import { DesignSystemProviders } from './DesignSystemRuntime.jsx';
import AudioEditorWorkspace from './workspace/AudioEditorWorkspace.jsx';

const MonoConversionConfirmationDialog = lazyEditorModule(
	() => import('./dialogs/MonoConversionConfirmationDialog.tsx'),
);
const DeleteBehaviorOnboardingDialog = lazyEditorModule(
	() => import('./dialogs/DeleteBehaviorOnboardingDialog.tsx'),
);

/** Presentation-only seam for a product-owned, already-constructed runtime. */
export function BoundAudioEditorApp(props) {
	return <AudioEditorFrame copy={props.copy} controller={props.controller}>
		<AudioEditorWorkspace {...props} />
		{props.monoConversionConfirmation && <ConfirmationDialogMount
			Component={MonoConversionConfirmationDialog}
			confirmation={props.monoConversionConfirmation}
			copy={props.copy}
			cancelDecision={{ accepted: false, dontShowAgain: false }}
		/>}
		{props.deleteBehaviorConfirmation && <ConfirmationDialogMount
			Component={DeleteBehaviorOnboardingDialog}
			confirmation={props.deleteBehaviorConfirmation}
			copy={props.copy}
			cancelDecision={{ accepted: false }}
		/>}
	</AudioEditorFrame>;
}

function ConfirmationDialogMount({ Component, confirmation, copy, cancelDecision }) {
	const prompt = useSyncExternalStore(
		confirmation.subscribe,
		confirmation.getSnapshot,
		confirmation.getSnapshot,
	);
	if (!prompt) return null;
	return <Suspense fallback={null}>
		<Component
			confirmation={confirmation}
			copy={copy}
			onClose={() => { confirmation.settle(prompt, cancelDecision); }}
		/>
	</Suspense>;
}

function AudioEditorFrame({ copy, children, controller }) {
	return (
		<AudioEditorErrorBoundary copy={copy}>
			<DesignSystemProviders copy={copy} controller={controller}>
				{children}
			</DesignSystemProviders>
		</AudioEditorErrorBoundary>
	);
}

class AudioEditorErrorBoundary extends React.Component {
	constructor(props) {
		super(props);
		this.state = { error: null };
	}

	static getDerivedStateFromError(error) {
		return { error };
	}

	/**
	 * A chunk that never arrived is reported rather than only rendered.
	 *
	 * Lazily loaded surfaces absorb their own retired chunks in
	 * `lazyEditorModule`, so what reaches this boundary is a load the editor did
	 * not route through it - an eager import of a module the deploy has retired,
	 * for one. The generic message is still what the torn-down editor shows,
	 * because there is nothing left to return to here; the prompt the site shell
	 * raises alongside it is what offers the reload that recovers the tab.
	 */
	componentDidCatch(error) {
		reportStaleBuildCandidate(error);
	}

	render() {
		if (!this.state.error) return this.props.children;
		const message = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
		return (
			<div id="kw-audio-editor-design-system" className="kw-audio-editor-error" role="alert" data-audio-editor-bound="false">
				<strong>{this.props.copy.title}</strong>
				<p>{this.props.copy.genericError.replace('{message}', message)}</p>
			</div>
		);
	}
}
