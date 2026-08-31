/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TRANSIENT_ANALYSIS_ALGORITHM,
	normalizeTransientAnalysisParameters,
} from '../src/common/editor/transient-analysis.ts';
import {
	createTransientAnalysisCacheRecord,
	transientAnalysisIdentity,
} from '../src/common/editor/storage/transient-analysis-cache.ts';
import {
	TransientAnalysisCacheRepository,
	type TransientAnalysisCacheKeyValuePort,
} from '../src/common/editor/storage/transient-analysis-cache-repository.ts';

test('a settled transient analysis cache hit does not rescan its physical namespaces', async () => {
	const values = new CountingKeyValuePort();
	const repository = new TransientAnalysisCacheRepository(values, {
		limits: { maximumBytes: 1_000_000, maximumEntries: 4, maximumAgeMs: 60_000 },
		now: () => 1_000,
	});
	const record = cacheRecord();
	await repository.save(record.key, record);
	values.prefixScans = 0;

	assert.equal((await repository.load(record.key))?.key, record.key);

	assert.equal(values.prefixScans, 0);
});

class CountingKeyValuePort implements TransientAnalysisCacheKeyValuePort {
	readonly #values = new Map<string, unknown>();
	prefixScans = 0;

	get(key: string): unknown { return clone(this.#values.get(key)); }
	put(key: string, value: unknown): unknown {
		this.#values.set(key, clone(value));
		return clone(value);
	}
	delete(key: string): boolean { return this.#values.delete(key); }
	deleteByPrefix(prefix: string): number {
		let deleted = 0;
		for (const key of this.#values.keys()) {
			if (key.startsWith(prefix) && this.#values.delete(key)) deleted += 1;
		}
		return deleted;
	}
	replaceIfCurrent(key: string, expected: unknown, replacement: unknown): boolean {
		if (!sameValue(this.#values.get(key), expected)) return false;
		this.#values.set(key, clone(replacement));
		return true;
	}
	deleteIfCurrent(key: string, expected: unknown): boolean {
		if (!sameValue(this.#values.get(key), expected)) return false;
		return this.#values.delete(key);
	}
	listByPrefix(prefix: string): readonly Readonly<{ key: string; projectId: string; value: unknown }>[] {
		this.prefixScans += 1;
		return [...this.#values.entries()]
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, value]) => ({ key, projectId: '', value: clone(value) }));
	}
}

function cacheRecord() {
	const parameters = normalizeTransientAnalysisParameters({
		windowFrames: 64,
		hopFrames: 32,
		baselineWindowHops: 4,
		sensitivity: 1.5,
		minimumSpacingFrames: 128,
		floorDbfs: -60,
	});
	const sourceRange = Object.freeze({ startFrame: 0, endFrame: 10_000 });
	const identity = transientAnalysisIdentity({
		sourceSha256: '1'.repeat(64),
		sourceRange,
		parameters,
	});
	return createTransientAnalysisCacheRecord(identity, {
		algorithmId: TRANSIENT_ANALYSIS_ALGORITHM.id,
		algorithmRevision: TRANSIENT_ANALYSIS_ALGORITHM.revision,
		channelPolicy: identity.channelPolicy,
		parameters,
		sourceRange,
		transients: Object.freeze([]),
	});
}

function sameValue(left: unknown, right: unknown): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function clone<Value>(value: Value): Value {
	return value === undefined ? value : structuredClone(value);
}
