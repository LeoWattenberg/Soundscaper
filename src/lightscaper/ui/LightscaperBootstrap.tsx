/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperApp, { type LightscaperAppProps } from '../../common/editor/ui/lightscaper/LightscaperApp.tsx';
import { useCallback } from 'react';
import { bundledSiteCopyForLocale } from '../../common/i18n/site-copy.js';
import type { LoadPhotoLibraryDevelopProxyRuntimeV1 } from '../../common/editor/photo-library-develop-proxy-port-v1.ts';

// This product composition deliberately has no audio/timeline controller.
export default function LightscaperBootstrap(props: LightscaperAppProps) {
	const createSession = useCallback(async () => {
		const runtime = await import('../photo-library-session-runtime-v2.ts');
		return runtime.createPhotoLibrarySessionV2({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto,
			recoverRestores: async (settings, signal) => {
				const recovery = await import('../storage/photo-library-restore-recovery-v1.ts');
				await recovery.recoverPhotoLibraryRestoreV1({ settings, indexedDB: globalThis.indexedDB, locks: globalThis.navigator?.locks ?? null, signal });
			} });
	}, [props.locale]);
	const loadRestoreRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-restore-runtime-v1.ts');
		return runtime.createPhotoLibraryRestoreRuntimeV1({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto });
	}, [props.locale]);
	const loadBackupSaveRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-backup-save-runtime.ts');
		return runtime.createPhotoLibraryBackupSaveRuntimeV1();
	}, []);
	const loadMetadataQueryRuntime = useCallback(async () => (await import('../photo-metadata-query-ui-runtime.ts')).PHOTO_METADATA_QUERY_RUNTIME_V2, []);
	const loadSavedFilterRuntime = useCallback(async () => (await import('../photo-saved-filter-ui-runtime-v1.ts')).PHOTO_SAVED_FILTER_RUNTIME_V1, []);
	const loadDevelopProxyRuntime = useCallback<LoadPhotoLibraryDevelopProxyRuntimeV1>(async () => {
		return (await import('../photo-develop-render-runtime-v1.ts')).PHOTO_DEVELOP_RENDER_RUNTIME_V1;
	}, []);
	return <LightscaperApp {...props} createSession={props.createSession ?? createSession}
		loadBackupSaveRuntime={props.loadBackupSaveRuntime ?? loadBackupSaveRuntime}
		loadMetadataQueryRuntime={props.loadMetadataQueryRuntime ?? loadMetadataQueryRuntime}
		loadSavedFilterRuntime={props.loadSavedFilterRuntime ?? loadSavedFilterRuntime}
		loadRestoreRuntime={props.loadRestoreRuntime ?? loadRestoreRuntime}
		loadDevelopProxyRuntime={props.loadDevelopProxyRuntime ?? loadDevelopProxyRuntime} />;
}
