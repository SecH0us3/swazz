// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package grpc

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"

	"github.com/bufbuild/protocompile"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/types/dynamicpb"
)

// FindMessageDescriptor is a helper that extracts a MessageDescriptor from proto src.
func FindMessageDescriptor(protoSrc, fullMsgName string) (protoreflect.MessageDescriptor, error) {
	compiler := protocompile.Compiler{
		Resolver: protocompile.CompositeResolver{
			&protocompile.SourceResolver{
				Accessor: protocompile.SourceAccessorFromMap(map[string]string{
					"temp.proto": protoSrc,
				}),
			},
		},
	}
	files, err := compiler.Compile(context.Background(), "temp.proto")
	if err != nil || len(files) == 0 {
		return nil, fmt.Errorf("failed to compile proto: %w", err)
	}
	desc := files[0].FindDescriptorByName(protoreflect.FullName(fullMsgName))
	if desc == nil {
		return nil, fmt.Errorf("message %s not found", fullMsgName)
	}
	msgDesc, ok := desc.(protoreflect.MessageDescriptor)
	if !ok {
		return nil, fmt.Errorf("descriptor %s is not a message", fullMsgName)
	}
	return msgDesc, nil
}

// MarshalPayload converts a mutation payload (map[string]any, JSON string, or raw bytes) into binary Protobuf wire format.
func MarshalPayload(md protoreflect.MessageDescriptor, payload any) ([]byte, error) {
	if rawBytes, ok := payload.([]byte); ok {
		return rawBytes, nil
	}

	if md == nil {
		return nil, fmt.Errorf("nil message descriptor")
	}

	msg := dynamicpb.NewMessage(md)

	if payload == nil {
		return proto.Marshal(msg)
	}

	// Prepare JSON bytes for protojson
	var jsonBytes []byte
	switch p := payload.(type) {
	case string:
		jsonBytes = []byte(p)
	case map[string]any:
		b, err := json.Marshal(p)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal payload map: %w", err)
		}
		jsonBytes = b
	default:
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal payload: %w", err)
		}
		jsonBytes = b
	}

	unmarshalOpts := protojson.UnmarshalOptions{
		DiscardUnknown: true,
		AllowPartial:   true,
	}

	if err := unmarshalOpts.Unmarshal(jsonBytes, msg); err != nil {
		// Fallback: populate fields manually to tolerate aggressive fuzz mutations (e.g. type mismatches)
		populateDynamicFields(msg, payload)
	}

	return proto.Marshal(msg)
}

func populateDynamicFields(msg *dynamicpb.Message, payload any) {
	m, ok := payload.(map[string]any)
	if !ok {
		return
	}

	fields := msg.Descriptor().Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		val, exists := m[string(fd.Name())]
		if !exists {
			val, exists = m[string(fd.JSONName())]
		}
		if !exists || val == nil {
			continue
		}

		setFieldValue(msg, fd, val)
	}
}

func setFieldValue(msg *dynamicpb.Message, fd protoreflect.FieldDescriptor, val any) {
	defer func() {
		_ = recover() // Catch any panic from mismatched dynamicpb sets
	}()

	switch {
	case fd.IsList():
		if slice, ok := val.([]any); ok {
			listVal := msg.Mutable(fd).List()
			for _, item := range slice {
				if itemVal, ok := convertScalarValue(fd, item); ok {
					listVal.Append(itemVal)
				}
			}
		}
	case fd.Kind() == protoreflect.MessageKind || fd.Kind() == protoreflect.GroupKind:
		if subMap, ok := val.(map[string]any); ok {
			subMsg := msg.Mutable(fd).Message()
			if dynSub, ok := subMsg.Interface().(*dynamicpb.Message); ok {
				populateDynamicFields(dynSub, subMap)
			}
		}
	default:
		if scalarVal, ok := convertScalarValue(fd, val); ok {
			msg.Set(fd, scalarVal)
		}
	}
}

func convertScalarValue(fd protoreflect.FieldDescriptor, val any) (protoreflect.Value, bool) {
	switch fd.Kind() {
	case protoreflect.StringKind:
		return protoreflect.ValueOfString(fmt.Sprintf("%v", val)), true
	case protoreflect.BoolKind:
		if b, ok := val.(bool); ok {
			return protoreflect.ValueOfBool(b), true
		}
		if s, ok := val.(string); ok {
			lower := strings.ToLower(s)
			return protoreflect.ValueOfBool(lower == "true" || lower == "1"), true
		}
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		if num, ok := toInt32(val); ok {
			return protoreflect.ValueOfInt32(num), true
		}
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		if num, ok := toInt64(val); ok {
			return protoreflect.ValueOfInt64(num), true
		}
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		if num, ok := toUint32(val); ok {
			return protoreflect.ValueOfUint32(num), true
		}
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		if num, ok := toUint64(val); ok {
			return protoreflect.ValueOfUint64(num), true
		}
	case protoreflect.FloatKind:
		if f, ok := toFloat64(val); ok {
			return protoreflect.ValueOfFloat32(float32(f)), true
		}
	case protoreflect.DoubleKind:
		if f, ok := toFloat64(val); ok {
			return protoreflect.ValueOfFloat64(f), true
		}
	case protoreflect.BytesKind:
		if b, ok := val.([]byte); ok {
			return protoreflect.ValueOfBytes(b), true
		}
		if s, ok := val.(string); ok {
			if decoded, err := base64.StdEncoding.DecodeString(s); err == nil {
				return protoreflect.ValueOfBytes(decoded), true
			}
			return protoreflect.ValueOfBytes([]byte(s)), true
		}
	case protoreflect.EnumKind:
		if s, ok := val.(string); ok {
			ev := fd.Enum().Values().ByName(protoreflect.Name(s))
			if ev != nil {
				return protoreflect.ValueOfEnum(ev.Number()), true
			}
		}
		if num, ok := toInt32(val); ok {
			return protoreflect.ValueOfEnum(protoreflect.EnumNumber(num)), true
		}
	}
	return protoreflect.Value{}, false
}

func toInt32(val any) (int32, bool) {
	switch v := val.(type) {
	case int32:
		return v, true
	case int:
		if v >= math.MinInt32 && v <= math.MaxInt32 {
			return int32(v), true // #nosec G115
		}
	case int64:
		if v >= math.MinInt32 && v <= math.MaxInt32 {
			return int32(v), true // #nosec G115
		}
	case float64:
		if v >= math.MinInt32 && v <= math.MaxInt32 {
			return int32(v), true // #nosec G115
		}
	case float32:
		if v >= math.MinInt32 && v <= math.MaxInt32 {
			return int32(v), true // #nosec G115
		}
	case string:
		if n, err := strconv.ParseInt(v, 10, 32); err == nil {
			if n >= math.MinInt32 && n <= math.MaxInt32 {
				return int32(n), true // #nosec G115
			}
		}
	}
	return 0, false
}

func toUint32(val any) (uint32, bool) {
	switch v := val.(type) {
	case uint32:
		return v, true
	case uint64:
		if v <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case uint:
		if v <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case int:
		if v >= 0 && int64(v) <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case int64:
		if v >= 0 && v <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case float64:
		if v >= 0 && v <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case float32:
		if v >= 0 && v <= math.MaxUint32 {
			return uint32(v), true // #nosec G115
		}
	case string:
		if n, err := strconv.ParseUint(v, 10, 32); err == nil {
			if n <= math.MaxUint32 {
				return uint32(n), true // #nosec G115
			}
		}
	}
	return 0, false
}

func toInt64(val any) (int64, bool) {
	switch v := val.(type) {
	case float64:
		return int64(v), true
	case float32:
		return int64(v), true
	case int:
		return int64(v), true
	case int32:
		return int64(v), true
	case int64:
		return v, true
	case string:
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			return n, true
		}
	}
	return 0, false
}

func toUint64(val any) (uint64, bool) {
	switch v := val.(type) {
	case float64:
		if v >= 0 {
			return uint64(v), true
		}
	case float32:
		if v >= 0 {
			return uint64(v), true
		}
	case uint64:
		return v, true
	case uint32:
		return uint64(v), true
	case int:
		if v >= 0 {
			return uint64(v), true // #nosec G115
		}
	case string:
		if n, err := strconv.ParseUint(v, 10, 64); err == nil {
			return n, true
		}
	}
	return 0, false
}

func toFloat64(val any) (float64, bool) {
	switch v := val.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case string:
		if f, err := strconv.ParseFloat(v, 64); err == nil {
			return f, true
		}
	}
	return 0, false
}

// UnmarshalResponse parses binary Protobuf bytes into a map[string]any and JSON string.
func UnmarshalResponse(md protoreflect.MessageDescriptor, b []byte) (map[string]any, string, error) {
	if md == nil {
		return map[string]any{"raw": string(b)}, string(b), nil
	}

	msg := dynamicpb.NewMessage(md)
	if err := proto.Unmarshal(b, msg); err != nil {
		return map[string]any{"raw": string(b)}, string(b), err
	}

	jsonBytes, err := protojson.Marshal(msg)
	if err != nil {
		return map[string]any{"raw": string(b)}, string(b), err
	}

	var res map[string]any
	if err := json.Unmarshal(jsonBytes, &res); err != nil {
		return map[string]any{"raw": string(b)}, string(jsonBytes), nil
	}

	return res, string(jsonBytes), nil
}
