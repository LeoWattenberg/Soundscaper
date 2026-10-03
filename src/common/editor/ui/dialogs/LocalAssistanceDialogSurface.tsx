/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';

import type { LocalAssistanceDialogProps } from './LocalAssistanceDialog.tsx';
import { resolveLocalModelManagerBridge } from '../local-model-manager-availability.ts';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import { defaultAssistanceWorkflowSettingsV1 } from '../../assistance/workflow-settings-v1.ts';
import { assistanceTaskAvailableModelFilter, assistanceTaskRequiresModels } from
	'../../controller/assistance/local-assistance-task-models.ts';
import AssistanceModelGate from './AssistanceModelGate.tsx';
import { assistanceTaskLabel } from '../assistance-task-catalog.ts';

const LocalAssistanceDialog = lazyEditorModule(() => import('./LocalAssistanceRuntimeDialog.tsx'));

export interface LocalAssistanceDialogSurfaceProps
	extends Omit<LocalAssistanceDialogProps, 'bridge'> {
	readonly bridgeScope: unknown;
}

/** Resolve the desktop capability only after the menu-owned dialog is requested. */
export default function LocalAssistanceDialogSurface({
	bridgeScope, ...props
}: LocalAssistanceDialogSurfaceProps) {
	return <LocalAssistanceModelPreflight key={props.request?.mode === 'task' ? props.request.workflowId : 'advanced'}
		bridgeScope={bridgeScope} {...props} />;
}

function LocalAssistanceModelPreflight({ bridgeScope, ...props }: LocalAssistanceDialogSurfaceProps) {
	const modelBridge = useMemo(() => resolveLocalModelManagerBridge(bridgeScope), [bridgeScope]);
	const settings = props.request?.mode === 'task'
		? defaultAssistanceWorkflowSettingsV1(props.request.workflowId) : null;
	const title = props.request?.mode === 'task' ? assistanceTaskLabel(props.request.workflowId, props.copy)
		: props.copy.advancedLocalProcessing || 'Advanced Local Processing';
	return <AssistanceModelGate title={title} copy={props.copy} locale={props.locale ?? 'en'}
		bridge={modelBridge} requiresModel={settings !== null && assistanceTaskRequiresModels(settings)}
		modelFilter={settings ? assistanceTaskAvailableModelFilter(settings) : () => true} onClose={props.onClose}>
		<LocalAssistanceDialog {...props} bridgeScope={bridgeScope} modelBridge={modelBridge} />
	</AssistanceModelGate>;
}
