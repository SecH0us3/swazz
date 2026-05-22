package wsdl

import (
	"encoding/xml"
	"fmt"
	"strings"
	"swazz-engine/internal/swagger"
)

type Definitions struct {
	XMLName         xml.Name   `xml:"definitions"`
	TargetNamespace string     `xml:"targetNamespace,attr"`
	Types           Types      `xml:"types"`
	Messages        []Message  `xml:"message"`
	PortTypes       []PortType `xml:"portType"`
	Bindings        []Binding  `xml:"binding"`
	Services        []Service  `xml:"service"`
}

type Types struct {
	Schemas []Schema `xml:"schema"`
}

type Schema struct {
	XMLName         xml.Name         `xml:"schema"`
	TargetNamespace string           `xml:"targetNamespace,attr"`
	Elements        []Element        `xml:"element"`
	ComplexTypes    []ComplexType    `xml:"complexType"`
}

type Element struct {
	Name string `xml:"name,attr"`
	Type string `xml:"type,attr"`
}

type ComplexType struct {
	Name     string    `xml:"name,attr"`
	Sequence []Element `xml:"sequence>element"`
}

type Message struct {
	Name  string `xml:"name,attr"`
	Parts []Part `xml:"part"`
}

type Part struct {
	Name    string `xml:"name,attr"`
	Element string `xml:"element,attr"`
	Type    string `xml:"type,attr"`
}

type PortType struct {
	Name       string      `xml:"name,attr"`
	Operations []Operation `xml:"operation"`
}

type Operation struct {
	Name   string `xml:"name,attr"`
	Input  Input  `xml:"input"`
	Output Output `xml:"output"`
}

type Input struct {
	Message string `xml:"message,attr"`
}

type Output struct {
	Message string `xml:"message,attr"`
}

type Binding struct {
	Name       string             `xml:"name,attr"`
	Type       string             `xml:"type,attr"`
	Operations []BindingOperation `xml:"operation"`
}

type BindingOperation struct {
	Name       string     `xml:"name,attr"`
	SoapAction SoapAction `xml:"operation"`
}

type SoapAction struct {
	Action string `xml:"soapAction,attr"`
}

type Service struct {
	Name  string `xml:"name,attr"`
	Ports []Port `xml:"port"`
}

type Port struct {
	Name    string  `xml:"name,attr"`
	Binding string  `xml:"binding,attr"`
	Address Address `xml:"address"`
}

type Address struct {
	Location string `xml:"location,attr"`
}

func ParseWSDL(raw []byte) (*swagger.ParseResult, error) {
	var defs Definitions
	if err := xml.Unmarshal(raw, &defs); err != nil {
		return nil, fmt.Errorf("failed to unmarshal WSDL: %w", err)
	}

	var endpoints []swagger.EndpointConfig
	basePath := ""
	if len(defs.Services) > 0 && len(defs.Services[0].Ports) > 0 {
		basePath = defs.Services[0].Ports[0].Address.Location
	}

	// Map message parts for easy lookup
	messages := make(map[string]Message)
	for _, m := range defs.Messages {
		messages[m.Name] = m
	}

	// Simple mapping of operations to endpoints
	for _, pt := range defs.PortTypes {
		for _, op := range pt.Operations {
			// Find SoapAction from Bindings
			action := ""
			for _, b := range defs.Bindings {
				for _, bo := range b.Operations {
					if bo.Name == op.Name {
						action = bo.SoapAction.Action
						break
					}
				}
			}

			// Build schema from input message
			schema := swagger.SchemaProperty{
				Type:       "object",
				Properties: make(map[string]*swagger.SchemaProperty),
			}

			msgName := op.Input.Message
			if idx := strings.LastIndex(msgName, ":"); idx != -1 {
				msgName = msgName[idx+1:]
			}

			if msg, ok := messages[msgName]; ok {
				for _, part := range msg.Parts {
					partName := part.Name
					if partName == "" {
						partName = "parameters"
					}
					// For now, treat everything as string or generic object
					schema.Properties[partName] = &swagger.SchemaProperty{
						Type: "string",
					}
				}
			}

			// Add SOAPAction as a requirement if found
			headerParams := make(map[string]*swagger.SchemaProperty)
			if action != "" {
				headerParams["SOAPAction"] = &swagger.SchemaProperty{
					Type: "string",
					Enum: []any{action},
				}
			}

			endpoints = append(endpoints, swagger.EndpointConfig{
				Path:         "", // Usually the same as BasePath for SOAP
				Method:       "POST",
				ContentType:  "text/xml; charset=utf-8",
				Schema:       schema,
				HeaderParams: headerParams,
			})
		}
	}

	return &swagger.ParseResult{
		BasePath:  basePath,
		Endpoints: endpoints,
	}, nil
}
