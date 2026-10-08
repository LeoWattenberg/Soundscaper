/* SPDX-License-Identifier: AGPL-3.0-only */
#ifndef SOUNDSCAPER_PROFESSIONAL_PEER_CODEC_H
#define SOUNDSCAPER_PROFESSIONAL_PEER_CODEC_H
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <string>
#include <vector>
#include <algorithm>
namespace soundscaper::professional::codec {
constexpr size_t maximumFrameBytes = 16u * 1024u * 1024u;
inline uint32_t decode32(const uint8_t *bytes)
{
	return static_cast<uint32_t>(bytes[0]) | static_cast<uint32_t>(bytes[1]) << 8u
		| static_cast<uint32_t>(bytes[2]) << 16u | static_cast<uint32_t>(bytes[3]) << 24u;
}
inline void encode32(uint8_t *bytes, uint32_t value)
{
	for (uint32_t index = 0u; index < 4u; ++index) bytes[index] = static_cast<uint8_t>(value >> (index * 8u));
}
class Reader {
public:
	explicit Reader(const std::vector<uint8_t> &bytes) : bytes_(bytes) {}
	bool byte(uint8_t &value) { return take(&value, 1u); }
	bool unsigned32(uint32_t &value)
	{
		uint8_t bytes[4];
		if (!take(bytes, sizeof(bytes))) return false;
		value = decode32(bytes);
		return true;
	}
	bool number(double &value)
	{
		uint8_t bytes[8];
		if (!take(bytes, sizeof(bytes))) return false;
		uint64_t encoded = 0u;
		for (uint32_t index = 0u; index < 8u; ++index) encoded |= static_cast<uint64_t>(bytes[index]) << (index * 8u);
		std::memcpy(&value, &encoded, sizeof(value));
		return true;
	}
	bool text(std::string &value, size_t maximum = 4096u)
	{
		uint32_t length = 0u;
		if (!unsigned32(length) || length == 0u || length > maximum || remaining() < length) return false;
		value.assign(reinterpret_cast<const char *>(bytes_.data() + offset_), length);
		offset_ += length;
		return value.find('\0') == std::string::npos;
	}
	bool blob(std::vector<uint8_t> &value, size_t maximum)
	{
		uint32_t length = 0u;
		if (!unsigned32(length) || length > maximum || remaining() < length) return false;
		value.assign(bytes_.begin() + static_cast<ptrdiff_t>(offset_),
			bytes_.begin() + static_cast<ptrdiff_t>(offset_ + length));
		offset_ += length;
		return true;
	}
	bool floats(std::vector<float> &value, uint32_t count)
	{
		const size_t length = static_cast<size_t>(count) * sizeof(float);
		if (count > maximumFrameBytes / sizeof(float) || remaining() < length) return false;
		value.resize(count);
		std::memcpy(value.data(), bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	bool done() const { return offset_ == bytes_.size(); }
private:
	bool take(void *output, size_t length)
	{
		if (remaining() < length) return false;
		std::memcpy(output, bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	size_t remaining() const { return bytes_.size() - offset_; }
	const std::vector<uint8_t> &bytes_;
	size_t offset_ = 0u;
};

class Writer {
public:
	bool byte(uint8_t value) { return append(&value, 1u); }
	bool unsigned32(uint32_t value)
	{
		uint8_t bytes[4]; encode32(bytes, value); return append(bytes, sizeof(bytes));
	}
	bool number(double value)
	{
		uint64_t encoded = 0u;
		std::memcpy(&encoded, &value, sizeof(encoded));
		uint8_t bytes[8];
		for (uint32_t index = 0u; index < 8u; ++index) {
			bytes[index] = static_cast<uint8_t>(encoded >> (index * 8u));
		}
		return append(bytes, sizeof(bytes));
	}
	bool text(const char *value)
	{
		const size_t length = value == nullptr ? 0u : std::strlen(value);
		return length <= UINT32_MAX && unsigned32(static_cast<uint32_t>(length)) && append(value, length);
	}
	bool blob(const void *value, size_t length)
	{
		return length <= UINT32_MAX && unsigned32(static_cast<uint32_t>(length)) && append(value, length);
	}
	bool floats(const std::vector<float> &value) { return append(value.data(), value.size() * sizeof(float)); }
	const std::vector<uint8_t> &bytes() const { return bytes_; }
private:
	bool append(const void *value, size_t length)
	{
		if (length > maximumFrameBytes - bytes_.size()) return false;
		if (length == 0u) return true;
		const auto *first = static_cast<const uint8_t *>(value);
		bytes_.insert(bytes_.end(), first, first + length);
		return true;
	}
	std::vector<uint8_t> bytes_;
};

}
#endif
