/* SPDX-License-Identifier: AGPL-3.0-only */

import { videoExportPlanFormat } from './video-export-request-format.ts';

export type DesktopVideoExportFormat = 'mp4' | 'webm';
export type DesktopVideoExportProvider = 'bundled' | 'operating-system' | 'external-ffmpeg';

export interface DesktopVideoExportFormatCapability {
	readonly available: boolean;
	readonly provider: DesktopVideoExportProvider | null;
	readonly reason: string | null;
}

export interface DesktopVideoExportCapabilities {
	readonly schemaVersion: 1;
	readonly formats: Readonly<Record<DesktopVideoExportFormat, DesktopVideoExportFormatCapability>>;
	readonly notice: string | null;
}

export interface DesktopVideoExportFileService {
	readonly isDesktop?: boolean;
	readonly getDesktopVideoExportCapabilities?: () => unknown | Promise<unknown>;
}

const FORMATS = Object.freeze(['mp4', 'webm'] as const);
const PROVIDERS = new Set<DesktopVideoExportProvider>([
	'bundled', 'operating-system', 'external-ffmpeg',
]);

function unavailableCapability(format: DesktopVideoExportFormat): DesktopVideoExportFormatCapability {
	return Object.freeze({
		available: false,
		provider: null,
		reason: `Desktop ${format === 'mp4' ? 'MP4' : 'WebM'} export needs an execution-verified external FFmpeg provider. Manage or rescan it in Edit > Preferences > General.`,
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeFormatCapability(
	format: DesktopVideoExportFormat,
	value: unknown,
): DesktopVideoExportFormatCapability {
	if (isRecord(value) && value.available === false && value.provider === null
		&& boundedReason(value.reason)) {
		return Object.freeze({ available: false, provider: null, reason: value.reason });
	}
	if (!isRecord(value) || value.available !== true || !PROVIDERS.has(
		value.provider as DesktopVideoExportProvider,
	)) return unavailableCapability(format);
	return Object.freeze({
		available: true,
		provider: value.provider as DesktopVideoExportProvider,
		reason: null,
	});
}

function capabilityNotice(
	formats: Readonly<Record<DesktopVideoExportFormat, DesktopVideoExportFormatCapability>>,
): string | null {
	const unavailable = FORMATS.filter((format) => !formats[format].available)
		.map((format) => format === 'mp4' ? 'MP4' : 'WebM');
	if (unavailable.length === 0) return null;
	return `Desktop ${unavailable.join(' and ')} export ${unavailable.length === 1 ? 'is' : 'are'} unavailable. Manage or rescan external FFmpeg in Edit > Preferences > General.`;
}

function boundedReason(value: unknown): value is string {
	return typeof value === 'string' && value.length >= 1 && value.length <= 512
		&& value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

/** Normalize an untrusted desktop bridge response, failing closed per format. */
export function desktopVideoExportCapabilities(value: unknown): DesktopVideoExportCapabilities {
	const formatsValue = isRecord(value) && value.schemaVersion === 1 && isRecord(value.formats)
		? value.formats
		: null;
	const formats = Object.freeze({
		mp4: normalizeFormatCapability('mp4', formatsValue?.mp4),
		webm: normalizeFormatCapability('webm', formatsValue?.webm),
	});
	return Object.freeze({ schemaVersion: 1, formats, notice: capabilityNotice(formats) });
}

function normalizeFormat(value: unknown): DesktopVideoExportFormat | null {
	const format = videoExportPlanFormat(value);
	return format === 'mp4' || format === 'webm' ? format : null;
}

export function desktopVideoExportFormatAvailable(
	formatValue: unknown,
	capabilities: DesktopVideoExportCapabilities | null | undefined,
): boolean {
	const format = normalizeFormat(formatValue);
	return format !== null && capabilities?.formats[format].available === true;
}

export function desktopVideoExportFormatReason(
	formatValue: unknown,
	capabilities: DesktopVideoExportCapabilities | null | undefined,
): string | null {
	const format = normalizeFormat(formatValue);
	if (format === null) return null;
	const capability = capabilities?.formats[format] ?? unavailableCapability(format);
	return capability.available ? null : capability.reason;
}

export async function resolveDesktopVideoExportCapabilities(
	fileService: DesktopVideoExportFileService | null | undefined,
): Promise<DesktopVideoExportCapabilities> {
	try {
		return desktopVideoExportCapabilities(
			await fileService?.getDesktopVideoExportCapabilities?.(),
		);
	} catch {
		return desktopVideoExportCapabilities(null);
	}
}

/** Refuse desktop video work unless the host explicitly advertises executable format support. */
export async function assertDesktopVideoExportAvailable(
	fileService: DesktopVideoExportFileService | null | undefined,
	format: unknown,
): Promise<void> {
	if (fileService?.isDesktop !== true) return;
	const capabilities = await resolveDesktopVideoExportCapabilities(fileService);
	const reason = desktopVideoExportFormatReason(format, capabilities);
	if (reason) throw new Error(reason);
}
