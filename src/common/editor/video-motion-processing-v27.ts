/* SPDX-License-Identifier: AGPL-3.0-only */

/** Deterministic CPU motion processing with an optional GPU execution port. */

export interface VideoPointV1 {
	readonly x: number;
	readonly y: number;
}

export interface GrayVideoFrameV1 {
	readonly width: number;
	readonly height: number;
	readonly samples: readonly number[];
}

export interface ShiTomasiFeatureV1 extends VideoPointV1 {
	readonly score: number;
}

export interface LucasKanadeTrackV1 {
	readonly source: VideoPointV1;
	readonly target: VideoPointV1;
	readonly status: 'tracked' | 'lost';
	readonly error: number;
}

export interface VideoPointMatchV1 {
	readonly source: VideoPointV1;
	readonly target: VideoPointV1;
	readonly confidence: number;
}

export interface VideoSimilarityTransformV1 {
	readonly scale: number;
	readonly rotationRadians: number;
	readonly translateX: number;
	readonly translateY: number;
	readonly inlierCount: number;
	readonly meanError: number;
}

const MAXIMUM_PIXELS = 16_777_216;
const MAXIMUM_FEATURES = 4_096;
const MAXIMUM_RANSAC_MATCHES = 512;

export function createGrayVideoFrameV1(value: Readonly<{
	readonly width: unknown;
	readonly height: unknown;
	readonly samples: unknown;
}>): GrayVideoFrameV1 {
	const width = positiveInteger(value?.width, 'gray frame width');
	const height = positiveInteger(value?.height, 'gray frame height');
	if (width * height > MAXIMUM_PIXELS) throw new RangeError('The gray frame exceeds its pixel bound.');
	if (!Array.isArray(value?.samples) || value.samples.length !== width * height) {
		throw new RangeError('The gray frame requires exactly width times height samples.');
	}
	const samples = value.samples.map((sample, index) => bounded(
		sample, 0, 1, `gray frame sample ${String(index)}`,
	));
	return Object.freeze({ width, height, samples: Object.freeze(samples) });
}

export function detectShiTomasiFeaturesV1(
	frameValue: GrayVideoFrameV1,
	options: Readonly<{
		readonly maximumFeatures: number;
		readonly quality: number;
		readonly minimumDistance: number;
	}>,
): readonly ShiTomasiFeatureV1[] {
	const frame = frameValueChecked(frameValue, 'Shi-Tomasi frame');
	const maximumFeatures = boundedInteger(options?.maximumFeatures, 1, MAXIMUM_FEATURES, 'Shi-Tomasi maximum features');
	const quality = bounded(options?.quality, Number.EPSILON, 1, 'Shi-Tomasi quality');
	const minimumDistance = bounded(options?.minimumDistance, 0, 256, 'Shi-Tomasi minimum distance');
	const candidates: ShiTomasiFeatureV1[] = [];
	let maximumScore = 0;
	for (let y = 2; y < frame.height - 2; y += 1) {
		for (let x = 2; x < frame.width - 2; x += 1) {
			let xx = 0;
			let xy = 0;
			let yy = 0;
			for (let oy = -1; oy <= 1; oy += 1) {
				for (let ox = -1; ox <= 1; ox += 1) {
					const gradientX = (pixel(frame, x + ox + 1, y + oy) - pixel(frame, x + ox - 1, y + oy)) / 2;
					const gradientY = (pixel(frame, x + ox, y + oy + 1) - pixel(frame, x + ox, y + oy - 1)) / 2;
					xx += gradientX * gradientX;
					xy += gradientX * gradientY;
					yy += gradientY * gradientY;
				}
			}
			const trace = xx + yy;
			const discriminant = Math.sqrt(Math.max(0, (xx - yy) ** 2 + 4 * xy ** 2));
			const score = (trace - discriminant) / 2;
			if (score <= 0) continue;
			maximumScore = Math.max(maximumScore, score);
			candidates.push(Object.freeze({ x, y, score }));
		}
	}
	const threshold = maximumScore * quality;
	candidates.sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x);
	const selected: ShiTomasiFeatureV1[] = [];
	const distanceSquared = minimumDistance ** 2;
	for (const candidate of candidates) {
		if (candidate.score < threshold) break;
		if (selected.some((feature) => (
			(feature.x - candidate.x) ** 2 + (feature.y - candidate.y) ** 2 < distanceSquared
		))) continue;
		selected.push(candidate);
		if (selected.length === maximumFeatures) break;
	}
	return Object.freeze(selected);
}

export function trackPyramidalLucasKanadeV1(
	previousValue: GrayVideoFrameV1,
	nextValue: GrayVideoFrameV1,
	featuresValue: readonly ShiTomasiFeatureV1[],
	options: Readonly<{
		readonly windowRadius: number;
		readonly pyramidLevels: number;
		readonly maximumIterations: number;
		readonly epsilon: number;
	}>,
): readonly LucasKanadeTrackV1[] {
	const previous = frameValueChecked(previousValue, 'Lucas-Kanade previous frame');
	const next = frameValueChecked(nextValue, 'Lucas-Kanade next frame');
	if (previous.width !== next.width || previous.height !== next.height) {
		throw new RangeError('Lucas-Kanade frames must have equal dimensions.');
	}
	if (!Array.isArray(featuresValue) || featuresValue.length > MAXIMUM_FEATURES) {
		throw new RangeError('Lucas-Kanade features exceed their bound.');
	}
	const features = featuresValue.map((feature, index) => featureValue(feature, `Lucas-Kanade feature ${String(index)}`));
	const windowRadius = boundedInteger(options?.windowRadius, 1, 32, 'Lucas-Kanade window radius');
	const requestedLevels = boundedInteger(options?.pyramidLevels, 1, 8, 'Lucas-Kanade pyramid levels');
	const maximumIterations = boundedInteger(options?.maximumIterations, 1, 64, 'Lucas-Kanade iteration count');
	const epsilon = bounded(options?.epsilon, Number.EPSILON, 1, 'Lucas-Kanade epsilon');
	const previousPyramid = buildPyramid(previous, requestedLevels);
	const nextPyramid = buildPyramid(next, previousPyramid.length);
	const levels = Math.min(previousPyramid.length, nextPyramid.length);
	return Object.freeze(features.map((feature) => {
		let targetX = feature.x / 2 ** (levels - 1);
		let targetY = feature.y / 2 ** (levels - 1);
		let tracked = false;
		let finalError = Number.POSITIVE_INFINITY;
		for (let level = levels - 1; level >= 0; level -= 1) {
			if (level < levels - 1) {
				targetX *= 2;
				targetY *= 2;
			}
			const scale = 2 ** level;
			const sourceX = feature.x / scale;
			const sourceY = feature.y / scale;
			const result = lucasKanadeLevel(
				previousPyramid[level]!, nextPyramid[level]!,
				sourceX, sourceY, targetX, targetY,
				windowRadius, maximumIterations, epsilon,
			);
			if (result === null) continue;
			targetX = result.x;
			targetY = result.y;
			finalError = result.error;
			tracked = true;
		}
		const target = Object.freeze({ x: targetX, y: targetY });
		return Object.freeze({
			source: Object.freeze({ x: feature.x, y: feature.y }),
			target,
			status: tracked && inside(next, targetX, targetY, 1) ? 'tracked' as const : 'lost' as const,
			error: finalError,
		});
	}));
}

export function estimateSimilarityRansacV1(
	matchesValue: readonly VideoPointMatchV1[],
	options: Readonly<{ readonly inlierThreshold: number; readonly minimumInliers: number }>,
): VideoSimilarityTransformV1 {
	if (!Array.isArray(matchesValue) || matchesValue.length < 2 || matchesValue.length > MAXIMUM_RANSAC_MATCHES) {
		throw new RangeError(`Similarity RANSAC requires 2 through ${String(MAXIMUM_RANSAC_MATCHES)} matches.`);
	}
	const matches = matchesValue.map((match, index) => matchValue(match, index));
	const threshold = bounded(options?.inlierThreshold, Number.EPSILON, 1_000_000, 'RANSAC inlier threshold');
	const minimumInliers = boundedInteger(options?.minimumInliers, 2, matches.length, 'RANSAC minimum inliers');
	let best: Readonly<{ transform: VideoSimilarityTransformV1; indices: readonly number[]; error: number }> | null = null;
	for (let left = 0; left < matches.length - 1; left += 1) {
		for (let right = left + 1; right < matches.length; right += 1) {
			const transform = similarityFromPair(matches[left]!, matches[right]!);
			if (transform === null) continue;
			const result = classifyInliers(matches, transform, threshold);
			if (best === null || result.indices.length > best.indices.length
				|| (result.indices.length === best.indices.length && result.error < best.error)) {
				best = Object.freeze({ transform, indices: result.indices, error: result.error });
			}
		}
	}
	if (best === null || best.indices.length < minimumInliers) {
		throw new RangeError('Similarity RANSAC could not resolve the required inlier consensus.');
	}
	return fitSimilarity(matches, best.indices);
}

export function applySimilarityTransformV1(
	pointValue: VideoPointV1,
	transformValue: VideoSimilarityTransformV1,
): VideoPointV1 {
	const point = pointValueChecked(pointValue, 'similarity input point');
	const transform = similarityValue(transformValue, 'similarity transform');
	const cosine = Math.cos(transform.rotationRadians) * transform.scale;
	const sine = Math.sin(transform.rotationRadians) * transform.scale;
	return Object.freeze({
		x: cosine * point.x - sine * point.y + transform.translateX,
		y: sine * point.x + cosine * point.y + transform.translateY,
	});
}

/** The inverse camera motion applied to the rendered frame. */
export function resolveStabilizationTransformV1(
	motionValue: VideoSimilarityTransformV1,
	strengthValue: number,
): VideoSimilarityTransformV1 {
	const motion = similarityValue(motionValue, 'camera motion');
	const strength = bounded(strengthValue, 0, 1, 'stabilization strength');
	const inverseScale = 1 / motion.scale;
	const inverseRotation = -motion.rotationRadians;
	const inverseCosine = Math.cos(inverseRotation) * inverseScale;
	const inverseSine = Math.sin(inverseRotation) * inverseScale;
	const inverseTranslateX = -(inverseCosine * motion.translateX - inverseSine * motion.translateY);
	const inverseTranslateY = -(inverseSine * motion.translateX + inverseCosine * motion.translateY);
	return Object.freeze({
		scale: Math.exp(Math.log(inverseScale) * strength),
		rotationRadians: inverseRotation * strength,
		translateX: inverseTranslateX * strength,
		translateY: inverseTranslateY * strength,
		inlierCount: motion.inlierCount,
		meanError: motion.meanError,
	});
}

function lucasKanadeLevel(
	previous: GrayVideoFrameV1,
	next: GrayVideoFrameV1,
	sourceX: number,
	sourceY: number,
	initialX: number,
	initialY: number,
	radius: number,
	iterations: number,
	epsilon: number,
): Readonly<{ x: number; y: number; error: number }> | null {
	if (!inside(previous, sourceX, sourceY, radius + 1)) return null;
	let targetX = initialX;
	let targetY = initialY;
	let meanError = Number.POSITIVE_INFINITY;
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		if (!inside(next, targetX, targetY, radius + 1)) return null;
		let xx = 0;
		let xy = 0;
		let yy = 0;
		let bx = 0;
		let by = 0;
		let absoluteError = 0;
		let count = 0;
		for (let oy = -radius; oy <= radius; oy += 1) {
			for (let ox = -radius; ox <= radius; ox += 1) {
				const nextX = targetX + ox;
				const nextY = targetY + oy;
				const gradientX = (sampleBilinear(next, nextX + 1, nextY) - sampleBilinear(next, nextX - 1, nextY)) / 2;
				const gradientY = (sampleBilinear(next, nextX, nextY + 1) - sampleBilinear(next, nextX, nextY - 1)) / 2;
				const error = sampleBilinear(previous, sourceX + ox, sourceY + oy) - sampleBilinear(next, nextX, nextY);
				xx += gradientX * gradientX;
				xy += gradientX * gradientY;
				yy += gradientY * gradientY;
				bx += gradientX * error;
				by += gradientY * error;
				absoluteError += Math.abs(error);
				count += 1;
			}
		}
		const determinant = xx * yy - xy * xy;
		if (determinant <= 1e-12) return null;
		const deltaX = (yy * bx - xy * by) / determinant;
		const deltaY = (xx * by - xy * bx) / determinant;
		targetX += deltaX;
		targetY += deltaY;
		meanError = absoluteError / count;
		if (deltaX ** 2 + deltaY ** 2 <= epsilon ** 2) break;
	}
	return Object.freeze({ x: targetX, y: targetY, error: meanError });
}

function buildPyramid(frame: GrayVideoFrameV1, maximumLevels: number): readonly GrayVideoFrameV1[] {
	const result = [frame];
	while (result.length < maximumLevels) {
		const previous = result[result.length - 1]!;
		if (previous.width < 8 || previous.height < 8) break;
		const width = Math.floor(previous.width / 2);
		const height = Math.floor(previous.height / 2);
		const samples: number[] = [];
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				samples.push((
					pixel(previous, x * 2, y * 2)
					+ pixel(previous, x * 2 + 1, y * 2)
					+ pixel(previous, x * 2, y * 2 + 1)
					+ pixel(previous, x * 2 + 1, y * 2 + 1)
				) / 4);
			}
		}
		result.push(createGrayVideoFrameV1({ width, height, samples }));
	}
	return Object.freeze(result);
}

function similarityFromPair(left: VideoPointMatchV1, right: VideoPointMatchV1): VideoSimilarityTransformV1 | null {
	const sourceX = right.source.x - left.source.x;
	const sourceY = right.source.y - left.source.y;
	const targetX = right.target.x - left.target.x;
	const targetY = right.target.y - left.target.y;
	const sourceLength = Math.hypot(sourceX, sourceY);
	const targetLength = Math.hypot(targetX, targetY);
	if (sourceLength <= 1e-9 || targetLength <= 1e-9) return null;
	const scale = targetLength / sourceLength;
	const rotationRadians = Math.atan2(
		sourceX * targetY - sourceY * targetX,
		sourceX * targetX + sourceY * targetY,
	);
	const cosine = Math.cos(rotationRadians) * scale;
	const sine = Math.sin(rotationRadians) * scale;
	return Object.freeze({
		scale,
		rotationRadians,
		translateX: left.target.x - (cosine * left.source.x - sine * left.source.y),
		translateY: left.target.y - (sine * left.source.x + cosine * left.source.y),
		inlierCount: 2,
		meanError: 0,
	});
}

function classifyInliers(
	matches: readonly VideoPointMatchV1[],
	transform: VideoSimilarityTransformV1,
	threshold: number,
): Readonly<{ indices: readonly number[]; error: number }> {
	const indices: number[] = [];
	let error = 0;
	for (let index = 0; index < matches.length; index += 1) {
		const match = matches[index]!;
		const mapped = applySimilarityTransformV1(match.source, transform);
		const distance = Math.hypot(mapped.x - match.target.x, mapped.y - match.target.y);
		if (distance <= threshold) {
			indices.push(index);
			error += distance;
		}
	}
	return Object.freeze({ indices: Object.freeze(indices), error });
}

function fitSimilarity(
	matches: readonly VideoPointMatchV1[],
	indices: readonly number[],
): VideoSimilarityTransformV1 {
	let weight = 0;
	let sourceX = 0;
	let sourceY = 0;
	let targetX = 0;
	let targetY = 0;
	for (const index of indices) {
		const match = matches[index]!;
		weight += match.confidence;
		sourceX += match.source.x * match.confidence;
		sourceY += match.source.y * match.confidence;
		targetX += match.target.x * match.confidence;
		targetY += match.target.y * match.confidence;
	}
	sourceX /= weight;
	sourceY /= weight;
	targetX /= weight;
	targetY /= weight;
	let real = 0;
	let imaginary = 0;
	let denominator = 0;
	for (const index of indices) {
		const match = matches[index]!;
		const sx = match.source.x - sourceX;
		const sy = match.source.y - sourceY;
		const tx = match.target.x - targetX;
		const ty = match.target.y - targetY;
		real += match.confidence * (sx * tx + sy * ty);
		imaginary += match.confidence * (sx * ty - sy * tx);
		denominator += match.confidence * (sx * sx + sy * sy);
	}
	if (denominator <= 1e-12) throw new RangeError('Similarity inliers are degenerate.');
	const scale = Math.hypot(real, imaginary) / denominator;
	const rotationRadians = Math.atan2(imaginary, real);
	const cosine = Math.cos(rotationRadians) * scale;
	const sine = Math.sin(rotationRadians) * scale;
	const transform = Object.freeze({
		scale,
		rotationRadians,
		translateX: targetX - (cosine * sourceX - sine * sourceY),
		translateY: targetY - (sine * sourceX + cosine * sourceY),
		inlierCount: indices.length,
		meanError: 0,
	});
	let error = 0;
	for (const index of indices) {
		const match = matches[index]!;
		const mapped = applySimilarityTransformV1(match.source, transform);
		error += Math.hypot(mapped.x - match.target.x, mapped.y - match.target.y);
	}
	return Object.freeze({ ...transform, meanError: error / indices.length });
}

function frameValueChecked(value: unknown, name: string): GrayVideoFrameV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a gray frame.`);
	const candidate = value as Partial<GrayVideoFrameV1>;
	return createGrayVideoFrameV1({ width: candidate.width, height: candidate.height, samples: candidate.samples });
}

function featureValue(value: unknown, name: string): ShiTomasiFeatureV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object.`);
	const candidate = value as Partial<ShiTomasiFeatureV1>;
	return Object.freeze({
		...pointValueChecked(candidate, name),
		score: bounded(candidate.score, 0, Number.MAX_VALUE, `${name} score`),
	});
}

function matchValue(value: unknown, index: number): VideoPointMatchV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`RANSAC match ${String(index)} must be an object.`);
	const candidate = value as Partial<VideoPointMatchV1>;
	return Object.freeze({
		source: pointValueChecked(candidate.source, `RANSAC match ${String(index)} source`),
		target: pointValueChecked(candidate.target, `RANSAC match ${String(index)} target`),
		confidence: bounded(candidate.confidence, Number.EPSILON, 1, `RANSAC match ${String(index)} confidence`),
	});
}

function similarityValue(value: unknown, name: string): VideoSimilarityTransformV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be an object.`);
	const candidate = value as Partial<VideoSimilarityTransformV1>;
	return Object.freeze({
		scale: bounded(candidate.scale, Number.EPSILON, 1_000_000, `${name} scale`),
		rotationRadians: bounded(candidate.rotationRadians, -Math.PI * 2, Math.PI * 2, `${name} rotation`),
		translateX: bounded(candidate.translateX, -1_000_000_000, 1_000_000_000, `${name} translateX`),
		translateY: bounded(candidate.translateY, -1_000_000_000, 1_000_000_000, `${name} translateY`),
		inlierCount: boundedInteger(candidate.inlierCount, 0, MAXIMUM_RANSAC_MATCHES, `${name} inlier count`),
		meanError: bounded(candidate.meanError, 0, 1_000_000_000, `${name} mean error`),
	});
}

function pointValueChecked(value: unknown, name: string): VideoPointV1 {
	if (!value || typeof value !== 'object') throw new TypeError(`${name} must be a point.`);
	const candidate = value as Partial<VideoPointV1>;
	return Object.freeze({
		x: bounded(candidate.x, -1_000_000_000, 1_000_000_000, `${name}.x`),
		y: bounded(candidate.y, -1_000_000_000, 1_000_000_000, `${name}.y`),
	});
}

function pixel(frame: GrayVideoFrameV1, x: number, y: number): number {
	return frame.samples[y * frame.width + x]!;
}

function sampleBilinear(frame: GrayVideoFrameV1, x: number, y: number): number {
	const x0 = Math.max(0, Math.min(frame.width - 1, Math.floor(x)));
	const y0 = Math.max(0, Math.min(frame.height - 1, Math.floor(y)));
	const x1 = Math.min(frame.width - 1, x0 + 1);
	const y1 = Math.min(frame.height - 1, y0 + 1);
	const mixX = Math.max(0, Math.min(1, x - x0));
	const mixY = Math.max(0, Math.min(1, y - y0));
	const top = pixel(frame, x0, y0) + (pixel(frame, x1, y0) - pixel(frame, x0, y0)) * mixX;
	const bottom = pixel(frame, x0, y1) + (pixel(frame, x1, y1) - pixel(frame, x0, y1)) * mixX;
	return top + (bottom - top) * mixY;
}

function inside(frame: GrayVideoFrameV1, x: number, y: number, margin: number): boolean {
	return x >= margin && y >= margin && x <= frame.width - 1 - margin && y <= frame.height - 1 - margin;
}

function positiveInteger(value: unknown, name: string): number {
	return boundedInteger(value, 1, 65_536, name);
}

function boundedInteger(value: unknown, minimum: number, maximum: number, name: string): number {
	if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
		throw new RangeError(`${name} is outside its integer bound.`);
	}
	return Number(value);
}

function bounded(value: unknown, minimum: number, maximum: number, name: string): number {
	if (typeof value !== 'number' || !Number.isFinite(value)
		|| value < minimum || value > maximum) {
		throw new RangeError(`${name} is outside its finite bound.`);
	}
	return Object.is(value, -0) ? 0 : value;
}
