/* SPDX-License-Identifier: AGPL-3.0-only */

/** Exact integer grain lattice and post-crop vignette coverage. Native RGB
 * remains continuous: these helpers do not round, quantize or clip channels.
 * Signed floor and unsigned polynomial arithmetic retain the CPU definitions. */
export const PIXEL_FRAME_WEBGL2_SPATIAL_LATTICE_FUNCTIONS_CURRENT_V1 = `
// Positive denominator; all admitted numerators stay far from INT_MIN.
// GLSL signed division truncates toward zero; CPU Math.floor does not.
int spatialFloorCurrentV1(int numerator, int denominator) {
	return numerator >= 0 ? numerator / denominator : -((-numerator + denominator - 1) / denominator);
}

uint spatialGrainHashCurrentV1(uint value) {
	// h<=65520: h*h+31*h+17<=4294901537, so uint32 never wraps.
	return (value * value + 31u * value + 17u) % 65521u;
}

int spatialGrainLatticeCurrentV1(uint x, uint y, uint seed) {
	uint hashValue = spatialGrainHashCurrentV1((x * 73u + y * 151u + seed * 199u + 101u) % 65521u);
	int first = int(hashValue % 257u);
	hashValue = spatialGrainHashCurrentV1(hashValue);
	return spatialFloorCurrentV1(first + int(hashValue % 257u) - 255, 2);
}

int spatialGrainOctaveCurrentV1(uvec2 index, uint spacing, uint seed) {
	// Current native extents<=8192; the inherited scalar definition also
	// bounds this unsigned center numerator for coordinates through65535.
	uvec2 q = ((2u * index + uvec2(1u)) * 32768u) / spacing;
	uvec2 cell = q / 256u; ivec2 fraction = ivec2(q % 256u);
	int sum = spatialGrainLatticeCurrentV1(cell.x, cell.y, seed) * (256 - fraction.x) * (256 - fraction.y)
		+ spatialGrainLatticeCurrentV1(cell.x + 1u, cell.y, seed) * fraction.x * (256 - fraction.y)
		+ spatialGrainLatticeCurrentV1(cell.x, cell.y + 1u, seed) * (256 - fraction.x) * fraction.y
		+ spatialGrainLatticeCurrentV1(cell.x + 1u, cell.y + 1u, seed) * fraction.x * fraction.y;
	return spatialFloorCurrentV1(sum + 32768, 65536);
}

int spatialGrainNoiseCurrentV1(ivec2 index) {
	uint spacing = uint(uParams0.y), seed = uint(uParams0.w); int roughness = int(uParams0.z);
	int first = spatialGrainOctaveCurrentV1(uvec2(index), spacing, seed);
	int second = spatialGrainOctaveCurrentV1(uvec2(index), spacing / 2u, seed);
	return spatialFloorCurrentV1(first * (256 - roughness) + second * roughness + 128, 256);
}

int spatialVignetteCoordinateCurrentV1(int position, int size, int denominator) {
	// Exact Q8 center coordinate, including negative half ties toward +infinity.
	return spatialFloorCurrentV1(2 * (2 * position + 1 - size) * 256 + denominator, 2 * denominator);
}

int spatialVignetteWeightCurrentV1(ivec2 index) {
	int rx = spatialVignetteCoordinateCurrentV1(index.x, uExtent.x, uExtent.x);
	int ry = spatialVignetteCoordinateCurrentV1(index.y, uExtent.y, uExtent.y);
	int ellipse = rx * rx + ry * ry, square = max(rx * rx, ry * ry), side = min(uExtent.x, uExtent.y);
	int cx = clamp(spatialVignetteCoordinateCurrentV1(index.x, uExtent.x, side), -512, 512);
	int cy = clamp(spatialVignetteCoordinateCurrentV1(index.y, uExtent.y, side), -512, 512);
	int circle = min(131072, cx * cx + cy * cy), roundness = int(uParams0.w), strength = abs(roundness);
	int distance = (ellipse * (256 - strength) + (roundness < 0 ? square : circle) * strength + 128) / 256;
	int t = clamp(spatialFloorCurrentV1((distance - int(uParams0.y)) * 256, max(1, int(uParams0.z))), 0, 256);
	return (t * t * (768 - 2 * t) + 32768) / 65536;
}
`;
