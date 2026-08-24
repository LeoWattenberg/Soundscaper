/* SPDX-License-Identifier: AGPL-3.0-only */

type Awaitable<Value> = Value | PromiseLike<Value>;

export type FramescaperM5bDiagnosticProfileId =
	| 'native-media'
	| 'professional-media'
	| 'persistent-services'
	| 'clean-display'
	| 'openfx';

export interface FramescaperM5bDiagnosticRequest {
	readonly profileId: FramescaperM5bDiagnosticProfileId;
	readonly workloadId: string;
	readonly fixtureId: string;
	readonly timeoutMs: number;
}

export interface FramescaperM5bObservedRuntimeProfile {
	readonly architecture: string;
	readonly displayIdentity: string;
	readonly displayServer: string;
	readonly driverVersion: string;
	readonly exercisedCapabilityIds: readonly string[];
	readonly gpuModel: string;
	readonly helperBinarySha256: string | null;
	readonly mediaDecodeBackend: string;
	readonly mediaEncodeBackend: string;
	readonly mediaHostSha256: string | null;
	readonly nativeAddonSha256: string | null;
	readonly ofxGpuBackend: string;
	readonly ofxRuntimeHostSha256: string | null;
	readonly ofxScannerSha256: string | null;
	readonly osImage: string;
	readonly osVersion: string;
	readonly packageSha256: string | null;
	readonly platformId: string;
	readonly rendererClass: 'hardware' | 'software' | 'unknown';
	readonly workloadRunnerSha256: string | null;
}

export interface FramescaperM5bDiagnosticSink {
	observe(metricId: string, sample: number): void;
}

export interface FramescaperM5bDiagnosticAdapter {
	run(
		request: Readonly<FramescaperM5bDiagnosticRequest>,
		sink: FramescaperM5bDiagnosticSink,
		signal: AbortSignal,
	): Awaitable<FramescaperM5bObservedRuntimeProfile>;
}

export interface FramescaperM5bRawDiagnostic {
	readonly observedRuntimeProfile: Readonly<FramescaperM5bObservedRuntimeProfile>;
	readonly observations: Readonly<Record<string, readonly number[]>>;
}

const MAXIMUM_SAMPLES_PER_METRIC = 262_144;
const SHA256 = /^[a-f0-9]{64}$/u;
const PROFILE_FIELDS = Object.freeze([
	'architecture', 'displayIdentity', 'displayServer', 'driverVersion',
	'exercisedCapabilityIds', 'gpuModel', 'helperBinarySha256', 'mediaDecodeBackend',
	'mediaEncodeBackend', 'mediaHostSha256', 'nativeAddonSha256', 'ofxGpuBackend',
	'ofxRuntimeHostSha256', 'ofxScannerSha256', 'osImage', 'osVersion',
	'packageSha256', 'platformId', 'rendererClass', 'workloadRunnerSha256',
] as const);
const DIGEST_FIELDS = Object.freeze([
	'helperBinarySha256', 'mediaHostSha256', 'nativeAddonSha256', 'ofxRuntimeHostSha256',
	'ofxScannerSha256', 'packageSha256', 'workloadRunnerSha256',
] as const);
const PIPELINES = Object.freeze({
	'native-media': pipeline(
		'm5b-native-media-plan-parity-and-decode', 'm5b-native-media-parity-and-longform-v1',
		['media-decode', 'media-encode', 'media-render'],
		['nativeMedia.planParityDivergences', 'nativeMedia.latePublications',
			'nativeMedia.partialPublications', 'nativeMedia.losslessPixelMismatches',
			'nativeMedia.minimumSsim', 'nativeMedia.minimumPsnrDb',
			'nativeMedia.avEndpointFrameDelta', 'nativeMedia.editorialAudioPositionErrorSamples',
			'nativeMedia.editorialVideoPositionErrorFrames',
			'nativeMedia.editorialNestedPositionErrorFrames',
			'nativeMedia.editorialMulticameraSyncErrorSamples',
			'nativeMedia.uhdLongGopThroughputRatioVersusWasm',
			'nativeMedia.nativeCpuRealtimeFactor', 'nativeMedia.cancellationP95Ms',
			'nativeMedia.crashDetectionMaximumMs', 'nativeMedia.editorRecoveryMaximumMs',
			'nativeMedia.helperPeakRssBytes'],
	),
	'professional-media': pipeline(
		'm5b-professional-media-tier', 'm5b-professional-format-row-suite-v1',
		['professional-decode', 'professional-encode', 'image-sequence', 'proxy'],
		['professionalMedia.uncoveredRequiredFormatRows',
			'professionalMedia.inferredColorObservations', 'professionalMedia.unreportedAlphaLosses',
			'professionalMedia.imageSequenceOrderingErrors',
			'professionalMedia.proxyTimingDivergences',
			'professionalMedia.proxyAuthoritativeExports'],
	),
	'persistent-services': pipeline(
		'm5b-persistent-services-recovery', 'm5b-persistent-services-fault-v1',
		['persistent-queue', 'watch-folder', 'scratch-volume'],
		['nativeServices.unrecoveredJobs', 'nativeServices.partialPublications',
			'nativeServices.unauthorizedGrants', 'nativeServices.traversalEscapes',
			'nativeServices.duplicateWatchImports', 'nativeServices.externalFileDeletions',
			'nativeServices.duplicateDispatches'],
	),
	'clean-display': pipeline(
		'm5b-clean-external-display', 'm5b-clean-display-30m-v1',
		['clean-display-1080p60', 'clean-display-uhd30'],
		['cleanDisplay.corruptFrames', 'cleanDisplay.reorderedFrames',
			'cleanDisplay.unexplainedDroppedFrames', 'cleanDisplay.avDriftFrames',
			'cleanDisplay.soakDurationSeconds'],
	),
	openfx: pipeline(
		'm5b-openfx-isolation-and-packaging', 'm5b-openfx-conformance-and-hostile-v1',
		['openfx-scan', 'openfx-render', 'openfx-hostile-suite'],
		['ofx.uncontainedFailures', 'ofx.editorTakedowns', 'ofx.silentEffectOmissions',
			'ofx.authoredStateLosses', 'ofx.unqualifiedTargets', 'ofx.hostProcessTreeRssBytes'],
	),
});

/** Run one packaged-product workload and return raw observations only. */
export async function runFramescaperM5bDiagnostic(
	requestValue: FramescaperM5bDiagnosticRequest | unknown,
	adapterValue: FramescaperM5bDiagnosticAdapter | unknown,
): Promise<Readonly<FramescaperM5bRawDiagnostic>> {
	const request = validateRequest(requestValue);
	const adapter = validateAdapter(adapterValue);
	const definition = PIPELINES[request.profileId];
	const observations = new Map(definition.metricIds.map((metricId) => [metricId, [] as number[]]));
	const lifetime = new AbortController();
	let active = true;
	const sink: FramescaperM5bDiagnosticSink = Object.freeze({
		observe(metricIdValue: string, sampleValue: number): void {
			if (!active || lifetime.signal.aborted) {
				throw lifetime.signal.reason ?? new Error('Framescaper M5B diagnostic is no longer active.');
			}
			const samples = observations.get(metricIdValue);
			if (!samples) throw new RangeError(`Diagnostic metric ${String(metricIdValue)} is not registered.`);
			if (samples.length >= MAXIMUM_SAMPLES_PER_METRIC) {
				throw new RangeError(`Diagnostic metric ${metricIdValue} exceeds its sample budget.`);
			}
			if (typeof sampleValue !== 'number' || !Number.isFinite(sampleValue) || sampleValue < 0) {
				throw new TypeError(`Diagnostic metric ${metricIdValue} requires a finite non-negative sample.`);
			}
			samples.push(sampleValue);
		},
	});
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			const error = new Error('Framescaper M5B diagnostic timed out.');
			lifetime.abort(error);
			reject(error);
		}, request.timeoutMs);
	});
	try {
		const profile = validateObservedProfile(
			await Promise.race([
				Promise.resolve(adapter.run(request, sink, lifetime.signal)), timeout,
			]), definition.capabilityIds,
		);
		const output: Record<string, readonly number[]> = Object.create(null);
		for (const [metricId, samples] of observations) {
			if (samples.length === 0) throw new Error(`Diagnostic metric ${metricId} has no observations.`);
			output[metricId] = Object.freeze([...samples]);
		}
		return Object.freeze({
			observedRuntimeProfile: profile,
			observations: Object.freeze(output),
		});
	} finally {
		active = false;
		if (timer !== undefined) clearTimeout(timer);
	}
}

function pipeline(
	workloadId: string, fixtureId: string,
	capabilityIds: readonly string[], metricIds: readonly string[],
) {
	return Object.freeze({
		workloadId, fixtureId,
		capabilityIds: Object.freeze([...capabilityIds]),
		metricIds: Object.freeze([...metricIds]),
	});
}

function validateRequest(value: unknown): Readonly<FramescaperM5bDiagnosticRequest> {
	const record = exactRecord(value, ['profileId', 'workloadId', 'fixtureId', 'timeoutMs'], 'diagnostic request');
	if (typeof record.profileId !== 'string' || !Object.hasOwn(PIPELINES, record.profileId)) {
		throw new RangeError('Framescaper M5B diagnostic profile is unsupported.');
	}
	const profileId = record.profileId as FramescaperM5bDiagnosticProfileId;
	const definition = PIPELINES[profileId];
	if (record.workloadId !== definition.workloadId || record.fixtureId !== definition.fixtureId) {
		throw new Error('Framescaper M5B diagnostic workload identity does not match its profile.');
	}
	if (!Number.isSafeInteger(record.timeoutMs) || Number(record.timeoutMs) < 1_000
		|| Number(record.timeoutMs) > 86_400_000) {
		throw new RangeError('Framescaper M5B diagnostic timeout is outside its bounded range.');
	}
	return Object.freeze({
		profileId, workloadId: definition.workloadId,
		fixtureId: definition.fixtureId, timeoutMs: Number(record.timeoutMs),
	});
}

function validateAdapter(value: unknown): FramescaperM5bDiagnosticAdapter {
	if (!value || typeof value !== 'object' || typeof (value as FramescaperM5bDiagnosticAdapter).run !== 'function') {
		throw new TypeError('Framescaper M5B diagnostics require a production workload adapter.');
	}
	return value as FramescaperM5bDiagnosticAdapter;
}

function validateObservedProfile(
	value: unknown,
	expectedCapabilities: readonly string[],
): Readonly<FramescaperM5bObservedRuntimeProfile> {
	const record = exactRecord(value, PROFILE_FIELDS, 'observed runtime profile');
	for (const field of PROFILE_FIELDS) {
		if (field === 'exercisedCapabilityIds' || field === 'rendererClass'
			|| DIGEST_FIELDS.includes(field as (typeof DIGEST_FIELDS)[number])) continue;
		boundedString(record[field], `observed runtime profile.${field}`);
	}
	if (!['hardware', 'software', 'unknown'].includes(String(record.rendererClass))) {
		throw new RangeError('Observed runtime rendererClass is unsupported.');
	}
	for (const field of DIGEST_FIELDS) {
		if (record[field] !== null && (typeof record[field] !== 'string' || !SHA256.test(record[field]))) {
			throw new TypeError(`Observed runtime profile.${field} must be a SHA-256 or null.`);
		}
	}
	if (!Array.isArray(record.exercisedCapabilityIds)
		|| record.exercisedCapabilityIds.length !== expectedCapabilities.length
		|| record.exercisedCapabilityIds.some((id, index) => id !== expectedCapabilities[index])) {
		throw new Error('Observed runtime capabilities do not match the diagnostic profile.');
	}
	return Object.freeze(structuredClone(record)) as unknown as Readonly<FramescaperM5bObservedRuntimeProfile>;
}

function exactRecord<const Field extends string>(
	value: unknown, fields: readonly Field[], label: string,
): Readonly<Record<Field, unknown>> {
	if (!value || typeof value !== 'object' || Array.isArray(value)
		|| (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
		throw new TypeError(`${label} must be a plain record.`);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== fields.length || keys.some(
		(key) => typeof key !== 'string' || !fields.includes(key as Field),
	)) throw new TypeError(`${label} has unsupported fields.`);
	return value as Readonly<Record<Field, unknown>>;
}

function boundedString(value: unknown, label: string): string {
	if (typeof value !== 'string' || value.length < 1 || value.length > 1_024) {
		throw new TypeError(`${label} must be a bounded string.`);
	}
	return value;
}
