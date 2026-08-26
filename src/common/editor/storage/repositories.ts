/* SPDX-License-Identifier: AGPL-3.0-only */

import { AnalysisCacheRoutingRepository } from './analysis-cache-routing-repository.ts';
import {
	createDeferredAssistanceDerivativeRepository,
	type AssistanceDerivativeRepositoryPort,
} from './deferred-assistance-derivative-repository.ts';
import type { DerivativeCacheLimits } from './derivative-cache-policy.ts';
import { KeyValueRepository } from './key-value-repository.ts';
import { LinkedAudioOriginalSourceReader } from './linked-audio-original-source-reader.ts';
import { LinkedOriginalProjectAliasRepository } from './linked-original-project-alias-repository.ts';
import { LinkedOriginalProjectReachabilityRepository } from './linked-original-project-reachability-repository.ts';
import { LinkedOriginalRepository } from './linked-original-repository.ts';
import { LinkedOriginalStartupReconciliationRepository } from './linked-original-startup-reconciliation-repository.ts';
import {
	LinkedOriginalResolver,
	type LinkedOriginalPort,
} from './linked-original-resolver.ts';
import { LinkedVideoOriginalProjectAliasRepository } from './linked-video-original-project-alias-repository.ts';
import { LinkedVideoOriginalProjectReachabilityRepository } from './linked-video-original-project-reachability-repository.ts';
import { LinkedVideoOriginalRepository } from './linked-video-original-repository.ts';
import {
	LinkedVideoOriginalResolver,
	type LinkedVideoOriginalPort,
} from './linked-video-original-resolver.ts';
import { MediaRepository } from './media-repository.ts';
import { MediaAssetChunkRecords } from './media-asset-chunk-records.ts';
import { isOpfsPcmStorage, type StorageRecord } from './media-records.ts';
import { EncodedCaptureSpoolRepository } from './encoded-capture-spool-repository.ts';
import { FramescaperCaptureSessionManifestRepository } from './framescaper-capture-session-manifest-repository.ts';
import { OpfsPreferredEncodedCaptureChunkPort } from './opfs-preferred-encoded-capture-chunk-port.ts';
import { OpfsRepository } from './opfs-repository.ts';
import { PcmRepository, type PcmRepositoryOptions } from './pcm-repository.ts';
import { ProjectCompareAndSwapRepository } from './project-compare-and-swap-repository.ts';
import { ProjectRepository, type ProjectRepositoryPort } from './project-repository.ts';
import { RawPcmSpoolRepository } from './raw-pcm-spool-repository.ts';
import { RetentionRepository } from './retention-repository.ts';
import type { StorageRepositoryPort } from './repository-port.ts';
import { SourceReadRepository } from './source-read-repository.ts';
import { SourceRecordRepository } from './source-record-repository.ts';
import { SourceRepository } from './source-repository.ts';
import { SourceWriteRepository } from './source-write-repository.ts';
import { TakeCycleRecoveryEnvelopeRepository } from './take-cycle-recovery-envelope-repository.ts';
import { TransientAnalysisCacheRepository } from './transient-analysis-cache-repository.ts';

export interface StorageRepositories {
	readonly projects: ProjectRepositoryPort;
	readonly settings: KeyValueRepository;
	readonly analysis: KeyValueRepository;
	readonly analysisCache: AnalysisCacheRoutingRepository;
	readonly transientAnalysisCache: TransientAnalysisCacheRepository;
	readonly assistanceDerivatives: AssistanceDerivativeRepositoryPort;
	readonly sources: SourceRepository;
	readonly media: MediaRepository;
	readonly linkedOriginalBindings: LinkedOriginalRepository;
	readonly linkedOriginalProjectAliases: LinkedOriginalProjectAliasRepository;
	readonly linkedOriginalProjectReachability: LinkedOriginalProjectReachabilityRepository;
	readonly linkedOriginalStartupReconciliation: LinkedOriginalStartupReconciliationRepository;
	readonly linkedOriginals: LinkedOriginalResolver | null;
	readonly linkedVideoOriginalBindings: LinkedVideoOriginalRepository;
	readonly linkedVideoOriginalProjectAliases: LinkedVideoOriginalProjectAliasRepository;
	readonly linkedVideoOriginalProjectReachability: LinkedVideoOriginalProjectReachabilityRepository;
	readonly linkedVideoOriginals: LinkedVideoOriginalResolver | null;
	readonly opfs: OpfsRepository;
	readonly pcm: PcmRepository;
	readonly retention: RetentionRepository;
	readonly rawPcmSpools: RawPcmSpoolRepository;
	readonly encodedCaptureChunks: OpfsPreferredEncodedCaptureChunkPort;
	readonly encodedCaptureSpools: EncodedCaptureSpoolRepository;
	readonly framescaperCaptureManifests: FramescaperCaptureSessionManifestRepository;
	readonly takeCycleRecoveryEnvelopes: TakeCycleRecoveryEnvelopeRepository;
}

export interface StorageRepositoryOptions {
	readonly revisionLimit: number;
	readonly preferOpfs: boolean;
	readonly storageManager?: StorageManager | null;
	readonly opfsRoot?: FileSystemDirectoryHandle | null;
	readonly opfsDirectoryName?: string;
	readonly opfsWorkerName?: string;
	readonly pcmCodec?: PcmRepositoryOptions['codec'];
	readonly pcmCodecFactory?: PcmRepositoryOptions['codecFactory'];
	readonly derivativeCacheLimits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly derivativeCacheNow?: () => number;
	readonly transientAnalysisCacheLimits?: Readonly<Pick<
		DerivativeCacheLimits,
		'maximumBytes' | 'maximumEntries' | 'maximumAgeMs'
	>>;
	readonly transientAnalysisCacheNow?: () => number;
	readonly linkedOriginalPort?: LinkedOriginalPort | null;
	readonly linkedVideoOriginalPort?: LinkedVideoOriginalPort | null;
}

export type StorageRepositoryFactory = (
	port: StorageRepositoryPort,
	options: StorageRepositoryOptions,
) => StorageRepositories;

/** Compose storage domains once while keeping their backend port narrow. */
export function createStorageRepositories(
	port: StorageRepositoryPort,
	options: StorageRepositoryOptions,
): StorageRepositories {
	const opfs = new OpfsRepository({
		preferOpfs: options.preferOpfs,
		storageManager: options.storageManager,
		opfsRoot: options.opfsRoot,
		opfsDirectoryName: options.opfsDirectoryName,
		opfsWorkerName: options.opfsWorkerName,
	});
	const pcm = new PcmRepository({
		codec: options.pcmCodec,
		codecFactory: options.pcmCodecFactory,
	});
	const sourceRecords = new SourceRecordRepository(port);
	const analysis = new KeyValueRepository(port, 'analysis');
	const transientAnalysisCache = new TransientAnalysisCacheRepository(analysis, {
		limits: options.transientAnalysisCacheLimits,
		now: options.transientAnalysisCacheNow,
	});
	const assistanceDerivatives = createDeferredAssistanceDerivativeRepository(analysis);
	const analysisCache = new AnalysisCacheRoutingRepository(analysis, transientAnalysisCache);
	const media = new MediaRepository(port, opfs, {
		cacheLimits: options.derivativeCacheLimits,
		now: options.derivativeCacheNow,
	});
	const linkedOriginalBindings = new LinkedOriginalRepository(port);
	const linkedOriginalProjectAliases = new LinkedOriginalProjectAliasRepository(port);
	const linkedOriginalProjectReachability = new LinkedOriginalProjectReachabilityRepository(port);
	const linkedOriginalStartupReconciliation = new LinkedOriginalStartupReconciliationRepository(port);
	const linkedOriginals = options.linkedOriginalPort
		? new LinkedOriginalResolver(linkedOriginalBindings, options.linkedOriginalPort)
		: null;
	const linkedVideoOriginalBindings = new LinkedVideoOriginalRepository(port);
	const linkedVideoOriginalProjectAliases = new LinkedVideoOriginalProjectAliasRepository(port);
	const linkedVideoOriginalProjectReachability = new LinkedVideoOriginalProjectReachabilityRepository(port);
	const linkedVideoOriginals = options.linkedVideoOriginalPort
		? new LinkedVideoOriginalResolver(linkedVideoOriginalBindings, options.linkedVideoOriginalPort)
		: null;
	const deleteStoredSource = async (source: StorageRecord): Promise<void> => {
		if (isOpfsPcmStorage(source.storage) && source.path) await opfs.deletePath(source.path);
		else if (source.sourceToken) await sourceRecords.deleteChunks(source.sourceToken);
	};
	const writer = new SourceWriteRepository({
		records: sourceRecords,
		pcm,
		opfs,
		database: port.database,
		deleteStoredSource,
	});
	const linkedAudio = linkedOriginals
		? new LinkedAudioOriginalSourceReader({ bindings: linkedOriginalBindings, resolver: linkedOriginals })
		: null;
	const reader = new SourceReadRepository({
		records: sourceRecords,
		pcm,
		opfs,
		fallback: linkedAudio,
	});
	const sources = new SourceRepository({
		records: sourceRecords,
		writer,
		reader,
		media,
		analysis,
		transientAnalysisCache,
		opfs,
		pcm,
	});
	const rawPcmSpools = new RawPcmSpoolRepository(analysis, sourceRecords);
	const encodedCaptureChunks = new OpfsPreferredEncodedCaptureChunkPort({
		values: analysis,
		opfs,
		fallback: new MediaAssetChunkRecords(port),
	});
	const encodedCaptureSpools = new EncodedCaptureSpoolRepository(
		analysis,
		encodedCaptureChunks,
	);
	const framescaperCaptureManifests = new FramescaperCaptureSessionManifestRepository(analysis);
	const takeCycleRecoveryEnvelopes = new TakeCycleRecoveryEnvelopeRepository(analysis);
	const projects = new ProjectRepository(port, options.revisionLimit);
	return Object.freeze({
		projects: new ProjectCompareAndSwapRepository(projects, port, options.revisionLimit),
		settings: new KeyValueRepository(port, 'settings'),
		analysis,
		analysisCache,
		transientAnalysisCache,
		assistanceDerivatives,
		sources,
		media,
		linkedOriginalBindings,
		linkedOriginalProjectAliases,
		linkedOriginalProjectReachability,
		linkedOriginalStartupReconciliation,
		linkedOriginals,
		linkedVideoOriginalBindings,
		linkedVideoOriginalProjectAliases,
		linkedVideoOriginalProjectReachability,
		linkedVideoOriginals,
		opfs,
		pcm,
		retention: new RetentionRepository({
			port, sourceRecords, sources, media, opfs, rawPcmSpools,
			encodedCaptureSpools, encodedCaptureChunks, transientAnalysisCache, assistanceDerivatives,
		}),
		rawPcmSpools,
		encodedCaptureChunks,
		encodedCaptureSpools,
		framescaperCaptureManifests,
		takeCycleRecoveryEnvelopes,
	});
}
