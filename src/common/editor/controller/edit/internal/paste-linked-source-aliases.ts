/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioEditorCommand } from '../../../commands/protocol.ts';
import type { LinkedOriginalBinding } from '../../../storage/linked-original-binding.ts';
import type { LinkedOriginalSource } from '../../../storage/linked-original-resolver.ts';
import { discoverPasteCommandTree } from './paste-command-tree.ts';

export interface PasteLinkedSourceAliasStore {
	copyLinkedOriginalSourceAliases(
		originProjectId: string,
		projectId: string,
		sources: readonly LinkedOriginalSource[],
	): Promise<readonly LinkedOriginalBinding[]>;
	rollbackLinkedOriginalSourceAliases(aliases: readonly LinkedOriginalBinding[]): Promise<void>;
}

export interface LinkedSourcePasteRequest {
	readonly command: AudioEditorCommand;
	readonly originProjectId: string | null | undefined;
	readonly projectId: string;
	readonly store: PasteLinkedSourceAliasStore | null | undefined;
	assertCurrent(): void;
	commit(command: AudioEditorCommand): PromiseLike<unknown> | unknown;
}

/** Give newly pasted sources an exact project binding before the command can publish them. */
export function commitPasteWithLinkedSourceAliases(request: LinkedSourcePasteRequest): Promise<unknown> | unknown {
	const sources = discoverPasteCommandTree(request.command).sourceAdds
		.map(({ source }) => source)
		.filter((source): source is LinkedOriginalSource => source.kind === 'audio' || source.kind === 'video');
	if (!sources.length || !request.originProjectId || request.originProjectId === request.projectId) {
		request.assertCurrent();
		return request.commit(request.command);
	}
	if (!request.store) throw new Error('Linked original source alias storage is unavailable for cross-project paste.');
	return copyAndCommit(request.store, sources);

	async function copyAndCommit(
		store: PasteLinkedSourceAliasStore,
		transferredSources: readonly LinkedOriginalSource[],
	): Promise<unknown> {
		request.assertCurrent();
		const aliases = await store.copyLinkedOriginalSourceAliases(
			request.originProjectId!, request.projectId, transferredSources,
		);
		try {
			request.assertCurrent();
			return await request.commit(request.command);
		} catch (error) {
			try { await store.rollbackLinkedOriginalSourceAliases(aliases); }
			catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					'Cross-project paste and linked original alias rollback both failed.',
					{ cause: rollbackError },
				);
			}
			throw error;
		}
	}
}
