/* SPDX-License-Identifier: AGPL-3.0-only */

/** Adds durable renderer-derived V7/V8 inputs without broadening project-body authority. */

import type { NativeQueueRecordV2 } from '../src/common/editor/native-queue-record.ts';
import type { NativeQueueRevalidationV1 } from '../src/common/editor/native-queue-state-machine.ts';
import type { NativeMediaHelperPoolJobRequest } from './native-media-helper-pool.ts';
import type { HelperJobRequest } from './helper-supervisor.ts';
import type { PreparedNativeMediaQueueJob } from './native-media-queue-dispatcher.ts';
import type { FramescaperNativeProjectAuthority } from './native-services-project-authority.ts';
import type { FramescaperNativeRenderInputStaging } from './native-services-render-input-staging.ts';
import type { FramescaperNativeRootGrant } from './native-services-root-repository.ts';

export interface FramescaperNativeSelectedV20ProjectAuthorityOptions {
	readonly project: FramescaperNativeProjectAuthority;
	readonly renderInputs: Pick<
		FramescaperNativeRenderInputStaging,
		'revalidate' | 'inspect' | 'settle'
	>;
}

export class FramescaperNativeSelectedV20ProjectAuthority {
	readonly #project: FramescaperNativeProjectAuthority;
	readonly #renderInputs: FramescaperNativeSelectedV20ProjectAuthorityOptions['renderInputs'];

	constructor(options: FramescaperNativeSelectedV20ProjectAuthorityOptions) {
		if (!options || typeof options !== 'object' || Array.isArray(options)
			|| Reflect.ownKeys(options).length !== 2) {
			throw new TypeError('Selected-V20 project authority requires exact composed options.');
		}
		this.#project = options.project;
		this.#renderInputs = options.renderInputs;
	}

	projectState(projectId: string) { return this.#project.projectState(projectId); }
	watchProject(projectId: string) { return this.#project.watchProject(projectId); }
	watchImportAlreadyPresent(projectId: string, contentSha256: string): Promise<boolean> {
		return this.#project.watchImportAlreadyPresent(projectId, contentSha256);
	}

	async revalidate(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant | null,
		rootAuthorized: boolean,
	): Promise<NativeQueueRevalidationV1> {
		const [base, derivedMatch] = await Promise.all([
			this.#project.revalidate(record, root, rootAuthorized),
			this.#renderInputs.revalidate(record),
		]);
		return Object.freeze({
			...base,
			inputFingerprintsMatch: base.inputFingerprintsMatch && derivedMatch,
		});
	}

	async prepare(
		record: NativeQueueRecordV2,
		root: FramescaperNativeRootGrant,
	): Promise<PreparedNativeMediaQueueJob> {
		if (record.planVersion !== 7 && record.planVersion !== 8) {
			return this.#project.prepare(record, root);
		}
		const derived = await this.#renderInputs.inspect(record);
		const prepared = await this.#project.prepare(record, root);
		try {
			if (prepared.request.kind !== 'media-render') {
				throw new Error('A selected-V20 V7/V8 queue record requires one media-render helper job.');
			}
			const preparedRequest = prepared.request as HelperJobRequest<'media-render'>;
			const preparedCleanup = prepared.cleanup;
			const maximumInputBytes = preparedRequest.resourcePolicy?.maximumInputBytes;
			if (!preparedCleanup || !Number.isSafeInteger(maximumInputBytes) || maximumInputBytes! < 0) {
				throw new Error('A selected-V20 V7/V8 helper job lacks exact cleanup or input-byte authority.');
			}
			const grant = preparedRequest.grant;
			const stagedBytes = grant.plan.byteLength
				+ grant.sources.reduce((sum, source) => safeSum(sum, inputBytes(source)), 0)
				+ derived.byteLength;
			if (stagedBytes > record.reservations.scratchBytes) {
				throw new RangeError('The selected-V20 queue scratch reservation cannot hold its exact derived inputs.');
			}
			const sources = Object.freeze([
				...grant.sources,
				...await derived.materialize(grant.scratch.rootPath),
			]);
			const request: NativeMediaHelperPoolJobRequest = Object.freeze({
				...preparedRequest,
				grant: Object.freeze({ ...grant, sources }),
				resourcePolicy: Object.freeze({
					...preparedRequest.resourcePolicy,
					maximumInputBytes: safeSum(maximumInputBytes!, derived.byteLength),
				}),
			}) as NativeMediaHelperPoolJobRequest;
			let settled = false;
			return Object.freeze({
				request,
				publish: prepared.publish,
				cleanup: async (outcome: 'succeeded' | 'paused' | 'cancelled' | 'failed') => {
					if (settled) return;
					settled = true;
					let failure: unknown = null;
					try { await preparedCleanup(outcome); } catch (error) { failure = error; }
					try { await this.#renderInputs.settle(record, outcome); }
					catch (error) { failure ??= error; }
					if (failure) throw failure;
				},
			});
		} catch (error) {
			await prepared.cleanup?.('failed').catch(() => undefined);
			throw error;
		}
	}
}

function inputBytes(value: Readonly<{ readonly type: string; readonly bytes?: number; readonly binding?: Readonly<{ byteLength: number }> }>): number {
	return value.type === 'file' ? value.bytes ?? invalidBytes() : value.binding?.byteLength ?? invalidBytes();
}

function safeSum(left: number, right: number): number {
	if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left < 0 || right < 0
		|| left > Number.MAX_SAFE_INTEGER - right) throw new RangeError('Selected-V20 staged byte accounting overflowed.');
	return left + right;
}

function invalidBytes(): never { throw new Error('A selected-V20 helper input has no exact byte identity.'); }
