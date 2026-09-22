/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';
import { resolveLocalModelManagerBridge } from '../local-model-manager-bridge.ts';
import { createTextToSpeechPort, type TextToSpeechProjectPort } from './text-to-speech-port-runtime.ts';
import TextToSpeechDialog from './TextToSpeechDialog.tsx';

export interface TextToSpeechDialogSurfaceProps {
	readonly bridgeScope: unknown;
	readonly projectPort: TextToSpeechProjectPort | null;
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly onClose: () => void;
}

/** Resolve the speech runtime only after its Generate menu entry is opened. */
export default function TextToSpeechDialogSurface({
	bridgeScope, projectPort, ...props
}: TextToSpeechDialogSurfaceProps) {
	const port = useMemo(() => createTextToSpeechPort(bridgeScope, projectPort),
		[bridgeScope, projectPort]);
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(bridgeScope), [bridgeScope]);
	return <TextToSpeechDialog port={port} modelBridge={modelBridge} {...props} />;
}
