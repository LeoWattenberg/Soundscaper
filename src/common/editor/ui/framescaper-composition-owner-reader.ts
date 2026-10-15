/* SPDX-License-Identifier: AGPL-3.0-only */
import type { FramescaperCompositionLinkOwnerReceipt } from '../../../framescaper/editor-composition-link-owner-repository.ts';

type Receipt = FramescaperCompositionLinkOwnerReceipt | null;
interface Refresh {
	readonly token: number;
	readonly projectId: string;
	readonly load: (id: string) => Promise<Receipt>;
}

/** Each dialog owns one active storage read and one coalesced latest refresh. */
export function createFramescaperCompositionOwnerReader(options: Readonly<{
	currentOwner(): string | undefined;
	publish(receipt: Receipt): void;
	fail(error: unknown): void;
}>) {
	let generation = 0, active = false;
	let wanted: Refresh | null = null;
	let owner: string | undefined, scope: object | undefined;
	function cancel() { generation++; wanted = null; }
	async function drain(): Promise<void> {
		if (active) return;
		active = true;
		try {
			while (wanted) {
				const request = wanted; wanted = null;
				try {
					const receipt = await request.load(request.projectId);
					if (request.token === generation && options.currentOwner() === request.projectId) options.publish(receipt);
				} catch (error) {
					if (request.token === generation && options.currentOwner() === request.projectId) options.fail(error);
				}
			}
		} finally { active = false; }
	}
	return Object.freeze({
		refresh(nextScope: object, projectId: string | undefined, load: Refresh['load']) {
			cancel();
			if (owner !== projectId || scope !== nextScope) options.publish(null);
			owner = projectId; scope = nextScope;
			const token = generation;
			if (projectId) { wanted = { token, projectId, load }; void drain(); }
			return () => { if (generation === token) cancel(); };
		},
		adopt(receipt: FramescaperCompositionLinkOwnerReceipt) {
			if (receipt.project.id !== options.currentOwner()) return;
			cancel(); options.publish(receipt);
		},
	});
}
