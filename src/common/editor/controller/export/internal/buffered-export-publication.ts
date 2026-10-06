/* SPDX-License-Identifier: AGPL-3.0-only */

interface BufferedExportPublication {
	readonly cancelled?: boolean;
	readonly fileName?: string;
	readonly method?: string;
	readonly url?: string | null;
	readonly cleanup?: () => Promise<void> | void;
}

interface BufferedExportFileService {
	createDownload(request: Readonly<Record<string, unknown>>): Promise<BufferedExportPublication>;
	saveFile(request: Readonly<Record<string, unknown>>): Promise<BufferedExportPublication>;
}

/** A queued delivery has no export dialog to start its prepared download. */
export function publishBufferedExport(
	fileService: BufferedExportFileService,
	request: Readonly<Record<string, unknown>>,
	saveToFile: unknown,
): Promise<BufferedExportPublication> {
	return saveToFile === true ? fileService.saveFile(request) : fileService.createDownload(request);
}
