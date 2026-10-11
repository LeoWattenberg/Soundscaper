/* SPDX-License-Identifier: AGPL-3.0-only */
#include "frame_carrier.hpp"
#include "../../common/sha256.hpp"
#include "../../framescaper-media-host/src/strict_json.hpp"
#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <limits>
#include <numeric>
#include <span>
#include <stdexcept>
#include <string_view>

namespace motionscaper::media {
namespace {
namespace json = framescaper::media::json;
constexpr std::string_view magic = "motionscaper-linear-rgba-frame-pack-v1\n";
constexpr std::uint64_t safe_integer = 9'007'199'254'740'991ULL;
static_assert(sizeof(float) == 4 && std::numeric_limits<float>::is_iec559);
[[noreturn]] void invalid(const std::string_view detail) { throw std::runtime_error("Invalid Motionscaper float frame carrier: " + std::string{detail}); }
void bytes(std::istream& input, char* target, const std::size_t length) {
	input.read(target, static_cast<std::streamsize>(length));
	if (input.gcount() != static_cast<std::streamsize>(length)) invalid("truncated bytes");
}
template<typename T> T little(std::istream& input) {
	std::array<unsigned char, sizeof(T)> data{}; bytes(input, reinterpret_cast<char*>(data.data()), data.size());
	T result{}; for (std::size_t index = 0; index < data.size(); ++index) result |= static_cast<T>(data[index]) << (8U * index);
	return result;
}
std::uint64_t number(const json::value& value, const std::string_view field, const std::uint64_t minimum, const std::uint64_t maximum) {
	const auto result = json::integer(json::member(value, field), field);
	if (result < 0 || static_cast<std::uint64_t>(result) < minimum || static_cast<std::uint64_t>(result) > maximum) invalid(field);
	return static_cast<std::uint64_t>(result);
}
std::string text(const json::value& value, const std::string_view field) { return std::string{json::string(json::member(value, field), field)}; }
void literal(const json::value& value, const std::string_view field, const std::string_view expected) { if (text(value, field) != expected) invalid(field); }
bool id(const std::string& value) {
	const auto alnum = [](const char c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9'); };
	return !value.empty() && value.size() <= 128 && alnum(value.front())
		&& std::all_of(value.begin(), value.end(), [&](const char c) { return alnum(c) || c == '.' || c == '_' || c == ':' || c == '-'; });
}
bool digest(const std::string& value) {
	return value.size() == 64 && std::all_of(value.begin(), value.end(), [](const char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}
void pixel(const float* value) {
	const float alpha = value[3];
	if (!std::isfinite(alpha) || alpha < 0 || alpha > 1) invalid("pixel alpha");
	for (std::size_t channel = 0; channel < 3; ++channel) {
		if (!std::isfinite(value[channel]) || value[channel] < 0 || static_cast<double>(value[channel]) > static_cast<double>(alpha) + 1e-6) invalid("premultiplied pixel");
	}
}
std::string hex(const std::array<unsigned char, 32>& value) {
	constexpr char digits[] = "0123456789abcdef";
	std::string result; result.reserve(64);
	for (const auto byte : value) { result.push_back(digits[byte >> 4U]); result.push_back(digits[byte & 15U]); }
	return result;
}
} // namespace

frame_carrier::frame_carrier(std::istream& input, const std::uint64_t authenticated_length, const frame_identity& expected) : input_{input} {
	std::string observed(magic.size(), '\0'); bytes(input_, observed.data(), observed.size());
	if (observed != magic) invalid("magic/version");
	const auto header_length = little<std::uint32_t>(input_);
	if (header_length == 0 || header_length > 65'536) invalid("header length");
	std::string header(header_length, '\0'); bytes(input_, header.data(), header.size());
	const auto value = json::parse(header);
	json::require_exact_keys(value, {"identity", "width", "height", "frameRate", "firstFrame", "frameCount", "format", "version", "pixelFormat", "colorSpace", "alphaMode"});
	literal(value, "format", "motionscaper-linear-rgba-frame-pack");
	if (number(value, "version", 1, 1) != 1) invalid("version");
	literal(value, "pixelFormat", "rgba-f32le"); literal(value, "colorSpace", "linear-rec709-d65"); literal(value, "alphaMode", "premultiplied");
	const auto& identity = json::member(value, "identity");
	json::require_exact_keys(identity, {"projectId", "revisionDigest", "compositionId"});
	header_.identity = {text(identity, "projectId"), text(identity, "revisionDigest"), text(identity, "compositionId")};
	if (!id(header_.identity.project_id) || !id(header_.identity.composition_id) || !digest(header_.identity.revision_digest)
		|| header_.identity.project_id != expected.project_id || header_.identity.composition_id != expected.composition_id
		|| header_.identity.revision_digest != expected.revision_digest) invalid("pinned identity");
	header_.width = static_cast<std::uint32_t>(number(value, "width", 1, 16'777'216));
	header_.height = static_cast<std::uint32_t>(number(value, "height", 1, 16'777'216));
	const auto pixels = static_cast<std::uint64_t>(header_.width) * header_.height;
	if (pixels > 16'777'216) invalid("pixel bound");
	const auto& rate = json::member(value, "frameRate"); json::require_exact_keys(rate, {"num", "den"});
	header_.rate_num = static_cast<std::uint32_t>(number(rate, "num", 1, 0x7fffffff));
	header_.rate_den = static_cast<std::uint32_t>(number(rate, "den", 1, 0x7fffffff));
	if (std::gcd(header_.rate_num, header_.rate_den) != 1) invalid("noncanonical rational cadence");
	header_.first_frame = number(value, "firstFrame", 0, safe_integer);
	header_.frame_count = number(value, "frameCount", 1, 100'000'000);
	if (header_.first_frame > safe_integer - header_.frame_count) invalid("cadence overflow");
	const auto prefix_length = magic.size() + 4 + header_length;
	const auto record_length = 48 + pixels * 16;
	if (header_.frame_count > (safe_integer - prefix_length) / record_length
		|| authenticated_length != prefix_length + header_.frame_count * record_length) invalid("exact file length");
}

linear_frame frame_carrier::read(const std::uint64_t index) {
	if (index != next_ || index >= header_.frame_count) invalid("sequential ordinal");
	const auto samples = static_cast<std::size_t>(header_.width) * header_.height * 4;
	if (little<std::uint64_t>(input_) != index || little<std::uint64_t>(input_) != samples * sizeof(float)) invalid("frame record");
	linear_frame result{header_.width, header_.height, std::vector<float>(samples)};
	scape::native_common::sha256 sha;
	std::array<std::byte, 16'384> chunk{};
	for (std::size_t offset = 0; offset < samples;) {
		const auto count = std::min(chunk.size() / 4, samples - offset);
		bytes(input_, reinterpret_cast<char*>(chunk.data()), count * 4); sha.update(std::span{chunk}.first(count * 4));
		for (std::size_t sample = 0; sample < count; ++sample) {
			std::uint32_t word{};
			for (std::size_t byte = 0; byte < 4; ++byte) word |= std::to_integer<std::uint32_t>(chunk[sample * 4 + byte]) << (8U * byte);
			result.pixels[offset + sample] = std::bit_cast<float>(word);
		}
		offset += count;
	}
	std::array<unsigned char, 32> expected_digest{}; bytes(input_, reinterpret_cast<char*>(expected_digest.data()), expected_digest.size());
	if (sha.finish_hex() != hex(expected_digest)) invalid("pixel digest");
	for (std::size_t offset = 0; offset < samples; offset += 4) pixel(result.pixels.data() + offset);
	++next_; return result;
}

std::vector<std::uint16_t> rgba64_rec709(const linear_frame& input) {
	if (input.pixels.size() != static_cast<std::uint64_t>(input.width) * input.height * 4) invalid("conversion dimensions");
	std::vector<std::uint16_t> result(input.pixels.size());
	for (std::size_t offset = 0; offset < input.pixels.size(); offset += 4) {
		const auto* sample = input.pixels.data() + offset; pixel(sample);
		const double alpha = sample[3];
		for (std::size_t channel = 0; channel < 3; ++channel) {
			const double linear = alpha == 0 ? 0 : std::min(1.0, sample[channel] / alpha);
			const double encoded = linear < 0.018 ? linear * 4.5 : 1.099 * std::pow(linear, 0.45) - 0.099;
			result[offset + channel] = static_cast<std::uint16_t>(std::llround(encoded * 65535));
		}
		result[offset + 3] = static_cast<std::uint16_t>(std::llround(alpha * 65535));
	}
	return result;
}
} // namespace motionscaper::media
