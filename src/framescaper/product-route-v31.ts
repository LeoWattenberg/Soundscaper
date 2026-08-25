/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE } from './desktop-project-library-v20-renderer-contract.ts';
import { FRAMESCAPER_V31_COMPATIBILITY_CONTRACT } from './desktop-project-transport-v31.ts';
import { FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile-v31.ts';

/** Selected route identity for Framescaper assistance and capture. */
export const FRAMESCAPER_V31_PRODUCT_ROUTE = Object.freeze({
	owner: 'framescaper' as const,
	projectSchemaVersion: 31 as const,
	profile: FRAMESCAPER_V31_PROJECT_RUNTIME_PROFILE,
	desktopTransport: FRAMESCAPER_V31_COMPATIBILITY_CONTRACT,
	desktopLibraryHandshake: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_V20_HANDSHAKE,
	bootstrapModule: './ui/FramescaperAudioEditorBootstrapV31.tsx' as const,
	selected: true as const,
	framescaperCapture: true as const,
	assistanceUi: true as const,
});
