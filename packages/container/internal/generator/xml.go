package generator

import (
	"fmt"
	"strings"
)

// ToXML serializes an object to XML recursively.
func ToXML(data any, rootName string) (string, error) {
	var sb strings.Builder
	if rootName != "" {
		sb.WriteString(fmt.Sprintf("<%s>", rootName))
	}

	switch v := data.(type) {
	case map[string]any:
		for k, val := range v {
			inner, _ := ToXML(val, k)
			sb.WriteString(inner)
		}
	case []any:
		for _, val := range v {
			inner, _ := ToXML(val, "item")
			sb.WriteString(inner)
		}
	default:
		sb.WriteString(fmt.Sprintf("%v", v))
	}

	if rootName != "" {
		sb.WriteString(fmt.Sprintf("</%s>", rootName))
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
