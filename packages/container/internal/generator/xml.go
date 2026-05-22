package generator

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"sort"
	"strings"
)

// ToXML recursively serializes data structures (maps, slices, primitives) into XML.
// If data has exactly one key and its value is a map, it treats that key as the root element.
// Otherwise, it wraps the data in defaultRoot.
func ToXML(data map[string]any, defaultRoot string) (string, error) {
	var sb strings.Builder

	useDefaultRoot := true
	var singleKey string
	var singleValue any

	if len(data) == 1 {
		for k, v := range data {
			singleKey = k
			singleValue = v
		}
		if _, isMap := singleValue.(map[string]any); isMap {
			useDefaultRoot = false
		}
	}

	if useDefaultRoot {
		if defaultRoot == "" {
			defaultRoot = "request"
		}
		
		tagName := defaultRoot
		var ns string
		if strings.Contains(defaultRoot, "|") {
			parts := strings.SplitN(defaultRoot, "|", 2)
			tagName = parts[0]
			ns = parts[1]
		}
		
		if ns != "" {
			sb.WriteString(fmt.Sprintf("<%s xmlns=\"%s\">", tagName, ns))
		} else {
			sb.WriteString(fmt.Sprintf("<%s>", tagName))
		}

		for _, k := range sortedKeys(data) {
			if err := marshalXMLValue(&sb, k, data[k]); err != nil {
				return "", err
			}
		}
		sb.WriteString(fmt.Sprintf("</%s>", tagName))
	} else {
		if err := marshalXMLValue(&sb, singleKey, singleValue); err != nil {
			return "", err
		}
	}

	return sb.String(), nil
}

// WrapInSOAP wraps XML content in a SOAP Envelope.
func WrapInSOAP(content string) (string, error) {
	return fmt.Sprintf(`<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    %s
  </soap:Body>
</soap:Envelope>`, content), nil
}

func marshalXMLValue(sb *strings.Builder, name string, val any) error {
	if val == nil {
		tagName := name
		var ns string
		if strings.Contains(name, "|") {
			parts := strings.SplitN(name, "|", 2)
			tagName = parts[0]
			ns = parts[1]
		}
		if ns != "" {
			sb.WriteString(fmt.Sprintf("<%s xmlns=\"%s\"/>", tagName, ns))
		} else {
			sb.WriteString(fmt.Sprintf("<%s/>", tagName))
		}
		return nil
	}

	tagName := name
	var ns string
	if strings.Contains(name, "|") {
		parts := strings.SplitN(name, "|", 2)
		tagName = parts[0]
		ns = parts[1]
	}

	switch v := val.(type) {
	case map[string]any:
		if ns != "" {
			sb.WriteString(fmt.Sprintf("<%s xmlns=\"%s\">", tagName, ns))
		} else {
			sb.WriteString(fmt.Sprintf("<%s>", tagName))
		}

		for _, k := range sortedKeys(v) {
			childVal := v[k]
			if slice, ok := childVal.([]any); ok {
				for _, item := range slice {
					if err := marshalXMLValue(sb, k, item); err != nil {
						return err
					}
				}
			} else {
				if err := marshalXMLValue(sb, k, childVal); err != nil {
					return err
				}
			}
		}
		sb.WriteString(fmt.Sprintf("</%s>", tagName))

	case []any:
		for _, item := range v {
			if err := marshalXMLValue(sb, name, item); err != nil {
				return err
			}
		}

	default:
		if ns != "" {
			sb.WriteString(fmt.Sprintf("<%s xmlns=\"%s\">", tagName, ns))
		} else {
			sb.WriteString(fmt.Sprintf("<%s>", tagName))
		}

		var buf bytes.Buffer
		strVal := fmt.Sprintf("%v", v)
		if err := xml.EscapeText(&buf, []byte(strVal)); err != nil {
			return err
		}
		sb.Write(buf.Bytes())
		sb.WriteString(fmt.Sprintf("</%s>", tagName))
	}
	return nil
}

func sortedKeys(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
