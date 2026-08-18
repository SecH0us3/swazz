// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

package proto

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/bufbuild/protocompile"
	"google.golang.org/protobuf/reflect/protoreflect"
	"swazz-engine/internal/swagger"
)

// ParseProtoFile reads a .proto file from disk and parses it into Swazz EndpointConfigs.
func ParseProtoFile(path string, baseURL string) (*swagger.ParseResult, error) {
	absPath, err := filepath.Abs(path)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve proto path %s: %w", path, err)
	}

	if _, err := os.Stat(absPath); err != nil {
		return nil, fmt.Errorf("proto file does not exist: %w", err)
	}

	dir := filepath.Dir(absPath)
	filename := filepath.Base(absPath)

	compiler := protocompile.Compiler{
		Resolver: &protocompile.SourceResolver{
			ImportPaths: []string{dir},
		},
	}

	files, err := compiler.Compile(context.Background(), filename)
	if err != nil {
		return nil, fmt.Errorf("failed to compile proto file %s: %w", path, err)
	}

	var fds []protoreflect.FileDescriptor
	for _, f := range files {
		fds = append(fds, f)
	}

	return ConvertFileDescriptorsToEndpoints(fds, baseURL), nil
}

// ParseProtoBytes parses raw in-memory .proto bytes into Swazz EndpointConfigs.
func ParseProtoBytes(filename string, src []byte, baseURL string) (*swagger.ParseResult, error) {
	if filename == "" {
		filename = "input.proto"
	}

	compiler := protocompile.Compiler{
		Resolver: protocompile.CompositeResolver{
			&protocompile.SourceResolver{
				Accessor: protocompile.SourceAccessorFromMap(map[string]string{
					filename: string(src),
				}),
			},
		},
	}

	files, err := compiler.Compile(context.Background(), filename)
	if err != nil {
		return nil, fmt.Errorf("failed to compile proto bytes (%s): %w", filename, err)
	}

	var fds []protoreflect.FileDescriptor
	for _, f := range files {
		fds = append(fds, f)
	}

	return ConvertFileDescriptorsToEndpoints(fds, baseURL), nil
}

// ConvertFileDescriptorsToEndpoints extracts unary RPC methods from FileDescriptors.
func ConvertFileDescriptorsToEndpoints(fds []protoreflect.FileDescriptor, defaultBaseURL string) *swagger.ParseResult {
	var endpoints []swagger.EndpointConfig

	for _, fd := range fds {
		services := fd.Services()
		for i := 0; i < services.Len(); i++ {
			svc := services.Get(i)
			methods := svc.Methods()
			for j := 0; j < methods.Len(); j++ {
				m := methods.Get(j)
				// Skip streaming RPCs for v1
				if m.IsStreamingClient() || m.IsStreamingServer() {
					continue
				}

				inputMsg := m.Input()
				schema := ConvertMessageToSchema(inputMsg, make(map[string]bool))

				rpcPath := fmt.Sprintf("/%s/%s", svc.FullName(), m.Name())
				endpoints = append(endpoints, swagger.EndpointConfig{
					Method:      "GRPC",
					Path:        rpcPath,
					ContentType: "application/grpc",
					Schema:      schema,
				})
			}
		}
	}

	return &swagger.ParseResult{
		Endpoints: endpoints,
		BasePath:  defaultBaseURL,
	}
}

// ConvertMessageToSchema maps a Protobuf MessageDescriptor to a Swazz SchemaProperty.
func ConvertMessageToSchema(md protoreflect.MessageDescriptor, visited map[string]bool) swagger.SchemaProperty {
	typeName := string(md.FullName())
	if visited[typeName] {
		// Prevent recursive infinite loop
		return swagger.SchemaProperty{Type: "object"}
	}

	newVisited := make(map[string]bool, len(visited)+1)
	for k, v := range visited {
		newVisited[k] = v
	}
	newVisited[typeName] = true

	props := make(map[string]*swagger.SchemaProperty)
	var required []string

	fields := md.Fields()
	for i := 0; i < fields.Len(); i++ {
		fd := fields.Get(i)
		fieldName := string(fd.Name())
		fieldSchema := convertFieldToSchema(fd, newVisited)
		props[fieldName] = fieldSchema
	}

	return swagger.SchemaProperty{
		Type:       "object",
		Properties: props,
		Required:   required,
	}
}

func convertFieldToSchema(fd protoreflect.FieldDescriptor, visited map[string]bool) *swagger.SchemaProperty {
	if fd.IsMap() {
		valField := fd.MapValue()
		valSchema := convertSingularFieldToSchema(valField, visited)
		return &swagger.SchemaProperty{
			Type: "object",
			Properties: map[string]*swagger.SchemaProperty{
				"key": valSchema,
			},
		}
	}

	if fd.IsList() {
		elemSchema := convertSingularFieldToSchema(fd, visited)
		return &swagger.SchemaProperty{
			Type:  "array",
			Items: elemSchema,
		}
	}

	return convertSingularFieldToSchema(fd, visited)
}

func convertSingularFieldToSchema(fd protoreflect.FieldDescriptor, visited map[string]bool) *swagger.SchemaProperty {
	switch fd.Kind() {
	case protoreflect.BoolKind:
		return &swagger.SchemaProperty{Type: "boolean"}
	case protoreflect.Int32Kind, protoreflect.Sint32Kind, protoreflect.Sfixed32Kind:
		return &swagger.SchemaProperty{Type: "integer", Format: "int32"}
	case protoreflect.Int64Kind, protoreflect.Sint64Kind, protoreflect.Sfixed64Kind:
		return &swagger.SchemaProperty{Type: "integer", Format: "int64"}
	case protoreflect.Uint32Kind, protoreflect.Fixed32Kind:
		return &swagger.SchemaProperty{Type: "integer", Format: "uint32"}
	case protoreflect.Uint64Kind, protoreflect.Fixed64Kind:
		return &swagger.SchemaProperty{Type: "integer", Format: "uint64"}
	case protoreflect.FloatKind:
		return &swagger.SchemaProperty{Type: "number", Format: "float"}
	case protoreflect.DoubleKind:
		return &swagger.SchemaProperty{Type: "number", Format: "double"}
	case protoreflect.StringKind:
		return &swagger.SchemaProperty{Type: "string"}
	case protoreflect.BytesKind:
		return &swagger.SchemaProperty{Type: "string", Format: "byte"}
	case protoreflect.EnumKind:
		ed := fd.Enum()
		var enumVals []any
		for i := 0; i < ed.Values().Len(); i++ {
			enumVals = append(enumVals, string(ed.Values().Get(i).Name()))
		}
		return &swagger.SchemaProperty{Type: "string", Enum: enumVals}
	case protoreflect.MessageKind, protoreflect.GroupKind:
		subSchema := ConvertMessageToSchema(fd.Message(), visited)
		return &subSchema
	default:
		return &swagger.SchemaProperty{Type: "string"}
	}
}
