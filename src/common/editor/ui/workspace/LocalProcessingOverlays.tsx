/* SPDX-License-Identifier: AGPL-3.0-only */
import { Suspense } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { assistanceDialogRequest, assistanceTaskLabel } from '../assistance-task-catalog.ts';
import AssistanceLoadingDialog from '../dialogs/AssistanceLoadingDialog.tsx';
import { resolveLocalModelManagerBridge } from '../local-model-manager-availability.ts';
import { AudioEditorListeningGainContext } from '../audio-editor-listening-preview.tsx';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../../assistance/local-assistance-preparation.ts';
import type { TextToSpeechProjectPort } from '../dialogs/text-to-speech-port-runtime.ts';

const LocalModelManagerDialog = lazyEditorModule(() => import('../dialogs/LocalModelManagerDialog.tsx'));
const LocalAssistanceDialog = lazyEditorModule(() => import('../dialogs/LocalAssistanceDialogSurface.tsx'));
const TextToSpeechDialog = lazyEditorModule(() => import('../dialogs/TextToSpeechDialogSurface.tsx'));

export default function LocalProcessingOverlays({ activeSurface, fileService, capabilities, snapshot,
	copy, locale, selectedMediaPreparation, textToSpeechProjectPort, setActiveSurface,
}: {
	readonly activeSurface: string | null;
	readonly fileService: { readonly isDesktop: boolean; readonly bridge?: unknown };
	readonly capabilities: { readonly assistanceAssets?: boolean };
	readonly snapshot: { readonly project?: { readonly id: string } | null;
		readonly audioDevices?: { readonly playbackGain?: number } };
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly selectedMediaPreparation: LocalAssistanceSelectedMediaPreparationPort | null;
	readonly textToSpeechProjectPort?: TextToSpeechProjectPort | null;
	readonly setActiveSurface: (surface: string | null) => void;
}) {
	if (!fileService.isDesktop) return null;
	const request = assistanceDialogRequest(activeSurface);
	const close = (): void => setActiveSurface(null);
	const title = request?.mode === 'task' ? assistanceTaskLabel(request.workflowId, copy)
		: activeSurface === 'text-to-speech' ? copy['ui.textToSpeech.title'] || 'Text to Speech'
			: request ? copy.advancedLocalProcessing || 'Advanced Local Processing'
				: copy.manageLocalModels || 'Model Manager';
	return <AudioEditorListeningGainContext.Provider value={snapshot.audioDevices?.playbackGain ?? 1}>
		<Suspense fallback={<AssistanceLoadingDialog title={title} copy={copy} onClose={close} />}>
		{activeSurface === 'local-models' && <div data-editor-surface="local-models">
			<LocalModelManagerDialog bridge={resolveLocalModelManagerBridge(fileService.bridge)}
				copy={copy} locale={locale} onClose={close} />
		</div>}
		{request && capabilities.assistanceAssets && <div data-editor-surface="local-assistance">
			<LocalAssistanceDialog request={request} projectId={snapshot.project?.id ?? null}
				bridgeScope={fileService.bridge} preparation={selectedMediaPreparation}
				copy={copy} locale={locale} onClose={close} />
		</div>}
		{activeSurface === 'text-to-speech' && capabilities.assistanceAssets &&
			<div data-editor-surface="text-to-speech"><TextToSpeechDialog
				bridgeScope={fileService.bridge} projectPort={textToSpeechProjectPort ?? null}
				copy={copy} locale={locale} onClose={close} /></div>}
		</Suspense>
	</AudioEditorListeningGainContext.Provider>;
}
