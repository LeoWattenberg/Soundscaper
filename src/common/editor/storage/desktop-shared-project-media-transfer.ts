/* SPDX-License-Identifier: AGPL-3.0-only */

export * from './desktop-shared-project-media-contract.ts';
export {
	acquireDesktopSharedProjectAudio,
	acquireDesktopSharedProjectMedia,
} from './desktop-shared-project-media-acquisition.ts';
export {
	prepareDesktopSharedProjectAudioHandoff,
	prepareDesktopSharedProjectMediaHandoff,
} from './desktop-shared-project-media-sender.ts';
