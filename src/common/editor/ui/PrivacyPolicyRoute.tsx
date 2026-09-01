/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CSSProperties } from 'react';

import { DesignSystemProviders, useAudioEditorThemeVariables } from './DesignSystemRuntime.jsx';
import PrivacyPolicyDialog from './dialogs/PrivacyPolicyDialog.tsx';
import './audio-editor-design-system.css';

export interface PrivacyPolicyRouteProps {
	readonly locale: string;
	readonly copy: Readonly<Record<string, unknown>>;
	readonly onClose: () => void;
}

export default function PrivacyPolicyRoute({ locale, copy, onClose }: PrivacyPolicyRouteProps) {
	return <DesignSystemProviders copy={copy}>
		<PrivacyPolicyRouteFrame locale={locale} onClose={onClose} />
	</DesignSystemProviders>;
}

function PrivacyPolicyRouteFrame({ locale, onClose }: Omit<PrivacyPolicyRouteProps, 'copy'>) {
	const themeVariables = useAudioEditorThemeVariables() as CSSProperties;
	return <div
		id="kw-audio-editor-design-system"
		className="kw-audio-editor-privacy-policy-route"
		data-privacy-policy-route="true"
		style={themeVariables}
	>
		<PrivacyPolicyDialog locale={locale} onClose={onClose} />
	</div>;
}
