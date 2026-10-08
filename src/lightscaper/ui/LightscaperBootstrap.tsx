/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperApp, { type LightscaperAppProps } from '../../common/editor/ui/lightscaper/LightscaperApp.tsx';
import { useCallback } from 'react';
import { bundledSiteCopyForLocale } from '../../common/i18n/site-copy.js';

// This product composition deliberately has no audio/timeline controller.
export default function LightscaperBootstrap(props: LightscaperAppProps) {
	const createSession = useCallback(async () => {
		const runtime = await import('../photo-library-session-runtime.ts');
		return runtime.createPhotoLibrarySessionV1({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto });
	}, [props.locale]);
	const loadBackupSaveRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-backup-save-runtime.ts');
		return runtime.createPhotoLibraryBackupSaveRuntimeV1();
	}, []);
	const loadMetadataQueryRuntime = useCallback(async () => (await import('../photo-metadata-query-ui-runtime.ts')).PHOTO_METADATA_QUERY_RUNTIME_V2, []);
	const loadSavedFilterRuntime = useCallback(async () => (await import('../photo-saved-filter-ui-runtime-v1.ts')).PHOTO_SAVED_FILTER_RUNTIME_V1, []);
	return <LightscaperApp {...props} createSession={props.createSession ?? createSession}
		loadBackupSaveRuntime={props.loadBackupSaveRuntime ?? loadBackupSaveRuntime}
		loadMetadataQueryRuntime={props.loadMetadataQueryRuntime ?? loadMetadataQueryRuntime}
		loadSavedFilterRuntime={props.loadSavedFilterRuntime ?? loadSavedFilterRuntime} />;
}
