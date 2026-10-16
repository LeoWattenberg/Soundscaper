/* SPDX-License-Identifier: AGPL-3.0-only */

/** Continuous native neighborhoods and YCoCg noise reduction. Every tap reads
 * the same immutable source; no byte mean, encoded plane, separable pass or
 * intermediate Float32 store replaces the existing CPU neighborhood model. */
export const PIXEL_FRAME_WEBGL2_SPATIAL_NEIGHBORHOOD_FUNCTIONS_CURRENT_V1 = `
const int SPATIAL_BINOMIAL3_CURRENT_V1[3] = int[3](1, 2, 1);
const int SPATIAL_BINOMIAL5_CURRENT_V1[5] = int[5](1, 4, 6, 4, 1);
const int SPATIAL_BINOMIAL7_CURRENT_V1[7] = int[7](1, 6, 15, 20, 15, 6, 1);

float spatialEncodedCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.0031308 ? magnitude * 12.92
		: 1.055 * pow(magnitude, 1.0 / 2.4) - 0.055);
}

float spatialLinearCurrentV1(float value) {
	float magnitude = abs(value);
	return sign(value) * (magnitude <= 0.04045 ? magnitude / 12.92
		: pow((magnitude + 0.055) / 1.055, 2.4));
}

vec3 spatialEncodedRgbCurrentV1(vec3 value) {
	return vec3(spatialEncodedCurrentV1(value.r), spatialEncodedCurrentV1(value.g), spatialEncodedCurrentV1(value.b));
}

float spatialLumaCurrentV1(vec3 value) { return (54.0 * value.r + 183.0 * value.g + 19.0 * value.b) / 256.0; }

vec4 spatialSourceCurrentV1(ivec2 index) {
	return texelFetch(uImage, clamp(index, ivec2(0), uExtent - ivec2(1)), 0);
}

int spatialBinCurrentV1(int radius, int coordinate) {
	if (radius == 1) return SPATIAL_BINOMIAL3_CURRENT_V1[coordinate + 1];
	if (radius == 2) return SPATIAL_BINOMIAL5_CURRENT_V1[coordinate + 2];
	return SPATIAL_BINOMIAL7_CURRENT_V1[coordinate + 3];
}

// dy-major, dx-minor matches the direct immutable CPU accumulation order.
// channel=-1 is continuous encoded luma; 0/1/2 are encoded RGB components.
float spatialMeanCurrentV1(ivec2 index, int radius, int channel) {
	float sum = 0.0, weight = 0.0;
	for (int dy = -3; dy <= 3; dy++) for (int dx = -3; dx <= 3; dx++) {
		if (abs(dx) > radius || abs(dy) > radius) continue;
		vec4 neighbor = spatialSourceCurrentV1(index + ivec2(dx, dy));
		if (neighbor.a == 0.0) continue;
		float w = neighbor.a * float(spatialBinCurrentV1(radius, dx)) * float(spatialBinCurrentV1(radius, dy));
		float sampleValue;
		if (channel == -1) sampleValue = spatialLumaCurrentV1(spatialEncodedRgbCurrentV1(neighbor.rgb));
		else sampleValue = spatialEncodedCurrentV1(neighbor[channel]);
		weight += w; sum += w * sampleValue;
	}
	// Active callers have positive center alpha, so the normative weight is >0.
	return sum / weight;
}

float spatialDarkCurrentV1(ivec2 index) {
	float dark = 1.0;
	for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
		vec4 neighbor = spatialSourceCurrentV1(index + ivec2(dx, dy));
		vec3 encodedNeighbor = spatialEncodedRgbCurrentV1(neighbor.rgb);
		float low = min(encodedNeighbor.r, min(encodedNeighbor.g, encodedNeighbor.b));
		// This estimate deliberately composites every tap against white,
		// including alpha-zero taps; it is not a weighted RGB mean.
		dark = min(dark, low * neighbor.a + 1.0 - neighbor.a);
	}
	return clamp(dark, 0.0, 1.0);
}

vec3 spatialNoiseCurrentV1(ivec2 index, vec3 encoded) {
	float co = encoded.r - encoded.b, t = (encoded.r + encoded.b) / 2.0;
	float cg = encoded.g - t, luma = t + cg / 2.0;
	float nextY = luma, nextCo = co, nextCg = cg;
	if (uParams0.x != 0.0) {
		float sum = 0.0, weight = 0.0, minimum = luma, maximum = luma;
		for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
			vec4 neighbor = spatialSourceCurrentV1(index + ivec2(dx, dy));
			if (neighbor.a == 0.0) continue;
			vec3 rgb = spatialEncodedRgbCurrentV1(neighbor.rgb);
			float ny = (rgb.r + rgb.b) / 4.0 + rgb.g / 2.0;
			minimum = min(minimum, ny); maximum = max(maximum, ny);
			float w = neighbor.a * (dx == 0 ? 2.0 : 1.0) * (dy == 0 ? 2.0 : 1.0)
				* max(0.0, 16.0 - abs(ny - luma) * 255.0 * uParams0.y / 256.0);
			weight += w; sum += w * ny;
		}
		if (weight > 0.0) {
			float protection = uParams0.z / 256.0 * clamp(maximum - minimum, 0.0, 1.0);
			nextY += (sum / weight - luma) * uParams0.x / 256.0 * (1.0 - protection);
		}
	}
	if (uParams0.w != 0.0) {
		float sumCo = 0.0, sumCg = 0.0, weight = 0.0;
		for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) {
			float inner = abs(dx) <= 1 && abs(dy) <= 1
				? (dx == 0 ? 2.0 : 1.0) * (dy == 0 ? 2.0 : 1.0) : 0.0;
			float spatial = inner * 16.0 * (1.0 - uParams1.y / 256.0)
				+ float(SPATIAL_BINOMIAL5_CURRENT_V1[dx + 2] * SPATIAL_BINOMIAL5_CURRENT_V1[dy + 2]) * uParams1.y / 256.0;
			if (spatial == 0.0) continue;
			vec4 neighbor = spatialSourceCurrentV1(index + ivec2(dx, dy));
			if (neighbor.a == 0.0) continue;
			vec3 rgb = spatialEncodedRgbCurrentV1(neighbor.rgb);
			float nco = rgb.r - rgb.b, ncg = rgb.g - (rgb.r + rgb.b) / 2.0;
			float distance = max(abs(nco - co), abs(ncg - cg));
			float w = spatial * neighbor.a * max(0.0, 16.0 - distance * 255.0 * uParams1.x / 256.0);
			weight += w; sumCo += w * nco; sumCg += w * ncg;
		}
		if (weight > 0.0) {
			nextCo += (sumCo / weight - co) * uParams0.w / 256.0;
			nextCg += (sumCg / weight - cg) * uParams0.w / 256.0;
		}
	}
	// The two reductions read the same original encoded sample/neighborhood.
	// Preserve the exact inactive/protected case before inverse YCoCg algebra.
	if (nextY == luma && nextCo == co && nextCg == cg) return encoded;
	float nextT = nextY - nextCg / 2.0, nextBlue = nextT - nextCo / 2.0;
	return vec3(nextBlue + nextCo, nextCg + nextT, nextBlue);
}
`;
