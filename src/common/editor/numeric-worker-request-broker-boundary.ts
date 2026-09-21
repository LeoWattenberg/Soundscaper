/* SPDX-License-Identifier: AGPL-3.0-only */

import {
	WorkerRequestBroker,
	type WorkerRequestOptions,
} from './worker-request-broker.ts';

type NumericWorkerRequestOptions<Context> = Omit<WorkerRequestOptions<Context>, 'id'> & Readonly<{
	readonly id: number;
}>;

/** Keep numeric protocol identity outside the broker's established string-key API. */
export function createNumericWorkerRequestBrokerBoundary(broker: WorkerRequestBroker) {
	return Object.freeze({
		request<Result = unknown, Context = unknown>(
			options: NumericWorkerRequestOptions<Context>,
		): Promise<Result> {
			const { id, ...requestOptions } = options;
			return broker.request<Result, Context>({ ...requestOptions, id: brokerKey(id) });
		},
		has(id: number): boolean {
			return broker.has(brokerKey(id));
		},
		resolve(id: number, result: unknown): boolean {
			return broker.resolve(brokerKey(id), result);
		},
		reject(id: number, error: unknown): boolean {
			return broker.reject(brokerKey(id), error);
		},
	});
}

function brokerKey(id: number): string {
	return String(id);
}
