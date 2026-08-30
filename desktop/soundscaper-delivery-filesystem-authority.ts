/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	SoundscaperDeliveryFileIdentity,
	SoundscaperDeliveryFileInspection,
	SoundscaperDeliveryRoot,
} from './soundscaper-delivery-root.ts';

export type SoundscaperDeliveryFilesystemFence = (operation: string) => void;

export interface SoundscaperDeliveryFilesystemSession {
	readonly reference: string;
	readonly recoveryToken: string;
	readonly volumeIdentity: string;
	readonly fileIdentity: string;
	readonly settled: boolean;
	write(offset: number, bytes: Uint8Array): Promise<number>;
	patch(offset: number, bytes: Uint8Array): Promise<number>;
	seal(byteLength: number): Promise<SoundscaperDeliveryFileInspection>;
	inspect(): Promise<SoundscaperDeliveryFileInspection>;
	publish(finalName: string, journalId: string): Promise<SoundscaperDeliveryFileInspection>;
	abort(): Promise<'missing' | 'removed' | 'foreign'>;
	/** Drop this owner's live handles without removing successor-owned recovery state. */
	abandon(): Promise<void>;
}

export interface SoundscaperDeliveryFilesystemAuthority {
	open(value: Readonly<{
		root: SoundscaperDeliveryRoot;
		reference: string;
		finalName: string;
		maximumBytes: number;
		finalPrefixByteLength: 0 | 32;
		fence: SoundscaperDeliveryFilesystemFence;
	}>): Promise<SoundscaperDeliveryFilesystemSession>;
	removeRecovered(
		root: SoundscaperDeliveryRoot,
		recoveryToken: string,
		expected: SoundscaperDeliveryFileIdentity | SoundscaperDeliveryFileInspection,
		fence: SoundscaperDeliveryFilesystemFence,
	): Promise<'missing' | 'removed' | 'foreign'>;
	inspectFinal(
		root: SoundscaperDeliveryRoot,
		finalName: string,
		fence: SoundscaperDeliveryFilesystemFence,
	): Promise<SoundscaperDeliveryFileInspection | null>;
}

export class SoundscaperDeliveryFilesystemUnavailableError extends Error {
	readonly code = 'delivery-filesystem-unavailable';

	constructor(message = 'Authenticated persistent-delivery filesystem staging is unavailable.') {
		super(message);
		this.name = 'SoundscaperDeliveryFilesystemUnavailableError';
	}
}

/** Complete preview/test authority that fails every filesystem operation with one typed reason. */
export function createUnavailableSoundscaperDeliveryFilesystemAuthority(
	detail: string,
): SoundscaperDeliveryFilesystemAuthority {
	const refuse = async (): Promise<never> => {
		throw new SoundscaperDeliveryFilesystemUnavailableError(detail);
	};
	return Object.freeze({
		open: refuse,
		removeRecovered: refuse,
		inspectFinal: refuse,
	});
}
