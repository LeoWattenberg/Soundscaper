/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { createPortal } from 'react-dom';

import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const FRAMESCAPER_BUILD = typeof __SCAPE_PRODUCT__ === 'undefined'
	|| __SCAPE_PRODUCT__ === 'framescaper';
const FramescaperVideoProxyDialog = FRAMESCAPER_BUILD
	? lazyEditorModule(() => import('../dialogs/FramescaperVideoProxyDialog.tsx')) : null;

export default function ProjectBinVideoProxyDialog({
	clipId,
	controller,
	snapshot,
	copy,
	fileService,
	run,
	editingBlocked,
	onClose,
	portalTarget,
}) {
	if (clipId === null || !FramescaperVideoProxyDialog || !portalTarget) return null;
	return createPortal(
		<React.Suspense fallback={<p role="status">{copy.loading}</p>}>
			<FramescaperVideoProxyDialog
				controller={controller}
				snapshot={{ ...snapshot, selectedClipId: clipId }}
				editingBlocked={editingBlocked}
				copy={copy}
				fileService={fileService}
				run={run}
				onClose={onClose}
			/>
		</React.Suspense>,
		portalTarget,
	);
}
