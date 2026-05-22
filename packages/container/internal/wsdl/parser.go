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
	Name        string       `xml:"name,attr"`
	Type        string       `xml:"type,attr"`
	ComplexType *ComplexType `xml:"complexType"`
}

type ComplexType struct {
	Name     string    `xml:"name,attr"`
	Sequence []Element `xml:"sequence>element"`
	All      []Element `xml:"all>element"`
	Choice   []Element `xml:"choice>element"`
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

func stripPrefix(name string) string {
	if idx := strings.LastIndex(name, ":"); idx != -1 {
		return name[idx+1:]
	}
	return name
}

func resolveElement(el Element, elementsMap map[string]Element, typesMap map[string]ComplexType) *swagger.SchemaProperty {
	if el.ComplexType != nil {
		return resolveComplexType(*el.ComplexType, elementsMap, typesMap)
	}
	if el.Type != "" {
		return resolveTypeName(el.Type, elementsMap, typesMap)
	}
	return &swagger.SchemaProperty{Type: "string"}
}

func resolveComplexType(ct ComplexType, elementsMap map[string]Element, typesMap map[string]ComplexType) *swagger.SchemaProperty {
	prop := &swagger.SchemaProperty{
		Type:       "object",
		Properties: make(map[string]*swagger.SchemaProperty),
	}
	var childElements []Element
	childElements = append(childElements, ct.Sequence...)
	childElements = append(childElements, ct.All...)
	childElements = append(childElements, ct.Choice...)

	for _, child := range childElements {
		prop.Properties[child.Name] = resolveElement(child, elementsMap, typesMap)
	}
	return prop
}

func resolveTypeName(typeName string, elementsMap map[string]Element, typesMap map[string]ComplexType) *swagger.SchemaProperty {
	localType := stripPrefix(typeName)
	switch localType {
	case "string":
		return &swagger.SchemaProperty{Type: "string"}
	case "int", "integer", "long", "short", "byte":
		return &swagger.SchemaProperty{Type: "integer"}
	case "float", "double", "decimal":
		return &swagger.SchemaProperty{Type: "number"}
	case "boolean":
		return &swagger.SchemaProperty{Type: "boolean"}
	case "dateTime", "date":
		return &swagger.SchemaProperty{Type: "string", Format: "date-time"}
	}

	if ct, ok := typesMap[localType]; ok {
		return resolveComplexType(ct, elementsMap, typesMap)
	}

	if el, ok := elementsMap[localType]; ok {
		return resolveElement(el, elementsMap, typesMap)
	}

	return &swagger.SchemaProperty{Type: "string"}
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

	elementsMap := make(map[string]Element)
	typesMap := make(map[string]ComplexType)

	for _, s := range defs.Types.Schemas {
		for _, el := range s.Elements {
			elementsMap[el.Name] = el
		}
		for _, ct := range s.ComplexTypes {
			typesMap[ct.Name] = ct
		}
	}

	// Map of operations to endpoints
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

			msgName := op.Input.Message
			msgName = stripPrefix(msgName)

			rootTagName := op.Name
			nsURI := defs.TargetNamespace
			var rootProp *swagger.SchemaProperty

			if msg, ok := messages[msgName]; ok && len(msg.Parts) > 0 {
				if len(msg.Parts) == 1 && msg.Parts[0].Element != "" {
					localEl := stripPrefix(msg.Parts[0].Element)
					foundNamespace := ""
					var foundEl Element
					found := false
					for _, s := range defs.Types.Schemas {
						for _, el := range s.Elements {
							if el.Name == localEl {
								foundNamespace = s.TargetNamespace
								foundEl = el
								found = true
								break
							}
						}
						if found {
							break
						}
					}
					
					if found {
						rootTagName = localEl
						nsURI = foundNamespace
						rootProp = resolveElement(foundEl, elementsMap, typesMap)
					} else {
						rootTagName = localEl
						nsURI = defs.TargetNamespace
						rootProp = &swagger.SchemaProperty{Type: "string"}
					}
				} else {
					rootProp = &swagger.SchemaProperty{
						Type:       "object",
						Properties: make(map[string]*swagger.SchemaProperty),
					}
					for _, part := range msg.Parts {
						pName := part.Name
						if pName == "" {
							pName = "parameters"
						}
						var partProp *swagger.SchemaProperty
						if part.Element != "" {
							localEl := stripPrefix(part.Element)
							var foundEl Element
							found := false
							for _, s := range defs.Types.Schemas {
								for _, el := range s.Elements {
									if el.Name == localEl {
										foundEl = el
										found = true
										break
									}
								}
								if found {
									break
								}
							}
							if found {
								partProp = resolveElement(foundEl, elementsMap, typesMap)
							} else {
								partProp = &swagger.SchemaProperty{Type: "string"}
							}
						} else if part.Type != "" {
							partProp = resolveTypeName(part.Type, elementsMap, typesMap)
						} else {
							partProp = &swagger.SchemaProperty{Type: "string"}
						}
						
						rootProp.Properties[pName] = partProp
					}
				}
			} else {
				rootProp = &swagger.SchemaProperty{Type: "string"}
			}

			// Wrap in a single root element schema
			schema := swagger.SchemaProperty{
				Type:       "object",
				Properties: make(map[string]*swagger.SchemaProperty),
			}
			key := rootTagName
			if nsURI != "" {
				key = fmt.Sprintf("%s|%s", rootTagName, nsURI)
			}
			schema.Properties[key] = rootProp

			headerParams := make(map[string]*swagger.SchemaProperty)
			if action != "" {
				headerParams["SOAPAction"] = &swagger.SchemaProperty{
					Type: "string",
					Enum: []any{action},
				}
			}

			endpoints = append(endpoints, swagger.EndpointConfig{
				Path:         "?operation=" + op.Name,
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
