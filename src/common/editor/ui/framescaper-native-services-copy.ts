/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	resolveCopyCatalogOverrides,
} from './copy-catalog-overrides.ts';

export const FRAMESCAPER_NATIVE_SERVICES_COPY = Object.freeze({
	importImageSequence: 'Image sequence…',
	addToRenderQueue: 'Add to render queue…',
	externalDisplay: 'External display',
	externalDisplayNone: 'None',
	externalDisplayUnavailable: 'No non-primary display available',
	backgroundJobs: 'Background jobs…',
	watchFolders: 'Watch folders…',
	proxies: 'Proxies',
	proxyGenerate: 'Generate…',
	proxyAttach: 'Attach…',
	proxyDetach: 'Detach',
	proxyRelink: 'Relink…',
	nativeMediaPreferences: 'Native media and scratch…',
	videoEffects: 'Video effects',
	ofxAdd: 'Add OFX…',
	ofxManage: 'Manage OFX…',
	nativeServices: 'Framescaper native services',
	refresh: 'Refresh status',
	working: 'Working…',
	operationComplete: 'Operation complete.',
	runtimeUnavailable: 'Native media runtime is unavailable in this build.',
	nativeMediaDisabled: 'Native media is switched off.',
	capabilityUnavailable: 'This operation is unavailable until its runtime and project gates pass.',
	projectActionRun: 'Continue',
	projectActionReady: 'The exact project and runtime gates passed.',
	projectActionComplete: 'The project operation completed.',
	noQueueJobs: 'There are no background jobs.',
	queueState: 'State',
	queueProgress: 'Progress',
	queuePause: 'Pause',
	queueResume: 'Resume',
	queueCancel: 'Cancel',
	queueRetry: 'Retry',
	queueRemove: 'Remove',
	queueMoveEarlier: 'Move earlier',
	queueMoveLater: 'Move later',
	noWatchFolders: 'No watch folders are configured.',
	watchCreate: 'Add watch folder',
	watchReconcile: 'Reconcile now',
	watchEnable: 'Enable',
	watchDisable: 'Disable',
	watchRemove: 'Remove',
	watchExtensions: 'File extensions',
	watchImportMode: 'Import mode',
	watchGenerateProxies: 'Generate proxies',
	watchProjectUnavailable: 'Open an editable project before creating a watch rule.',
	watchRootUnavailable: 'Authorize a folder before creating a watch rule.',
	watchLinked: 'Link originals',
	watchCopied: 'Copy originals',
	preferenceStatus: 'Native service preferences',
	nativeMediaMaster: 'Native media master',
	hardwareDecode: 'Hardware decode',
	hardwareEncode: 'Hardware encode',
	ofxConsent: 'OpenFX consent',
	preferenceControlUnavailable: 'This desktop build can report this switch but cannot change it.',
	capabilityStatus: 'Runtime capability status',
	noCapabilityReport: 'Detailed runtime capability evidence is unavailable.',
	nativeRoots: 'Authorized output folders',
	noNativeRoots: 'No output folders are authorized.',
	rootAuthorize: 'Authorize folder…',
	rootRevalidate: 'Revalidate',
	rootRevoke: 'Revoke',
	rootRevoked: 'revoked',
	rootAvailable: 'authorized',
	scratchCleanup: 'Clean verified scratch',
});

export type FramescaperNativeServicesCopy = Readonly<{
	[Key in keyof typeof FRAMESCAPER_NATIVE_SERVICES_COPY]: string;
}>;

/** Resolve optional host localization without requiring a shared catalog change. */
export function resolveFramescaperNativeServicesCopy(
	copy: Readonly<Record<string, string | undefined>> = {},
): FramescaperNativeServicesCopy {
	return resolveCopyCatalogOverrides(FRAMESCAPER_NATIVE_SERVICES_COPY, copy);
}
