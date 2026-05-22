package generator

import (
	"fmt"
	"strings"
)

// ToXML serializes a flat map to XML.
func ToXML(data map[string]any, rootName string) (string, error) {
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("<%s>", rootName))
	for k, v := range data {
		sb.WriteString(fmt.Sprintf("<%s>%v</%s>", k, v, k))
	}
	sb.WriteString(fmt.Sprintf("</%s>", rootName))
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
