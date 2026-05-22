package wsdl

import (
	"testing"

	"swazz-engine/internal/swagger"
)

func TestParseWSDL(t *testing.T) {
	wsdlRaw := `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="StockQuote"
             targetNamespace="http://example.com/stockquote.wsdl"
             xmlns:tns="http://example.com/stockquote.wsdl"
             xmlns:xsd1="http://example.com/stockquote.xsd"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns="http://schemas.xmlsoap.org/wsdl/">

    <types>
       <schema targetNamespace="http://example.com/stockquote.xsd"
              xmlns="http://www.w3.org/2000/10/XMLSchema">
           <element name="TradePriceRequest">
               <complexType>
                   <all>
                       <element name="tickerSymbol" type="string"/>
                   </all>
               </complexType>
           </element>
           <element name="TradePrice">
               <complexType>
                   <all>
                       <element name="price" type="float"/>
                   </all>
               </complexType>
           </element>
       </schema>
    </types>

    <message name="GetLastTradePriceInput">
        <part name="body" element="xsd1:TradePriceRequest"/>
    </message>

    <message name="GetLastTradePriceOutput">
        <part name="body" element="xsd1:TradePrice"/>
    </message>

    <portType name="StockQuotePortType">
        <operation name="GetLastTradePrice">
           <input message="tns:GetLastTradePriceInput"/>
           <output message="tns:GetLastTradePriceOutput"/>
        </operation>
    </portType>

    <binding name="StockQuoteSoapBinding" type="tns:StockQuotePortType">
        <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
        <operation name="GetLastTradePrice">
           <soap:operation soapAction="http://example.com/GetLastTradePrice"/>
           <input>
               <soap:body use="literal"/>
           </input>
           <output>
               <soap:body use="literal"/>
           </output>
        </operation>
    </binding>

    <service name="StockQuoteService">
        <documentation>My stock quote service</documentation>
        <port name="StockQuotePort" binding="tns:StockQuoteSoapBinding">
           <soap:address location="http://example.com/stockquote"/>
        </port>
    </service>

</definitions>`

	result, err := ParseWSDL([]byte(wsdlRaw))
	if err != nil {
		t.Fatalf("ParseWSDL failed: %v", err)
	}

	if result.BasePath != "http://example.com/stockquote" {
		t.Errorf("Expected BasePath http://example.com/stockquote, got %s", result.BasePath)
	}

	if len(result.Endpoints) != 1 {
		t.Fatalf("Expected 1 endpoint, got %d", len(result.Endpoints))
	}

	ep := result.Endpoints[0]
	if ep.Method != "POST" {
		t.Errorf("Expected method POST, got %s", ep.Method)
	}

	if ep.Path != "?operation=GetLastTradePrice" {
		t.Errorf("Expected path ?operation=GetLastTradePrice, got %s", ep.Path)
	}

	if ep.ContentType != "text/xml; charset=utf-8" {
		t.Errorf("Expected content type text/xml; charset=utf-8, got %s", ep.ContentType)
	}

	// Assert schema resolution
	expectedKey := "TradePriceRequest|http://example.com/stockquote.xsd"
	rootProp, ok := ep.Schema.Properties[expectedKey]
	if !ok {
		t.Fatalf("Expected schema to contain property key %q, but it didn't. Got properties: %v", expectedKey, ep.Schema.Properties)
	}

	if rootProp.Type != "object" {
		t.Errorf("Expected root property type to be object, got %s", rootProp.Type)
	}

	tickerProp, ok := rootProp.Properties["tickerSymbol"]
	if !ok {
		t.Fatalf("Expected root property to have 'tickerSymbol' child property")
	}

	if tickerProp.Type != "string" {
		t.Errorf("Expected tickerSymbol type to be string, got %s", tickerProp.Type)
	}

	action, ok := ep.HeaderParams["SOAPAction"]
	if !ok {
		t.Error("Missing SOAPAction header")
	} else if action.Enum[0].(string) != "http://example.com/GetLastTradePrice" {
		t.Errorf("Expected SOAPAction http://example.com/GetLastTradePrice, got %v", action.Enum[0])
	}
}

func TestParseWSDL_InvalidXML(t *testing.T) {
	_, err := ParseWSDL([]byte("not xml"))
	if err == nil {
		t.Error("Expected error for invalid XML, got nil")
	}
}

func TestParseWSDL_ComplexSchema(t *testing.T) {
	wsdlRaw := `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="ComplexService"
             targetNamespace="http://example.com/complex.wsdl"
             xmlns:tns="http://example.com/complex.wsdl"
             xmlns:xsd1="http://example.com/complex.xsd"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns="http://schemas.xmlsoap.org/wsdl/">

    <types>
       <schema targetNamespace="http://example.com/complex.xsd"
              xmlns="http://www.w3.org/2000/10/XMLSchema">
           <complexType name="User">
               <sequence>
                   <element name="id" type="int"/>
                   <element name="name" type="string"/>
                   <element name="isActive" type="boolean"/>
               </sequence>
           </complexType>
           <element name="CreateUserRequest">
               <complexType>
                   <sequence>
                       <element name="userInfo" type="tns:User"/>
                       <element name="role" type="string"/>
                   </sequence>
               </complexType>
           </element>
       </schema>
    </types>

    <message name="CreateUserInput">
        <part name="body" element="xsd1:CreateUserRequest"/>
    </message>

    <portType name="ComplexPortType">
        <operation name="CreateUser">
           <input message="tns:CreateUserInput"/>
        </operation>
    </portType>

    <binding name="ComplexSoapBinding" type="tns:ComplexPortType">
        <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
        <operation name="CreateUser">
           <soap:operation soapAction="http://example.com/CreateUser"/>
           <input><soap:body use="literal"/></input>
        </operation>
    </binding>

    <service name="ComplexService">
        <port name="ComplexPort" binding="tns:ComplexSoapBinding">
           <soap:address location="http://example.com/complex"/>
        </port>
    </service>
</definitions>`

	result, err := ParseWSDL([]byte(wsdlRaw))
	if err != nil {
		t.Fatalf("ParseWSDL failed: %v", err)
	}

	if len(result.Endpoints) != 1 {
		t.Fatalf("Expected 1 endpoint, got %d", len(result.Endpoints))
	}

	ep := result.Endpoints[0]
	expectedKey := "CreateUserRequest|http://example.com/complex.xsd"
	rootProp, ok := ep.Schema.Properties[expectedKey]
	if !ok {
		t.Fatalf("Expected schema key %q, got: %v", expectedKey, ep.Schema.Properties)
	}

	if rootProp.Type != "object" {
		t.Errorf("Expected root property type 'object', got %q", rootProp.Type)
	}

	// Verify userInfo
	userProp, ok := rootProp.Properties["userInfo"]
	if !ok {
		t.Fatalf("Expected userInfo property under CreateUserRequest")
	}
	if userProp.Type != "object" {
		t.Errorf("Expected userInfo type 'object', got %q", userProp.Type)
	}

	// Verify ID (integer)
	idProp, ok := userProp.Properties["id"]
	if !ok {
		t.Fatalf("Expected id under userInfo")
	}
	if idProp.Type != "integer" {
		t.Errorf("Expected id type 'integer', got %q", idProp.Type)
	}

	// Verify isActive (boolean)
	activeProp, ok := userProp.Properties["isActive"]
	if !ok {
		t.Fatalf("Expected isActive under userInfo")
	}
	if activeProp.Type != "boolean" {
		t.Errorf("Expected isActive type 'boolean', got %q", activeProp.Type)
	}

	// Verify role
	roleProp, ok := rootProp.Properties["role"]
	if !ok {
		t.Fatalf("Expected role under CreateUserRequest")
	}
	if roleProp.Type != "string" {
		t.Errorf("Expected role type 'string', got %q", roleProp.Type)
	}
}

func TestParseWSDL_ChoiceAndDirectType(t *testing.T) {
	wsdlRaw := `<?xml version="1.0" encoding="UTF-8"?>
<definitions name="ChoiceService"
             targetNamespace="http://example.com/choice.wsdl"
             xmlns:tns="http://example.com/choice.wsdl"
             xmlns:xsd1="http://example.com/choice.xsd"
             xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
             xmlns="http://schemas.xmlsoap.org/wsdl/">

    <types>
       <schema targetNamespace="http://example.com/choice.xsd"
              xmlns="http://www.w3.org/2000/10/XMLSchema">
           <element name="TestChoiceRequest">
               <complexType>
                   <choice>
                       <element name="floatVal" type="float"/>
                       <element name="doubleVal" type="double"/>
                       <element name="decimalVal" type="decimal"/>
                       <element name="dateTimeVal" type="dateTime"/>
                       <element name="dateVal" type="date"/>
                   </choice>
               </complexType>
           </element>
       </schema>
    </types>

    <message name="TestChoiceInput">
        <part name="body" element="xsd1:TestChoiceRequest"/>
    </message>

    <message name="TestDirectTypeInput">
        <part name="simplePart" type="string"/>
    </message>

    <portType name="ChoicePortType">
        <operation name="ChoiceOp">
           <input message="tns:TestChoiceInput"/>
        </operation>
        <operation name="DirectTypeOp">
           <input message="tns:TestDirectTypeInput"/>
        </operation>
    </portType>

    <binding name="ChoiceSoapBinding" type="tns:ChoicePortType">
        <soap:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
        <operation name="ChoiceOp">
           <soap:operation soapAction="http://example.com/ChoiceOp"/>
           <input><soap:body use="literal"/></input>
        </operation>
        <operation name="DirectTypeOp">
           <soap:operation soapAction="http://example.com/DirectTypeOp"/>
           <input><soap:body use="literal"/></input>
        </operation>
    </binding>

    <service name="ChoiceService">
        <port name="ChoicePort" binding="tns:ChoiceSoapBinding">
           <soap:address location="http://example.com/choice"/>
        </port>
    </service>
</definitions>`

	result, err := ParseWSDL([]byte(wsdlRaw))
	if err != nil {
		t.Fatalf("ParseWSDL failed: %v", err)
	}

	if len(result.Endpoints) != 2 {
		t.Fatalf("Expected 2 endpoints, got %d", len(result.Endpoints))
	}

	// 1. Verify ChoiceOp (XML element reference with <choice> child group)
	var choiceEp *swagger.EndpointConfig
	var directEp *swagger.EndpointConfig
	for _, ep := range result.Endpoints {
		if ep.Path == "?operation=ChoiceOp" {
			choiceEp = &ep
		} else if ep.Path == "?operation=DirectTypeOp" {
			directEp = &ep
		}
	}

	if choiceEp == nil {
		t.Fatalf("ChoiceOp endpoint not found")
	}

	expectedChoiceKey := "TestChoiceRequest|http://example.com/choice.xsd"
	rootProp, ok := choiceEp.Schema.Properties[expectedChoiceKey]
	if !ok {
		t.Fatalf("Expected schema key %q, got: %v", expectedChoiceKey, choiceEp.Schema.Properties)
	}

	typesToCheck := map[string]struct {
		typ    string
		format string
	}{
		"floatVal":    {typ: "number"},
		"doubleVal":   {typ: "number"},
		"decimalVal":  {typ: "number"},
		"dateTimeVal": {typ: "string", format: "date-time"},
		"dateVal":     {typ: "string", format: "date-time"},
	}

	for propName, expected := range typesToCheck {
		prop, ok := rootProp.Properties[propName]
		if !ok {
			t.Errorf("Expected property %s, but not found", propName)
			continue
		}
		if prop.Type != expected.typ {
			t.Errorf("Property %s: expected Type %q, got %q", propName, expected.typ, prop.Type)
		}
		if prop.Format != expected.format {
			t.Errorf("Property %s: expected Format %q, got %q", propName, expected.format, prop.Format)
		}
	}

	// 2. Verify DirectTypeOp (part type attribute, fallback to generic wrapper)
	if directEp == nil {
		t.Fatalf("DirectTypeOp endpoint not found")
	}

	// Since it falls back, the rootTagName is the operation name: DirectTypeOp
	expectedDirectKey := "DirectTypeOp|http://example.com/choice.wsdl"
	directRootProp, ok := directEp.Schema.Properties[expectedDirectKey]
	if !ok {
		t.Fatalf("Expected schema key %q, got: %v", expectedDirectKey, directEp.Schema.Properties)
	}

	simplePartProp, ok := directRootProp.Properties["simplePart"]
	if !ok {
		t.Fatalf("Expected simplePart property under DirectTypeOp")
	}

	if simplePartProp.Type != "string" {
		t.Errorf("Expected simplePart type 'string', got %q", simplePartProp.Type)
	}
}

