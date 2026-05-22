package wsdl

import (
	"testing"
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

	if ep.ContentType != "text/xml; charset=utf-8" {
		t.Errorf("Expected content type text/xml; charset=utf-8, got %s", ep.ContentType)
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
