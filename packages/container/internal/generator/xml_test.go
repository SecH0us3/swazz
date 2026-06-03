package generator

import (
	"strings"
	"testing"
)

func TestToXML(t *testing.T) {
	data := map[string]any{
		"name":  "test",
		"items": []any{1, 2},
		"details": map[string]any{
			"id": 123,
		},
	}

	xml, err := ToXML(data, "request")
	if err != nil {
		t.Fatalf("ToXML failed: %v", err)
	}

	expectedParts := []string{
		"<request>",
		"<name>test</name>",
		"<items><item>1</item><item>2</item></items>",
		"<details><id>123</id></details>",
		"</request>",
	}

	for _, part := range expectedParts {
		if !strings.Contains(xml, part) {
			t.Errorf("Expected XML to contain %s, but got: %s", part, xml)
		}
	}
}

func TestWrapInSOAP(t *testing.T) {
	content := "<test>data</test>"
	soap, err := WrapInSOAP(content)
	if err != nil {
		t.Fatalf("WrapInSOAP failed: %v", err)
	}

	if !strings.Contains(soap, "<soap:Envelope") || !strings.Contains(soap, "<soap:Body>") || !strings.Contains(soap, content) {
		t.Errorf("SOAP wrap failed, got: %s", soap)
	}
}
