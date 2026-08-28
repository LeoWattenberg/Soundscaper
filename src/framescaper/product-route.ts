/* SPDX-License-Identifier: AGPL-3.0-only */

import { FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE } from
	'./desktop-project-library-renderer-contract.ts';
import { FRAMESCAPER_COMPATIBILITY_CONTRACT } from './desktop-project-transport.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE } from './editor-project-runtime-profile.ts';

export const FRAMESCAPER_PRODUCT_ROUTE = Object.freeze({
	owner: 'framescaper' as const,
	schemaFamily: 'framescaper' as const,
	schemaVersion: 1 as const,
	profile: FRAMESCAPER_PROJECT_RUNTIME_PROFILE,
	desktopTransport: FRAMESCAPER_COMPATIBILITY_CONTRACT,
	desktopLibraryHandshake: FRAMESCAPER_DESKTOP_PROJECT_LIBRARY_HANDSHAKE,
	bootstrapModule: './ui/FramescaperAudioEditorBootstrap.tsx' as const,
	selected: true as const,
	framescaperCapture: true as const,
	assistanceUi: true as const,
});
