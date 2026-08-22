/* SPDX-License-Identifier: AGPL-3.0-only */

#include "strict_json.hpp"

#include <algorithm>
#include <charconv>
#include <cctype>
#include <limits>
#include <sstream>
#include <stdexcept>

namespace framescaper::media::json {
namespace {

constexpr std::size_t maximum_depth = 64;
constexpr std::size_t maximum_nodes = 250'000;
constexpr std::size_t maximum_string_bytes = 4U * 1024U * 1024U;

class parser final {
public:
	explicit parser(const std::string_view source) : source_{source} {}

	[[nodiscard]] value document() {
		if (source_.empty()) fail("JSON is empty");
		auto result = parse_value(0);
		if (offset_ != source_.size()) fail("Trailing bytes are forbidden");
		return result;
	}

private:
	[[noreturn]] void fail(const std::string_view message) const {
		throw parse_error(std::string{message} + " at byte " + std::to_string(offset_) + '.');
	}

	[[nodiscard]] char take() {
		if (offset_ >= source_.size()) fail("Unexpected end of JSON");
		return source_[offset_++];
	}

	void expect(const char expected) {
		if (take() != expected) fail("Unexpected JSON token");
	}

	void count_node(const std::size_t depth) {
		if (depth > maximum_depth) fail("JSON nesting exceeds its ceiling");
		if (++nodes_ > maximum_nodes) fail("JSON node count exceeds its ceiling");
	}

	[[nodiscard]] value parse_value(const std::size_t depth) {
		count_node(depth);
		if (offset_ >= source_.size()) fail("A JSON value is missing");
		switch (source_[offset_]) {
		case 'n': return literal("null", type::null_value, false);
		case 't': return literal("true", type::boolean, true);
		case 'f': return literal("false", type::boolean, false);
		case '"': {
			value result;
			result.kind = type::string;
			result.text = parse_string();
			return result;
		}
		case '[': return parse_array(depth + 1);
		case '{': return parse_object(depth + 1);
		default:
			if (source_[offset_] == '-' || std::isdigit(static_cast<unsigned char>(source_[offset_])) != 0) {
				return parse_number();
			}
			fail("Unsupported JSON value");
		}
	}

	[[nodiscard]] value literal(const std::string_view expected, const type kind, const bool boolean) {
		if (source_.substr(offset_, expected.size()) != expected) fail("Invalid JSON literal");
		offset_ += expected.size();
		value result;
		result.kind = kind;
		result.boolean = boolean;
		return result;
	}

	[[nodiscard]] static unsigned hex_value(const char character) {
		if (character >= '0' && character <= '9') return static_cast<unsigned>(character - '0');
		if (character >= 'a' && character <= 'f') return static_cast<unsigned>(character - 'a' + 10);
		if (character >= 'A' && character <= 'F') return static_cast<unsigned>(character - 'A' + 10);
		throw parse_error("A JSON Unicode escape is invalid.");
	}

	void append_utf8(std::string& result, const unsigned codepoint) {
		if (codepoint == 0 || codepoint > 0x10ffff || (codepoint >= 0xd800 && codepoint <= 0xdfff)) {
			fail("A JSON Unicode scalar is invalid");
		}
		if (codepoint <= 0x7f) result += static_cast<char>(codepoint);
		else if (codepoint <= 0x7ff) {
			result += static_cast<char>(0xc0 | (codepoint >> 6));
			result += static_cast<char>(0x80 | (codepoint & 0x3f));
		} else if (codepoint <= 0xffff) {
			result += static_cast<char>(0xe0 | (codepoint >> 12));
			result += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f));
			result += static_cast<char>(0x80 | (codepoint & 0x3f));
		} else {
			result += static_cast<char>(0xf0 | (codepoint >> 18));
			result += static_cast<char>(0x80 | ((codepoint >> 12) & 0x3f));
			result += static_cast<char>(0x80 | ((codepoint >> 6) & 0x3f));
			result += static_cast<char>(0x80 | (codepoint & 0x3f));
		}
	}

	[[nodiscard]] unsigned escaped_code_unit() {
		unsigned code = 0;
		for (int index = 0; index < 4; ++index) code = (code << 4) | hex_value(take());
		return code;
	}

	[[nodiscard]] std::string parse_string() {
		expect('"');
		std::string result;
		while (true) {
			const auto character = take();
			if (character == '"') break;
			if (static_cast<unsigned char>(character) < 0x20U) fail("A JSON string contains a control byte");
			if (character != '\\') result += character;
			else {
				const auto escaped = take();
				switch (escaped) {
				case '"': result += '"'; break;
				case '\\': result += '\\'; break;
				case '/': result += '/'; break;
				case 'b': result += '\b'; break;
				case 'f': result += '\f'; break;
				case 'n': result += '\n'; break;
				case 'r': result += '\r'; break;
				case 't': result += '\t'; break;
				case 'u': {
					unsigned code = escaped_code_unit();
					if (code >= 0xd800 && code <= 0xdbff) {
						if (take() != '\\' || take() != 'u') fail("A high surrogate lacks its pair");
						const auto low = escaped_code_unit();
						if (low < 0xdc00 || low > 0xdfff) fail("A surrogate pair is invalid");
						code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
					}
					append_utf8(result, code);
					break;
				}
				default: fail("A JSON escape is invalid");
				}
			}
			if (result.size() > maximum_string_bytes) fail("A JSON string exceeds its ceiling");
		}
		return result;
	}

	[[nodiscard]] value parse_number() {
		const auto start = offset_;
		if (source_[offset_] == '-') ++offset_;
		if (offset_ >= source_.size()) fail("A JSON number is truncated");
		if (source_[offset_] == '0') ++offset_;
		else {
			if (source_[offset_] < '1' || source_[offset_] > '9') fail("A JSON integer is invalid");
			while (offset_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[offset_])) != 0) ++offset_;
		}
		if (offset_ < source_.size() && source_[offset_] == '.') {
			++offset_;
			const auto fraction = offset_;
			while (offset_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[offset_])) != 0) ++offset_;
			if (fraction == offset_) fail("A JSON fraction is empty");
		}
		if (offset_ < source_.size() && (source_[offset_] == 'e' || source_[offset_] == 'E')) {
			++offset_;
			if (offset_ < source_.size() && (source_[offset_] == '+' || source_[offset_] == '-')) ++offset_;
			const auto exponent = offset_;
			while (offset_ < source_.size() && std::isdigit(static_cast<unsigned char>(source_[offset_])) != 0) ++offset_;
			if (exponent == offset_) fail("A JSON exponent is empty");
		}
		value result;
		result.kind = type::number;
		result.text = std::string{source_.substr(start, offset_ - start)};
		return result;
	}

	[[nodiscard]] value parse_array(const std::size_t depth) {
		expect('[');
		value result;
		result.kind = type::array;
		if (offset_ < source_.size() && source_[offset_] == ']') { ++offset_; return result; }
		while (true) {
			result.items.push_back(parse_value(depth));
			const auto separator = take();
			if (separator == ']') return result;
			if (separator != ',') fail("A JSON array separator is invalid");
		}
	}

	[[nodiscard]] value parse_object(const std::size_t depth) {
		expect('{');
		value result;
		result.kind = type::object;
		if (offset_ < source_.size() && source_[offset_] == '}') { ++offset_; return result; }
		while (true) {
			if (offset_ >= source_.size() || source_[offset_] != '"') fail("A JSON object key must be a string");
			auto key = parse_string();
			if (std::any_of(result.members.begin(), result.members.end(), [&](const auto& item) {
				return item.first == key;
			})) fail("A duplicate JSON object key is forbidden");
			expect(':');
			result.members.emplace_back(std::move(key), parse_value(depth));
			const auto separator = take();
			if (separator == '}') return result;
			if (separator != ',') fail("A JSON object separator is invalid");
		}
	}

	std::string_view source_;
	std::size_t offset_{};
	std::size_t nodes_{};
};

void require_type(const value& input, const type expected, const std::string_view label) {
	if (input.kind != expected) throw parse_error(std::string{label} + " has the wrong JSON type.");
}

} // namespace

value parse(const std::string_view source) { return parser{source}.document(); }

const value& member(const value& object, const std::string_view name) {
	require_type(object, type::object, "object");
	const auto found = std::find_if(object.members.begin(), object.members.end(), [&](const auto& item) {
		return item.first == name;
	});
	if (found == object.members.end()) throw parse_error("A required JSON member is missing: " + std::string{name});
	return found->second;
}

const value* optional_member(const value& object, const std::string_view name) {
	require_type(object, type::object, "object");
	const auto found = std::find_if(object.members.begin(), object.members.end(), [&](const auto& item) {
		return item.first == name;
	});
	return found == object.members.end() ? nullptr : &found->second;
}

void require_exact_keys(const value& object, const std::vector<std::string_view>& keys) {
	require_type(object, type::object, "object");
	if (object.members.size() != keys.size()) throw parse_error("A closed JSON object has unknown or missing members.");
	for (std::size_t index = 0; index < keys.size(); ++index) {
		if (object.members[index].first != keys[index]) {
			throw parse_error("A closed JSON object's canonical member order is invalid.");
		}
	}
}

std::int64_t integer(const value& input, const std::string_view label) {
	require_type(input, type::number, label);
	if (input.text.find_first_of(".eE") != std::string::npos) throw parse_error(std::string{label} + " is not an integer.");
	std::int64_t result{};
	const auto conversion = std::from_chars(input.text.data(), input.text.data() + input.text.size(), result);
	if (conversion.ec != std::errc{} || conversion.ptr != input.text.data() + input.text.size()) {
		throw parse_error(std::string{label} + " is outside the signed 64-bit domain.");
	}
	return result;
}

std::string_view string(const value& input, const std::string_view label) {
	require_type(input, type::string, label);
	return input.text;
}

bool boolean(const value& input, const std::string_view label) {
	require_type(input, type::boolean, label);
	return input.boolean;
}

const std::vector<value>& array(const value& input, const std::string_view label) {
	require_type(input, type::array, label);
	return input.items;
}

} // namespace framescaper::media::json
