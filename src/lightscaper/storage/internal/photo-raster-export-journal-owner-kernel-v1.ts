/* SPDX-License-Identifier: AGPL-3.0-only */
import { normalizePhotoRasterExportJournalV1, normalizePhotoRasterExportDownloadAckV1, normalizePhotoRasterExportSidecarAckV1, isPhotoRasterExportMemberCompleteV1, photoRasterExportJournalKeyV1,
	type PhotoRasterExportJournalV1, type PhotoRasterExportDownloadAckV1, type PhotoRasterExportSidecarAckV1 } from '../photo-raster-export-journal-v1.ts';
import { readClosedDomainRecord as record, readClosedDomainField as field } from '../../../common/editor/closed-domain-value.ts';
import { normalizePhotoRasterExportJournalCurrentV1 } from '../photo-raster-export-journal-current-v1.ts';

export interface PhotoRasterExportJournalSettingsV1 {
	get(key: string): Promise<unknown>;
	putIfAbsent(key: string, value: unknown): Promise<boolean>;
	replaceIfCurrent(key: string, expected: unknown, value: unknown): Promise<boolean>;
	deleteIfCurrent?(key: string, expected: unknown): Promise<boolean>;
}
export class PhotoRasterExportJournalErrorV1 extends Error {
	readonly failure: Readonly<{ cause: unknown; journal: Readonly<PhotoRasterExportJournalV1> | null; cleanup?: Readonly<{ cause: unknown }> }>;
	constructor(cause: unknown, journal: Readonly<PhotoRasterExportJournalV1> | null, cleanup?: Readonly<{ cause: unknown }>) {
		super('Photo export journal publication is uncertain.', { cause }); this.name = 'PhotoRasterExportJournalErrorV1';
		this.failure = Object.freeze({ cause, journal, ...(cleanup ? { cleanup: Object.freeze({ cause: cleanup.cause }) } : {}) });
	}
}
/** Small CAS owner, not a scheduler. Close joins admitted transport work and
 * deliberately retains durable uncertainty for explicit recovery review. */
export class PhotoRasterExportJournalOwnerKernelV1 {
	readonly #requireNativeClaim: boolean;
	readonly #key: string;
	readonly #settings: Readonly<PhotoRasterExportJournalSettingsV1>;
	#raw: unknown;
	#current: Readonly<PhotoRasterExportJournalV1> | null = null;
	#tail: Promise<void> = Promise.resolve();
	#closed = false;
	protected constructor(profile: 'legacy1' | 'current1', settings: PhotoRasterExportJournalSettingsV1, readonly catalogId: string) {
		if (profile !== 'legacy1' && profile !== 'current1') throw new TypeError('Unsupported fixed photo journal owner profile.');
		this.#requireNativeClaim = profile === 'current1';
		this.#key = photoRasterExportJournalKeyV1(catalogId);
		const pin = <Method>(name: string): Method => {
			const descriptor = Object.getOwnPropertyDescriptor(settings, name), fn: unknown = descriptor?.value;
			if (!descriptor || !Object.hasOwn(descriptor, 'value') || typeof fn !== 'function') throw new TypeError('Photo export journal requires own transport capabilities.');
			return ((...args: unknown[]) => Reflect.apply(fn, settings, args) as unknown) as Method;
		};
		this.#settings = Object.freeze({ get: pin<PhotoRasterExportJournalSettingsV1['get']>('get'), putIfAbsent: pin<PhotoRasterExportJournalSettingsV1['putIfAbsent']>('putIfAbsent'),
			replaceIfCurrent: pin<PhotoRasterExportJournalSettingsV1['replaceIfCurrent']>('replaceIfCurrent'),
			...(Object.hasOwn(settings, 'deleteIfCurrent') ? { deleteIfCurrent: pin<NonNullable<PhotoRasterExportJournalSettingsV1['deleteIfCurrent']>>('deleteIfCurrent') } : {}) });
	}
	get current(): Readonly<PhotoRasterExportJournalV1> | null { return this.#current; }
	load(): Promise<Readonly<PhotoRasterExportJournalV1> | null> {
		return this.#join(async () => {
			const raw = await this.#settings.get(this.#key), journal = raw === undefined ? null : this.#admit(raw);
			this.#raw = raw; this.#current = journal; return journal;
		});
	}
	create(value: unknown): Promise<Readonly<PhotoRasterExportJournalV1>> {
		const journal = this.#admit(value);
		if (journal.revision !== 1 || journal.members.some(member => member.state !== 'pending')) throw new TypeError('A fresh photo export journal starts pending at revision one.');
		return this.#join(async () => { await this.#write(journal, () => this.#settings.putIfAbsent(this.#key, journal)); return journal; });
	}
	started(jobId: string, reviewedRetry = false): Promise<Readonly<PhotoRasterExportJournalV1>> {
		if (typeof reviewedRetry !== 'boolean') throw new TypeError('Photo export retry review must be explicit.');
		return this.#transition(jobId, member => {
			if (member.state === 'committed' || (member.state === 'started' && !reviewedRetry)) throw new TypeError('Uncertain photo downloads require explicit retry review.');
			return { ...member, state: 'started', delivery: null };
		}, true);
	}
	/** Explicit user replacement of a fully acknowledged queue; uncertain history stays protected. */
	replaceCompleted(value: unknown): Promise<Readonly<PhotoRasterExportJournalV1>> {
		const fresh = this.#admit(value);
		if (fresh.revision !== 1 || fresh.members.some(member => member.state !== 'pending')) throw new TypeError('A replacement export journal must be fresh pending work.');
		return this.#join(async () => {
			const current = this.#current;
			if (!current || current.members.some(member => !isPhotoRasterExportMemberCompleteV1(member)) || current.batchId === fresh.batchId) throw new TypeError('Only a fully committed different queue can be replaced explicitly.');
			const journal = this.#admit({ ...fresh, revision: current.revision + 1 });
			await this.#write(journal, () => this.#settings.replaceIfCurrent(this.#key, this.#raw, journal)); return journal;
		});
	}
	committed(jobId: string, ackValue: Readonly<PhotoRasterExportDownloadAckV1>): Promise<Readonly<PhotoRasterExportJournalV1>> {
		const member = this.#current?.members.find(member => member.jobId === jobId);
		if (!member) throw new TypeError('Photo export journal has no captured member.');
		const ack = normalizePhotoRasterExportDownloadAckV1(ackValue, member.fileName);
		return this.#transition(jobId, member => {
			if (member.state !== 'started') throw new TypeError('Photo download ACK requires a durable started intent.');
			return { ...member, state: 'committed', delivery: ack };
		});
	}
	sidecarStarted(jobId: string, reviewedRetry = false): Promise<Readonly<PhotoRasterExportJournalV1>> {
		if (typeof reviewedRetry !== 'boolean') throw new TypeError('Photo companion retry review must be explicit.');
		return this.#transition(jobId, member => {
			if (member.state !== 'committed' || !member.sidecar || member.sidecar.state === 'committed' || (member.sidecar.state === 'started' && !reviewedRetry)) throw new TypeError('Photo companion requires acknowledged raster and explicit uncertainty review.');
			return { ...member, sidecar: { state: 'started', delivery: null } };
		}, true);
	}
	sidecarCommitted(jobId: string, value: Readonly<PhotoRasterExportSidecarAckV1>): Promise<Readonly<PhotoRasterExportJournalV1>> {
		const member = this.#current?.members.find(member => member.jobId === jobId);
		if (!member) throw new TypeError('Photo companion has no captured member.');
		const ack = normalizePhotoRasterExportSidecarAckV1(value, member.fileName);
		return this.#transition(jobId, member => {
			if (member.state !== 'committed' || member.sidecar?.state !== 'started') throw new TypeError('Photo JSON ACK requires durable companion intent.');
			return { ...member, sidecar: { state: 'committed', delivery: ack } };
		});
	}
	/** Forget scalar recovery history after explicit review. This never acquires
	 * a destination or removes any file that may already have been downloaded. */
	discardUnfinished(value: unknown): Promise<void> {
		const input = record(value, 'Photo export queue review', ['batchId', 'revision', 'reviewed']);
		const batchId = field(input, 'batchId', 'queue review'), revision = field(input, 'revision', 'queue review');
		if (field(input, 'reviewed', 'queue review') !== true || typeof batchId !== 'string' || typeof revision !== 'number'
			|| !Number.isSafeInteger(revision) || revision < 1) throw new TypeError('Photo export queue requires explicit current review.');
		return this.#join(async () => {
			const current = this.#current, remove = this.#settings.deleteIfCurrent;
			if (!current || current.batchId !== batchId || current.revision !== revision || current.members.every(isPhotoRasterExportMemberCompleteV1)) throw new TypeError('Only the reviewed current unfinished queue can be forgotten.');
			if (!remove) throw new Error('Photo export queue deletion is unavailable.');
			let cause: unknown = new Error('Photo export queue changed before deletion.');
			try { if (await remove(this.#key, this.#raw) === true) { this.#raw = undefined; this.#current = null; return; } }
			catch (error) { cause = error; }
			let raw: unknown;
			try { raw = await this.#settings.get(this.#key); }
			catch (error) { throw new PhotoRasterExportJournalErrorV1(cause, current, { cause: error }); }
			if (raw !== undefined) throw new PhotoRasterExportJournalErrorV1(cause, current);
			this.#raw = undefined; this.#current = null;
		});
	}
	closeAndJoin(): Promise<void> { this.#closed = true; return this.#tail; }
	#transition(jobId: string, update: (member: PhotoRasterExportJournalV1['members'][number]) => unknown, freshClaim = false): Promise<Readonly<PhotoRasterExportJournalV1>> {
		return this.#join(async () => {
			const current = this.#current;
			if (!current || !current.members.some(member => member.jobId === jobId)) throw new TypeError('Photo export journal has no captured member.');
			const journal = this.#admit({ ...current, revision: current.revision + 1, members: current.members.map(member => member.jobId === jobId ? update(member) : member) });
			await this.#write(journal, () => this.#settings.replaceIfCurrent(this.#key, this.#raw, journal), freshClaim); return journal;
		});
	}
	#admit(value: unknown): Readonly<PhotoRasterExportJournalV1> {
		const result = this.#requireNativeClaim ? normalizePhotoRasterExportJournalCurrentV1(value) : normalizePhotoRasterExportJournalV1(value);
		if (result.catalogId !== this.catalogId) throw new TypeError('Photo export journal belongs to another catalog.'); return result;
	}
	#join<Result>(invoke: () => Promise<Result>): Promise<Result> {
		if (this.#closed) throw new DOMException('Photo export journal retired.', 'AbortError');
		const work = this.#tail.then(invoke); this.#tail = work.then(() => {}, () => {}); return work;
	}
	async #write(journal: Readonly<PhotoRasterExportJournalV1>, invoke: () => Promise<boolean>, freshClaim = false): Promise<void> {
		let cause: unknown = new Error('Photo export journal CAS changed.'), raw: unknown;
		try { if (await invoke() === true) { this.#raw = journal; this.#current = journal; return; } }
		catch (error) { cause = error; }
		try { raw = await this.#settings.get(this.#key); }
		catch (error) { throw new PhotoRasterExportJournalErrorV1(cause, this.#current, { cause: error }); }
		let matching = false;
		try { matching = JSON.stringify(this.#admit(raw)) === JSON.stringify(journal); } catch { /* Foreign history remains protected. */ }
		if (!matching) throw new PhotoRasterExportJournalErrorV1(cause, this.#current);
		this.#raw = raw; this.#current = journal;
		// Matching bytes establish durable uncertainty, never this caller's
		// fresh image/JSON license. Only the true native ACK above grants it.
		if (this.#requireNativeClaim && freshClaim) throw new PhotoRasterExportJournalErrorV1(cause, this.#current);
	}
}
