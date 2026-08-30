/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	assertSoundscaperDeliveryCurrentV1,
	SoundscaperDeliveryContractError,
	validateSoundscaperDeliveryResultV1,
	type SoundscaperDeliveryCurrentAuthorityV1,
	type SoundscaperDeliveryDescriptionV1,
	type SoundscaperDeliveryResultV1,
} from '../src/common/editor/soundscaper-delivery-contract-v1.ts';
import type { DeliveryReport } from '../src/common/editor/delivery-report.ts';
import {
	sameDeliveryFileIdentity,
	SoundscaperDeliveryRootStore,
	syncSoundscaperDeliveryRootDirectory,
	type SoundscaperDeliveryRoot,
	type SoundscaperDeliveryFileInspection,
	type SoundscaperDeliveryWrite,
} from './soundscaper-delivery-root.ts';
import type { SoundscaperDeliveryFilesystemAuthority } from './soundscaper-delivery-filesystem-authority.ts';
import { SoundscaperDeliveryQueueRepository } from './soundscaper-delivery-queue-repository.ts';
import {
	type SoundscaperDeliveryQueueRow,
	type SoundscaperDeliverySummary,
} from './soundscaper-delivery-service-contract.ts';
import {
	soundscaperDeliveryDescription,
	soundscaperDeliverySummary,
} from './soundscaper-delivery-service-view.ts';

interface PublicationRuntime {
	readonly repository: SoundscaperDeliveryQueueRepository;
	readonly roots: SoundscaperDeliveryRootStore;
	readonly assertWriter: () => void;
	readonly fileFence: (operation: string) => void;
	readonly assertCurrent: (
		description: SoundscaperDeliveryDescriptionV1,
		authority: SoundscaperDeliveryCurrentAuthorityV1,
	) => Promise<void>;
	readonly filesystem: SoundscaperDeliveryFilesystemAuthority;
}

export class SoundscaperDeliveryPublication {
	readonly #repository: SoundscaperDeliveryQueueRepository;
	readonly #roots: SoundscaperDeliveryRootStore;
	readonly #assertWriter: () => void;
	readonly #fileFence: (operation: string) => void;
	readonly #assertCurrent: PublicationRuntime['assertCurrent'];
	readonly #filesystem: SoundscaperDeliveryFilesystemAuthority;

	constructor(runtime: PublicationRuntime) {
		this.#repository = runtime.repository;
		this.#roots = runtime.roots;
		this.#assertWriter = runtime.assertWriter;
		this.#fileFence = runtime.fileFence;
		this.#assertCurrent = runtime.assertCurrent;
		this.#filesystem = runtime.filesystem;
	}

	async complete(
		row: SoundscaperDeliveryQueueRow,
		write: SoundscaperDeliveryWrite,
		report: DeliveryReport,
		authority: SoundscaperDeliveryCurrentAuthorityV1,
		revalidateAuthority: () => PromiseLike<SoundscaperDeliveryCurrentAuthorityV1> | SoundscaperDeliveryCurrentAuthorityV1,
	): Promise<SoundscaperDeliverySummary> {
		sealedRow(row);
		const description = soundscaperDeliveryDescription(row);
		const root = this.#roots.require(description.destinationGrantId);
		let inspected;
		try { inspected = await write.inspectSealed(); }
		catch (error) {
			await this.removeRecordedPartial(row, root, write).catch(() => undefined);
			this.#repository.setState(row.job_id, 'failed', 'staging-tampered', true);
			throw error;
		}
		if (inspected.byteLength !== row.staged_byte_length
			|| inspected.sha256 !== row.staged_sha256 || !sameDeliveryFileIdentity(inspected, rowIdentity(row))) {
			await this.removeRecordedPartial(row, root, write).catch(() => undefined);
			this.#repository.setState(row.job_id, 'failed', 'staging-tampered', true);
			throw new Error('The sealed Soundscaper delivery staging file changed before publication.');
		}
		try { await this.#assertCurrent(description, authority); }
		catch (error) {
			const code = staleAuthorityFailureCode(error);
			if (!code) throw error;
			await this.removeRecordedPartial(row, root, write);
			this.#repository.setState(row.job_id, 'stale', code, true);
			throw error;
		}
		const result = resultFor(row, description, report);
		const rootCurrent = await this.#roots.revalidate(root);
		this.#assertWriter();
		if (!rootCurrent) {
			this.#repository.setState(row.job_id, 'needs-authorization', 'authorization-required');
			throw new Error('The delivery destination needs authorization before publication.');
		}
		this.#repository.preparePublication(row, result);
		let authorityFailure: 'stale-plan' | 'stale-project' | null = null;
		try {
			await write.publish(row.job_id, async () => {
				try {
					await this.#assertCurrent(description, authority);
					assertSoundscaperDeliveryCurrentV1(description, await revalidateAuthority());
				} catch (error) {
					authorityFailure = staleAuthorityFailureCode(error);
					throw error;
				}
			});
			this.#assertWriter();
			this.#repository.markPublished(row.job_id);
			this.#assertWriter();
			this.#repository.settleCompleted(row.job_id, result);
		} catch (error) {
			this.#assertWriter();
			if (authorityFailure) {
				await this.removeRecordedPartial(row, root, write).catch(() => undefined);
				this.#repository.discardJournalAndSetState(row.job_id, 'stale', authorityFailure);
				throw error;
			}
			await this.#publicationFailure(row.job_id, root, write);
			row = this.#repository.row(row.job_id);
			if (row.state !== 'completed') throw error;
		}
		return soundscaperDeliverySummary(
			this.#repository.row(row.job_id), null, this.#repository.attemptReports(row.job_id),
		);
	}

	async recover(): Promise<void> {
		for (const journal of this.#repository.journals()) await this.#recoverPublication(journal);
		for (const row of this.#repository.rows("state = 'running'")) await this.recoverInterrupted(row);
	}

	async recoverInterrupted(row: SoundscaperDeliveryQueueRow): Promise<void> {
		const root = this.#roots.require(row.destination_grant_id);
		const validRoot = await this.#roots.revalidate(root);
		this.#assertWriter();
		if (!validRoot) {
			this.#repository.setState(row.job_id, 'needs-authorization', 'authorization-required');
			return;
		}
		try { await this.removeRecordedPartial(row, root); }
		catch {
			this.#repository.setState(row.job_id, 'failed', 'staging-ownership-lost');
			return;
		}
		this.#repository.setState(row.job_id, 'queued', null, true);
	}

	async removeRecordedPartial(
		row: SoundscaperDeliveryQueueRow,
		knownRoot?: SoundscaperDeliveryRoot,
		write?: SoundscaperDeliveryWrite,
	): Promise<void> {
		if (row.staging_name === null) return;
		const removed = write && !write.settled ? (await write.abort(), 'removed')
			: await this.#filesystem.removeRecovered(
				knownRoot ?? this.#roots.require(row.destination_grant_id),
				recoveryToken(row), rowRecoveryExpectation(row), this.#fileFence,
			);
		if (removed === 'foreign') {
			throw new Error('The recorded Soundscaper delivery staging leaf no longer belongs to its job.');
		}
	}

	async #recoverPublication(journal: Record<string, unknown>): Promise<void> {
		const row = this.#repository.row(String(journal.job_id));
		const root = this.#roots.require(row.destination_grant_id);
		const validRoot = await this.#roots.revalidate(root);
		this.#assertWriter();
		if (!validRoot) {
			this.#repository.setState(row.job_id, 'needs-authorization', 'authorization-required');
			return;
		}
		let published;
		try { published = await this.#filesystem.inspectFinal(root, String(journal.final_name), this.#fileFence); }
		catch {
			await this.#failRecovery(row, root, 'publication-conflict');
			return;
		}
		const exactPublished = exactJournalArtifact(published, journal)
			&& sameDeliveryFileIdentity(published!, rowIdentity(row));
		if (exactPublished) {
			if (journal.phase === 'prepared') {
				await syncSoundscaperDeliveryRootDirectory(root, this.#fileFence);
				this.#repository.markPublished(row.job_id);
			}
			if (!await this.#retireRecoveryStage(row, root, journalResult(journal, row).report)) return;
			this.#repository.settleCompleted(row.job_id, journalResult(journal, row));
			return;
		}
		if (!await this.#retireRecoveryStage(row, root,
			published ? journalResult(journal, row).report : null)) return;
		this.#repository.discardJournalAndSetState(
			row.job_id, published ? 'failed' : 'queued', published ? 'publication-conflict' : null,
			published ? journalResult(journal, row).report : null,
		);
	}

	async #failRecovery(
		row: SoundscaperDeliveryQueueRow,
		root: SoundscaperDeliveryRoot,
		failureCode: 'publication-conflict',
	): Promise<void> {
		const journal = this.#repository.journal(row.job_id);
		const report = journal ? journalResult(journal, row).report : null;
		if (!await this.#retireRecoveryStage(row, root, report)) return;
		this.#repository.discardJournalAndSetState(row.job_id, 'failed', failureCode, report);
	}

	async #retireRecoveryStage(
		row: SoundscaperDeliveryQueueRow,
		root: SoundscaperDeliveryRoot,
		report: DeliveryReport | null = null,
	): Promise<boolean> {
		try { await this.removeRecordedPartial(row, root); return true; }
		catch {
			this.#assertWriter();
			this.#repository.discardJournalAndSetState(
				row.job_id, 'failed', 'staging-ownership-lost', report,
			);
			return false;
		}
	}

	async #publicationFailure(
		jobId: string,
		root: SoundscaperDeliveryRoot,
		write: SoundscaperDeliveryWrite,
	): Promise<void> {
		const journal = this.#repository.journal(jobId);
		if (!journal) return;
		const published = await this.#filesystem.inspectFinal(root, String(journal.final_name), this.#fileFence);
		const row = this.#repository.row(jobId);
		const exactPublished = exactJournalArtifact(published, journal)
			&& sameDeliveryFileIdentity(published!, rowIdentity(row));
		if (exactPublished) {
			if (journal.phase === 'prepared') {
				await syncSoundscaperDeliveryRootDirectory(root, this.#fileFence);
				this.#repository.markPublished(jobId);
			}
			await this.removeRecordedPartial(row, root, write);
			this.#repository.settleCompleted(jobId, journalResult(journal, row));
			return;
		}
		await this.removeRecordedPartial(row, root, write).catch(() => undefined);
		this.#assertWriter();
		this.#repository.discardJournalAndSetState(
			jobId, 'failed', 'publication-conflict', journalResult(journal, row).report,
		);
	}
}

function staleAuthorityFailureCode(
	error: unknown,
): 'stale-plan' | 'stale-project' | null {
	return error instanceof SoundscaperDeliveryContractError
		&& (error.code === 'stale-plan' || error.code === 'stale-project') ? error.code : null;
}

function sealedRow(row: SoundscaperDeliveryQueueRow): void {
	if (row.staging_name === null || row.final_name === null
		|| row.staging_volume_identity === null || row.staging_file_identity === null
		|| row.staging_recovery_token === null
		|| row.staged_byte_length === null || row.staged_sha256 === null) {
		throw new Error('The Soundscaper delivery claim has no sealed staged output.');
	}
}

function recoveryToken(row: SoundscaperDeliveryQueueRow): string {
	if (typeof row.staging_recovery_token !== 'string' || row.staging_recovery_token.length < 8) {
		throw new Error('The recorded Soundscaper delivery stage has no native recovery authority.');
	}
	return row.staging_recovery_token;
}

function rowIdentity(row: SoundscaperDeliveryQueueRow): Readonly<{
	volumeIdentity: string; fileIdentity: string;
}> {
	if (row.staging_volume_identity === null || row.staging_file_identity === null) {
		throw new Error('The recorded Soundscaper delivery staging file has no authenticated identity.');
	}
	return Object.freeze({
		volumeIdentity: row.staging_volume_identity,
		fileIdentity: row.staging_file_identity,
	});
}

function rowRecoveryExpectation(
	row: SoundscaperDeliveryQueueRow,
): ReturnType<typeof rowIdentity> | SoundscaperDeliveryFileInspection {
	const identity = rowIdentity(row);
	if (row.staged_byte_length === null && row.staged_sha256 === null) return identity;
	if (row.staged_byte_length === null || row.staged_sha256 === null) {
		throw new Error('The recorded delivery stage has incomplete sealed recovery evidence.');
	}
	return Object.freeze({
		...identity, byteLength: row.staged_byte_length, sha256: row.staged_sha256,
	});
}

function exactJournalArtifact(
	artifact: Readonly<{ byteLength: number; sha256: string }> | null,
	journal: Record<string, unknown>,
): boolean {
	return Boolean(artifact && artifact.byteLength === Number(journal.byte_length)
		&& artifact.sha256 === journal.sha256);
}

function resultFor(
	row: SoundscaperDeliveryQueueRow,
	description: SoundscaperDeliveryDescriptionV1,
	report: DeliveryReport,
): SoundscaperDeliveryResultV1 {
	return validateSoundscaperDeliveryResultV1({
		kind: 'soundscaper-delivery-result', version: 1,
		projectIdentity: description.projectIdentity,
		planFingerprint: description.planFingerprint,
		publication: {
			fileName: row.final_name, byteLength: row.staged_byte_length, sha256: row.staged_sha256,
		},
		report,
	}, description);
}

function journalResult(
	journal: Record<string, unknown>,
	row: SoundscaperDeliveryQueueRow,
): SoundscaperDeliveryResultV1 {
	return validateSoundscaperDeliveryResultV1(
		JSON.parse(String(journal.result_json)), soundscaperDeliveryDescription(row),
	);
}
