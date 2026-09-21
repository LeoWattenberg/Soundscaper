/* SPDX-License-Identifier: AGPL-3.0-only */

#include "vamp_analyzer_peer.h"
#include "vamp_analyzer_adapter.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <filesystem>
#include <limits>
#include <memory>
#include <string>
#include <vector>

namespace soundscaper::vamp {
namespace {

constexpr std::size_t maximumFrameBytes = 16u * 1024u * 1024u;
constexpr std::size_t maximumTextBytes = 4096u;
constexpr std::uint8_t protocolVersion = 1u;
constexpr std::array<std::uint8_t, 4> magic{ 'M', '5', 'A', '1' };

enum class Operation : std::uint8_t {
	scan = 1u, open = 2u, configure = 3u, process = 4u,
	finish = 5u, cancel = 6u, close = 7u,
};

enum class FrameReadStatus : std::uint8_t { ready, cleanEof, malformed };

std::uint32_t decode32(const std::uint8_t *bytes)
{
	return static_cast<std::uint32_t>(bytes[0]) | static_cast<std::uint32_t>(bytes[1]) << 8u
		| static_cast<std::uint32_t>(bytes[2]) << 16u | static_cast<std::uint32_t>(bytes[3]) << 24u;
}

void encode32(std::uint8_t *bytes, std::uint32_t value)
{
	for (std::uint32_t index = 0u; index < 4u; ++index) {
		bytes[index] = static_cast<std::uint8_t>(value >> (index * 8u));
	}
}

bool exactRead(FILE *stream, void *bytes, std::size_t length)
{
	return length == 0u || std::fread(bytes, 1u, length, stream) == length;
}

bool exactWrite(FILE *stream, const void *bytes, std::size_t length)
{
	return (length == 0u || std::fwrite(bytes, 1u, length, stream) == length)
		&& std::fflush(stream) == 0;
}

class Reader final {
public:
	explicit Reader(const std::vector<std::uint8_t> &bytes) : bytes_(bytes) {}
	bool byte(std::uint8_t &value) { return take(&value, sizeof(value)); }
	bool unsigned32(std::uint32_t &value)
	{
		std::uint8_t bytes[4];
		if (!take(bytes, sizeof(bytes))) return false;
		value = decode32(bytes);
		return true;
	}
	bool unsigned64(std::uint64_t &value)
	{
		std::uint8_t bytes[8];
		if (!take(bytes, sizeof(bytes))) return false;
		value = 0u;
		for (std::uint32_t index = 0u; index < 8u; ++index) {
			value |= static_cast<std::uint64_t>(bytes[index]) << (index * 8u);
		}
		return true;
	}
	bool number(double &value)
	{
		std::uint64_t encoded = 0u;
		if (!unsigned64(encoded)) return false;
		std::memcpy(&value, &encoded, sizeof(value));
		return std::isfinite(value);
	}
	bool text(std::string &value, std::size_t maximum = maximumTextBytes, bool empty = false)
	{
		std::uint32_t length = 0u;
		if (!unsigned32(length) || (!empty && length == 0u) || length > maximum || remaining() < length) return false;
		value.assign(reinterpret_cast<const char *>(bytes_.data() + offset_), length);
		offset_ += length;
		return value.find('\0') == std::string::npos;
	}
	bool floats(std::vector<float> &value, std::uint32_t count)
	{
		const std::size_t length = static_cast<std::size_t>(count) * sizeof(float);
		if (count > maximumFrameBytes / sizeof(float) || remaining() < length) return false;
		value.resize(count);
		std::memcpy(value.data(), bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	bool done() const { return offset_ == bytes_.size(); }
private:
	bool take(void *target, std::size_t length)
	{
		if (remaining() < length) return false;
		std::memcpy(target, bytes_.data() + offset_, length);
		offset_ += length;
		return true;
	}
	std::size_t remaining() const { return bytes_.size() - offset_; }
	const std::vector<std::uint8_t> &bytes_;
	std::size_t offset_ = 0u;
};

class Writer final {
public:
	bool byte(std::uint8_t value) { return append(&value, sizeof(value)); }
	bool unsigned32(std::uint32_t value)
	{
		std::uint8_t bytes[4]; encode32(bytes, value); return append(bytes, sizeof(bytes));
	}
	bool signed32(std::int32_t value) { return unsigned32(static_cast<std::uint32_t>(value)); }
	bool unsigned64(std::uint64_t value)
	{
		std::uint8_t bytes[8];
		for (std::uint32_t index = 0u; index < 8u; ++index) {
			bytes[index] = static_cast<std::uint8_t>(value >> (index * 8u));
		}
		return append(bytes, sizeof(bytes));
	}
	bool signed64(std::int64_t value) { return unsigned64(static_cast<std::uint64_t>(value)); }
	bool number(double value)
	{
		if (!std::isfinite(value)) return false;
		std::uint64_t encoded = 0u;
		std::memcpy(&encoded, &value, sizeof(encoded));
		return unsigned64(encoded);
	}
	bool text(const std::string &value)
	{
		return value.size() <= UINT32_MAX && unsigned32(static_cast<std::uint32_t>(value.size()))
			&& append(value.data(), value.size());
	}
	bool blob(const std::vector<std::uint8_t> &value)
	{
		return value.size() <= UINT32_MAX && unsigned32(static_cast<std::uint32_t>(value.size()))
			&& append(value.data(), value.size());
	}
	const std::vector<std::uint8_t> &bytes() const { return bytes_; }
private:
	bool append(const void *value, std::size_t length)
	{
		if (length > maximumFrameBytes - bytes_.size()) return false;
		if (length == 0u) return true;
		const auto *first = static_cast<const std::uint8_t *>(value);
		bytes_.insert(bytes_.end(), first, first + length);
		return true;
	}
	std::vector<std::uint8_t> bytes_;
};

bool optionalNumber(Writer &writer, const std::optional<float> &value)
{
	return writer.byte(value.has_value() ? 1u : 0u)
		&& (!value.has_value() || writer.number(static_cast<double>(*value)));
}

bool outputDescription(Writer &writer, const OutputDescriptor &value)
{
	if (!writer.text(value.identifier) || !writer.text(value.name) || !writer.text(value.description)
		|| !writer.text(value.unit) || !writer.byte(value.binCount.has_value() ? 1u : 0u)
		|| (value.binCount.has_value() && !writer.unsigned32(static_cast<std::uint32_t>(*value.binCount)))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.binNames.size()))) return false;
	for (const auto &name : value.binNames) if (!writer.text(name)) return false;
	if (!writer.byte(value.extents.has_value() ? 1u : 0u)
		|| (value.extents.has_value() && (!writer.number(value.extents->first)
			|| !writer.number(value.extents->second)))
		|| !optionalNumber(writer, value.quantizeStep)
		|| !writer.byte(static_cast<std::uint8_t>(value.sampleType))
		|| !optionalNumber(writer, value.sampleRate)
		|| !writer.byte(value.hasDuration ? 1u : 0u)) return false;
	return true;
}

bool analyzerDescription(Writer &writer, const AnalyzerDescriptor &value)
{
	if (!writer.text(value.identifier) || !writer.text(value.name) || !writer.text(value.description)
		|| !writer.text(value.maker) || !writer.text(value.copyright)
		|| !writer.signed32(value.pluginVersion) || !writer.unsigned32(value.vampApiVersion)
		|| !writer.byte(static_cast<std::uint8_t>(value.inputDomain))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.minimumChannels))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.maximumChannels))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.preferredStepSize))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.preferredBlockSize))
		|| !writer.unsigned32(static_cast<std::uint32_t>(value.parameters.size()))) return false;
	for (const auto &parameter : value.parameters) {
		if (!writer.text(parameter.identifier) || !writer.text(parameter.name)
			|| !writer.text(parameter.description) || !writer.text(parameter.unit)
			|| !writer.number(parameter.minimumValue) || !writer.number(parameter.maximumValue)
			|| !writer.number(parameter.defaultValue) || !optionalNumber(writer, parameter.quantizeStep)
			|| !writer.unsigned32(static_cast<std::uint32_t>(parameter.valueNames.size()))) return false;
		for (const auto &name : parameter.valueNames) if (!writer.text(name)) return false;
	}
	if (!writer.unsigned32(static_cast<std::uint32_t>(value.programs.size()))) return false;
	for (const auto &program : value.programs) if (!writer.text(program)) return false;
	if (!writer.unsigned32(static_cast<std::uint32_t>(value.outputs.size()))) return false;
	for (const auto &output : value.outputs) if (!outputDescription(writer, output)) return false;
	return true;
}

bool features(Writer &writer, const std::vector<Feature> &values)
{
	if (!writer.unsigned32(static_cast<std::uint32_t>(values.size()))) return false;
	for (const auto &value : values) {
		if (!writer.text(value.outputId) || !writer.byte(value.timestamp.has_value() ? 1u : 0u)
			|| (value.timestamp.has_value() && (!writer.signed64(value.timestamp->seconds)
				|| !writer.signed32(value.timestamp->nanoseconds)))
			|| !writer.byte(value.duration.has_value() ? 1u : 0u)
			|| (value.duration.has_value() && (!writer.signed64(value.duration->seconds)
				|| !writer.signed32(value.duration->nanoseconds)))
			|| !writer.unsigned32(static_cast<std::uint32_t>(value.values.size()))) return false;
		for (const float number : value.values) if (!writer.number(number)) return false;
		if (!writer.text(value.label)) return false;
	}
	return true;
}

FrameReadStatus readFrame(std::vector<std::uint8_t> &body)
{
	std::uint8_t header[8];
	const std::size_t first = std::fread(header, 1u, 1u, stdin);
	if (first == 0u) return std::feof(stdin) ? FrameReadStatus::cleanEof : FrameReadStatus::malformed;
	if (!exactRead(stdin, header + 1u, sizeof(header) - 1u)
		|| !std::equal(magic.begin(), magic.end(), header)) return FrameReadStatus::malformed;
	const std::uint32_t length = decode32(header + magic.size());
	if (length < 2u || length > maximumFrameBytes) return FrameReadStatus::malformed;
	body.resize(length);
	return exactRead(stdin, body.data(), body.size()) ? FrameReadStatus::ready : FrameReadStatus::malformed;
}

bool writeFrame(const std::vector<std::uint8_t> &body)
{
	if (body.empty() || body.size() > maximumFrameBytes) return false;
	std::uint8_t header[8];
	std::copy(magic.begin(), magic.end(), header);
	encode32(header + magic.size(), static_cast<std::uint32_t>(body.size()));
	return exactWrite(stdout, header, sizeof(header)) && exactWrite(stdout, body.data(), body.size());
}

std::filesystem::path utf8Path(const std::string &value)
{
	return std::filesystem::path(std::u8string(
		reinterpret_cast<const char8_t *>(value.data()),
		reinterpret_cast<const char8_t *>(value.data() + value.size())));
}

class AnalyzerPeer final {
public:
	bool finished() const { return finished_; }
	bool dispatch(const std::vector<std::uint8_t> &request, std::vector<std::uint8_t> &answer)
	{
		Reader reader(request);
		std::uint8_t version = 0u, rawOperation = 0u;
		if (!reader.byte(version) || !reader.byte(rawOperation) || version != protocolVersion
			|| rawOperation < static_cast<std::uint8_t>(Operation::scan)
			|| rawOperation > static_cast<std::uint8_t>(Operation::close)) return false;
		const auto operation = static_cast<Operation>(rawOperation);
		Writer payload;
		std::string detail;
		Status status = execute(operation, reader, payload, detail);
		if (!reader.done()) { status = Status::invalidArgument; detail = "The M5A1 request has trailing bytes."; }
		Writer response;
		if (!response.byte(protocolVersion) || !response.byte(rawOperation)
			|| !response.unsigned32(static_cast<std::uint32_t>(status))) return false;
		if (status == Status::ok) {
			if (!response.blob(payload.bytes())) return false;
		} else if (!response.text(detail.empty() ? "The Vamp analyzer request was refused." : detail)) return false;
		answer = response.bytes();
		return true;
	}
private:
	Status execute(Operation operation, Reader &reader, Writer &writer, std::string &detail)
	{
		switch (operation) {
		case Operation::scan: return scan(reader, writer, detail);
		case Operation::open: return open(reader, writer, detail);
		case Operation::configure: return configure(reader, writer, detail);
		case Operation::process: return process(reader, writer, detail);
		case Operation::finish: return finish(writer, detail);
		case Operation::cancel:
			if (analyzer_ == nullptr) return Status::invalidArgument;
			analyzer_->cancel(); return Status::ok;
		case Operation::close:
			if (analyzer_ != nullptr) analyzer_->cancel();
			analyzer_.reset(); finished_ = true; return Status::ok;
		}
		return Status::invalidArgument;
	}
	Status scan(Reader &reader, Writer &writer, std::string &detail)
	{
		std::string path;
		double sampleRate = 0.0;
		if (!reader.text(path, 32768u) || !reader.number(sampleRate)) return Status::invalidArgument;
		std::vector<AnalyzerDescriptor> values;
		const Status status = ExactVampAnalyzer::scanExactLibrary(utf8Path(path), sampleRate, values, detail);
		if (status != Status::ok) return status;
		if (!writer.unsigned32(static_cast<std::uint32_t>(values.size()))) return Status::limitExceeded;
		for (const auto &value : values) if (!analyzerDescription(writer, value)) return Status::limitExceeded;
		return Status::ok;
	}
	Status open(Reader &reader, Writer &writer, std::string &detail)
	{
		if (analyzer_ != nullptr) return Status::invalidArgument;
		std::string path, identifier;
		double sampleRate = 0.0;
		if (!reader.text(path, 32768u) || !reader.text(identifier, 256u)
			|| !reader.number(sampleRate)) return Status::invalidArgument;
		const Status status = ExactVampAnalyzer::openExactLibrary(
			utf8Path(path), identifier, sampleRate, analyzer_, detail);
		if (status != Status::ok) return status;
		if (!analyzerDescription(writer, analyzer_->descriptor())) {
			analyzer_.reset(); return Status::limitExceeded;
		}
		return Status::ok;
	}
	Status configure(Reader &reader, Writer &writer, std::string &detail)
	{
		if (analyzer_ == nullptr) return Status::invalidArgument;
		Configuration value;
		std::uint32_t channels = 0u, step = 0u, block = 0u, parameterCount = 0u;
		std::uint8_t hasProgram = 0u;
		if (!reader.number(value.sampleRate) || !reader.unsigned32(channels)
			|| !reader.unsigned32(step) || !reader.unsigned32(block)
			|| !reader.unsigned64(value.frameCount) || !reader.unsigned32(parameterCount)
			|| parameterCount > 256u) return Status::invalidArgument;
		value.channelCount = channels; value.stepSize = step; value.blockSize = block;
		for (std::uint32_t index = 0u; index < parameterCount; ++index) {
			std::string identifier; double number = 0.0;
			if (!reader.text(identifier, 256u) || !reader.number(number)
				|| number < -std::numeric_limits<float>::max() || number > std::numeric_limits<float>::max()) {
				return Status::invalidArgument;
			}
			value.parameters.emplace_back(std::move(identifier), static_cast<float>(number));
		}
		if (!reader.byte(hasProgram) || hasProgram > 1u) return Status::invalidArgument;
		if (hasProgram == 1u) {
			std::string program;
			if (!reader.text(program, 512u, true)) return Status::invalidArgument;
			value.program = std::move(program);
		}
		std::vector<OutputDescriptor> outputs;
		const Status status = analyzer_->configure(value, outputs, detail);
		if (status != Status::ok) return status;
		if (!writer.unsigned32(static_cast<std::uint32_t>(outputs.size()))) return Status::limitExceeded;
		for (const auto &output : outputs) if (!outputDescription(writer, output)) return Status::limitExceeded;
		return Status::ok;
	}
	Status process(Reader &reader, Writer &writer, std::string &detail)
	{
		if (analyzer_ == nullptr) return Status::invalidArgument;
		std::uint64_t startFrame = 0u;
		std::uint32_t channelCount = 0u, frameCount = 0u;
		if (!reader.unsigned64(startFrame) || !reader.unsigned32(channelCount)
			|| !reader.unsigned32(frameCount) || channelCount < 1u || channelCount > 64u
			|| frameCount < 1u || frameCount > 65536u) return Status::invalidArgument;
		std::vector<std::vector<float>> planes(channelCount);
		std::vector<const float *> pointers(channelCount);
		for (std::uint32_t channel = 0u; channel < channelCount; ++channel) {
			if (!reader.floats(planes[channel], frameCount)) return Status::invalidArgument;
			pointers[channel] = planes[channel].data();
		}
		std::vector<Feature> values;
		const Status status = analyzer_->processPcm(
			startFrame, pointers.data(), channelCount, frameCount, values, detail);
		return status != Status::ok ? status
			: features(writer, values) ? Status::ok : Status::limitExceeded;
	}
	Status finish(Writer &writer, std::string &detail)
	{
		if (analyzer_ == nullptr) return Status::invalidArgument;
		std::vector<Feature> values;
		const Status status = analyzer_->finish(values, detail);
		return status != Status::ok ? status
			: features(writer, values) ? Status::ok : Status::limitExceeded;
	}
	std::unique_ptr<ExactVampAnalyzer> analyzer_;
	bool finished_ = false;
};

} // namespace

int runVampAnalyzerPeer()
{
	AnalyzerPeer peer;
	for (;;) {
		std::vector<std::uint8_t> request, answer;
		const FrameReadStatus status = readFrame(request);
		if (status != FrameReadStatus::ready) return status == FrameReadStatus::cleanEof ? 0 : 125;
		if (!peer.dispatch(request, answer) || !writeFrame(answer)) return 125;
		if (peer.finished()) return 0;
	}
}

} // namespace soundscaper::vamp
