/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo } from 'react';

import { createAudioEditorController } from '../../app.js';
import { createAudioEditorFileService } from '../../file-service.js';
import AudioEditorWorkspace from './AudioEditorWorkspace.jsx';

/** Existing V17 workspace owner used by the Soundscaper route. */
export default function DefaultAudioEditorWorkspace({ locale, copy, productId = 'soundscaper' }) {
	const fileService = useMemo(() => createAudioEditorFileService(), []);
	const controller = useMemo(() => createAudioEditorController(null, {
		headless: true,
		locale,
		copy,
		fileService,
		productId,
	}), [copy, fileService, locale, productId]);
	return <AudioEditorWorkspace
		locale={locale}
		copy={copy}
		productId={productId}
		controller={controller}
		fileService={fileService}
		crossProductHandoffAvailable={fileService.isDesktop}
	/>;
}
