/* SPDX-License-Identifier: AGPL-3.0-only */
import { Suspense } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { assistanceDialogRequest } from '../assistance-task-catalog.ts';
import { resolveLocalModelManagerBridge } from '../local-model-manager-bridge.ts';
import type { LocalAssistanceSelectedMediaPreparationPort } from '../../assistance/local-assistance-preparation.ts';

const LocalModelManagerDialog = lazyEditorModule(() => import('../dialogs/LocalModelManagerDialog.tsx'));
const LocalAssistanceDialog = lazyEditorModule(() => import('../dialogs/LocalAssistanceDialogSurface.tsx'));

export default function LocalProcessingOverlays({ activeSurface, fileService, capabilities, snapshot,
	copy, locale, selectedMediaPreparation, setActiveSurface,
}: {
	readonly activeSurface: string | null;
	readonly fileService: { readonly isDesktop: boolean; readonly bridge?: unknown };
	readonly capabilities: { readonly assistanceAssets?: boolean };
	readonly snapshot: { readonly project?: { readonly id: string } | null };
	readonly copy: Readonly<Record<string, string>>;
	readonly locale: string;
	readonly selectedMediaPreparation: LocalAssistanceSelectedMediaPreparationPort | null;
	readonly setActiveSurface: (surface: string | null) => void;
}) {
	if (!fileService.isDesktop) return null;
	const request = assistanceDialogRequest(activeSurface);
	const close = (): void => setActiveSurface(null);
	return <Suspense fallback={<p role="status">{copy.loading}</p>}>
		{activeSurface === 'local-models' && <div data-editor-surface="local-models">
			<LocalModelManagerDialog bridge={resolveLocalModelManagerBridge(fileService.bridge)}
				copy={copy} locale={locale} onClose={close} />
		</div>}
		{request && capabilities.assistanceAssets && <div data-editor-surface="local-assistance">
			<LocalAssistanceDialog request={request} projectId={snapshot.project?.id ?? null}
				bridgeScope={fileService.bridge} preparation={selectedMediaPreparation}
				copy={copy} locale={locale} onClose={close} />
		</div>}
	</Suspense>;
}
