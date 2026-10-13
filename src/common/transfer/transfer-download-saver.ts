/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * How long the last archive's object URL is left alive.
 *
 * An object URL has to outlive the click that starts the download, so it cannot
 * be revoked synchronously. This is the backstop for the final archive of a
 * run; every earlier one is released when the next is created, which is what
 * keeps the download transport to one resident archive.
 */
const TRANSFER_DOWNLOAD_URL_LIFETIME_MILLISECONDS = 60_000;

/**
 * Hand archives to the browser one at a time, holding one archive/companion group at a time.
 *
 * The download path is the transport that streams, and the reason it needs no
 * aggregate byte ceiling is that it never holds more than the archive and its
 * optional companion currently being saved. An object URL is a strong reference to its Blob, so revoking
 * each one only on a 60-second timer quietly broke that: a library of thirty
 * archives saved in under a minute kept all thirty resident, and the transport
 * that was supposed to be the safe fallback for an enormous library was the one
 * with no bound at all.
 *
 * So the previous group gets one browser task to consume its click, then is
 * released before the next archive is created. Only the last group of a run
 * waits out the backstop above.
 */
export function createTransferArchiveSaver(
	scope: Window & typeof globalThis,
	createChannel: () => MessageChannel = () => new MessageChannel(),
): Readonly<{
	saveArchive(bytes: Uint8Array, fileName: string, mimeType: string): Promise<void>;
	saveCompanion(bytes: Uint8Array, fileName: string, mimeType: string): Promise<void>;
}> {
	let held: { urls: readonly string[]; timer: unknown } | null = null;
	const release = (): void => {
		if (!held) return;
		const { urls, timer } = held;
		held = null;
		scope.clearTimeout(timer as ReturnType<typeof setTimeout>);
		for (const url of urls) scope.URL.revokeObjectURL(url);
	};
	const save = (bytes: Uint8Array, fileName: string, mimeType: string): void => {
		const url = scope.URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type: mimeType }));
		try {
			const anchor = scope.document.createElement('a');
			anchor.href = url;
			anchor.download = fileName;
			anchor.rel = 'noopener';
			scope.document.body.append(anchor);
			anchor.click();
			anchor.remove();
		} finally {
			const urls = [...held?.urls ?? [], url];
			if (held) scope.clearTimeout(held.timer as ReturnType<typeof setTimeout>);
			held = { urls, timer: scope.setTimeout(release, TRANSFER_DOWNLOAD_URL_LIFETIME_MILLISECONDS) };
		}
	};
	return Object.freeze({
		saveArchive: async (bytes, fileName, mimeType) => {
			if (held) {
				// Let the browser consume both clicks from the previous group before
				// their object URLs are revoked, without retaining another archive.
				await new Promise<void>((resolve) => { scope.setTimeout(resolve, 0); });
				release();
			}
			save(bytes, fileName, mimeType);
		},
		saveCompanion: async (bytes, fileName, mimeType) => {
			// WebKit can coalesce two download navigations in one task. Let the
			// browser consume the archive click before handing it the report.
			await nextDownloadTask(createChannel);
			save(bytes, fileName, mimeType);
		},
	});
}

async function nextDownloadTask(createChannel: () => MessageChannel): Promise<void> {
	const channel = createChannel();
	try {
		await new Promise<void>((resolve, reject) => {
			channel.port1.onmessage = () => resolve();
			channel.port1.onmessageerror = () => reject(new Error('The download task could not be delivered.'));
			channel.port2.postMessage(null);
		});
	} finally {
		channel.port1.onmessage = null; channel.port1.onmessageerror = null;
		channel.port1.close(); channel.port2.close();
	}
}
