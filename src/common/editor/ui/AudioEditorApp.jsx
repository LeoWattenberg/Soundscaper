import React from 'react';

import { DesignSystemProviders } from './DesignSystemRuntime.jsx';
import AudioEditorWorkspace from './workspace/AudioEditorWorkspace.jsx';
import DefaultAudioEditorWorkspace from './workspace/DefaultAudioEditorWorkspace.jsx';
import './audio-editor-design-system.css';

export default function AudioEditorApp(props) {
	return <AudioEditorFrame copy={props.copy}>
		<DefaultAudioEditorWorkspace {...props} />
	</AudioEditorFrame>;
}

/** Presentation-only seam for a product-owned, already-constructed runtime. */
export function BoundAudioEditorApp(props) {
	return <AudioEditorFrame copy={props.copy}>
		<AudioEditorWorkspace {...props} />
	</AudioEditorFrame>;
}

function AudioEditorFrame({ copy, children }) {
	return (
		<AudioEditorErrorBoundary copy={copy}>
			<DesignSystemProviders copy={copy}>
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
