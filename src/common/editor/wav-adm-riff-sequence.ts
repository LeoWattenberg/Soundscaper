/* SPDX-License-Identifier: AGPL-3.0-only */

import { wavAdmWarning, type WavAdmWarning } from './wav-adm-import.ts';
import {
	createWavAdmRiffSequenceCollector,
	shouldPreserveWavAdmRiffSequenceChunk,
	wavOpaqueRiffPreservationWarning,
	type WavOpaqueRiffChunkPlacement,
	type WavRiffChunkSequenceEntry,
} from './wav-opaque-chunks.ts';

type Wav64Dialect = 'rf64' | 'bw64' | null;

export function createWavAdmRiffSequencePreserver() {
	const collector = createWavAdmRiffSequenceCollector();
	const warnings: WavAdmWarning[] = [];
	return Object.freeze({
		shouldCapture(dialect: Wav64Dialect, id: string): boolean {
			if (dialect !== 'bw64') return false;
			if (id === 'fact') warnings.push(wavAdmWarning(
				'adm-bw64-fact-forbidden',
				'BW64 forbids the fact chunk; it was not admitted to pristine ADM preservation.',
			));
			return shouldPreserveWavAdmRiffSequenceChunk(id);
		},
		noteMissingPadding(id: string): void {
			warnings.push(wavOpaqueRiffPreservationWarning(
				`The trailing ${JSON.stringify(id)} chunk is missing its RIFF alignment byte and cannot be preserved exactly.`,
			));
		},
		async capture(options: Readonly<{
			id: string;
			placement: WavOpaqueRiffChunkPlacement;
			declaredByteLength: number;
			rawByteLength: number;
			read: () => Promise<Uint8Array>;
		}>): Promise<void> {
			const warning = await collector.capture(options);
			if (warning) warnings.push(warning);
		},
		snapshot(): readonly WavRiffChunkSequenceEntry[] {
			return collector.snapshot();
		},
		warnings(): readonly WavAdmWarning[] {
			return Object.freeze([...warnings]);
		},
	});
}
