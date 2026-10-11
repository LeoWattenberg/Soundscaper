/* SPDX-License-Identifier: AGPL-3.0-only */

import LightscaperAppCurrentV1, { type LightscaperAppPropsCurrentV1 } from '../../common/editor/ui/lightscaper/LightscaperAppCurrentV1.tsx';
import { useCallback, useRef } from 'react';
import { bundledSiteCopyForLocale } from '../../common/i18n/site-copy.js';
import type { CreatePhotoLibraryDevelopProxyRuntimeV3 } from '../../common/editor/photo-library-develop-proxy-port-v3.ts';

function useCapturedMethod<T extends (...args: never[]) => unknown>(method: T | undefined, receiver: unknown): T | undefined {
	const capture = () => ({ method, invoke: method ? ((...args: Parameters<T>) => Reflect.apply(method, receiver, args)) as T : undefined });
	const pinned = useRef(capture()); if (pinned.current.method !== method) pinned.current = capture();
	return pinned.current.invoke;
}

// This product composition deliberately has no audio/timeline controller.
export default function LightscaperBootstrap(props: LightscaperAppPropsCurrentV1) {
	const suppliedSession = useCapturedMethod(props.createSession, props), suppliedBackup = useCapturedMethod(props.loadBackupSaveRuntime, props);
	const suppliedQuery = useCapturedMethod(props.loadMetadataQueryRuntime, props), suppliedSaved = useCapturedMethod(props.loadSavedFilterRuntime, props);
	const suppliedRestore = useCapturedMethod(props.loadRestoreRuntime, props), suppliedRenderer = useCapturedMethod(props.loadDevelopProxyRuntime, props);
	const createSession = useCallback(async () => {
		const runtime = await import('../photo-library-session-runtime-current-v1.ts');
		return runtime.createPhotoLibrarySessionCurrentV1({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto,
			recoverRestores: async (settings, signal) => {
				const recovery = await import('../storage/photo-library-restore-recovery-v1.ts');
				await recovery.recoverPhotoLibraryRestoreV1({ settings, indexedDB: globalThis.indexedDB, locks: globalThis.navigator?.locks ?? null, signal });
			} });
	}, [props.locale]);
	const loadRestoreRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-restore-runtime-v2.ts');
		return runtime.createPhotoLibraryRestoreRuntimeV2({ name: bundledSiteCopyForLocale(props.locale).workspacePhoto });
	}, [props.locale]);
	const loadBackupSaveRuntime = useCallback(async () => {
		const runtime = await import('../photo-library-backup-save-runtime.ts');
		return runtime.createPhotoLibraryBackupSaveRuntimeV1();
	}, []);
	const loadMetadataQueryRuntime = useCallback(async () => (await import('../photo-metadata-query-ui-runtime.ts')).PHOTO_METADATA_QUERY_RUNTIME_V2, []);
	const loadSavedFilterRuntime = useCallback(async () => (await import('../photo-saved-filter-ui-runtime-v1.ts')).PHOTO_SAVED_FILTER_RUNTIME_V1, []);
	const loadDevelopProxyRuntime = useCallback<CreatePhotoLibraryDevelopProxyRuntimeV3>(async (source, maskSource) => {
		return (await import('../photo-develop-render-runtime-v3.ts')).createPhotoDevelopRenderRuntimeV3({ source,
			...(maskSource === undefined ? {} : { maskSource }) });
	}, []);
	return <LightscaperAppCurrentV1 locale={props.locale} createSession={suppliedSession ?? createSession}
		loadBackupSaveRuntime={suppliedBackup ?? loadBackupSaveRuntime}
		loadMetadataQueryRuntime={suppliedQuery ?? loadMetadataQueryRuntime}
		loadSavedFilterRuntime={suppliedSaved ?? loadSavedFilterRuntime}
		loadRestoreRuntime={suppliedRestore ?? loadRestoreRuntime}
		loadDevelopProxyRuntime={suppliedRenderer ?? loadDevelopProxyRuntime} />;
}
