/* SPDX-License-Identifier: AGPL-3.0-only */

import { useEffect, useMemo, useState } from 'react';

import {
	desktopVideoExportCapabilities,
	desktopVideoExportFormatAvailable,
	desktopVideoExportFormatReason,
	resolveDesktopVideoExportCapabilities,
	type DesktopVideoExportCapabilities,
	type DesktopVideoExportFileService,
} from '../desktop-video-export-capability.ts';

interface CapabilityResult {
	readonly owner: DesktopVideoExportFileService;
	readonly capabilities: DesktopVideoExportCapabilities;
}

export interface DesktopVideoExportCapabilityModel {
	readonly resolved: boolean;
	readonly notice: string | null;
	readonly available: (format: unknown) => boolean;
	readonly reason: (format: unknown) => string | null;
}

const FAIL_CLOSED_CAPABILITIES = desktopVideoExportCapabilities(null);
const BROWSER_CAPABILITIES = Object.freeze({
	resolved: true,
	notice: null,
	available: () => true,
	reason: () => null,
});

/** Query desktop video execution support without treating generic FFmpeg readiness as support. */
export function useDesktopVideoExportCapabilities(
	fileService: DesktopVideoExportFileService | null | undefined,
	isOpen: boolean,
): DesktopVideoExportCapabilityModel {
	const desktop = fileService?.isDesktop === true;
	const [result, setResult] = useState<CapabilityResult | null>(null);
	useEffect(() => {
		if (!desktop || !isOpen || !fileService) { setResult(null); return undefined; }
		let current = true;
		setResult(null);
		void resolveDesktopVideoExportCapabilities(fileService).then((capabilities) => {
			if (current) setResult({ owner: fileService, capabilities });
		});
		return () => { current = false; };
	}, [desktop, fileService, isOpen]);
	return useMemo(() => {
		if (!desktop) return BROWSER_CAPABILITIES;
		const resolved = result?.owner === fileService;
		const capabilities = resolved ? result.capabilities : FAIL_CLOSED_CAPABILITIES;
		return {
			resolved,
			notice: resolved ? capabilities.notice : null,
			available: (format: unknown) => desktopVideoExportFormatAvailable(format, capabilities),
			reason: (format: unknown) => desktopVideoExportFormatReason(format, capabilities),
		};
	}, [desktop, fileService, result]);
}
