/* SPDX-License-Identifier: AGPL-3.0-only */

import type { CaptureSourceRole } from '../framescaper-capture-domain.ts';
import { normalizeCaptureDisplaySources } from './framescaper-capture-preview-resources.ts';
import type {
	FramescaperCaptureDisplaySelectionPort,
	FramescaperCaptureDisplaySource,
} from './framescaper-capture-session-types.ts';

export function createFramescaperCaptureDisplaySelection(
	port: FramescaperCaptureDisplaySelectionPort | undefined,
	onChange: () => void,
) {
	let sources: readonly Readonly<FramescaperCaptureDisplaySource>[] = Object.freeze([]);
	let selectedToken: string | null = null;
	let remembered: Readonly<Omit<FramescaperCaptureDisplaySource, 'token'>> | null = null;
	return Object.freeze({
		get mode() { return port?.mode ?? null; },
		get snapshot() {
			return Object.freeze({ displaySources: sources, selectedDisplaySourceToken: selectedToken });
		},
		async renewToken(roles: readonly CaptureSourceRole[]): Promise<string | null> {
			if (!roles.includes('display') || port?.mode !== 'source-list') return null;
			if (selectedToken === null && remembered !== null && port.listSources) {
				sources = normalizeCaptureDisplaySources(await port.listSources());
				const matches = sources.filter(({ name, kind }) =>
					name === remembered?.name && kind === remembered.kind);
				selectedToken = matches.length === 1 ? matches[0]!.token : null;
				onChange();
			}
			return requiredToken();
		},
		async list(): Promise<void> {
			if (port?.mode !== 'source-list' || !port.listSources) {
				throw new Error('Capture display source listing is unavailable.');
			}
			sources = normalizeCaptureDisplaySources(await port.listSources());
			selectedToken = null;
			remembered = null;
			onChange();
		},
		select(sourceToken: string): void {
			const source = sources.find(({ token }) => token === sourceToken);
			if (!source) throw new Error('The selected display source is not in the current inventory.');
			selectedToken = sourceToken;
			remembered = Object.freeze({ name: source.name, kind: source.kind });
			onChange();
		},
		consume(sourceToken: string | null): void {
			if (sourceToken === null) return;
			sources = Object.freeze([]);
			selectedToken = null;
		},
		clear(): void {
			sources = Object.freeze([]);
			selectedToken = null;
			remembered = null;
		},
	});

	function requiredToken(): string {
		if (selectedToken === null || !sources.some(({ token }) => token === selectedToken)) {
			throw new Error('Choose a display source before opening its preview.');
		}
		return selectedToken;
	}
}
