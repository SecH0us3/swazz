package analyzer

import (
	"strings"
	"testing"
)

func TestStackTraceAnalyzer(t *testing.T) {
	a := &StackTraceAnalyzer{}

	tests := []struct {
		name          string
		response      string
		expectedCount int
		expectedRule  string
		contains      string
	}{
		{
			name:          "Python traceback signature match",
			response:      "Traceback (most recent call last):\n  File \"app.py\", line 10, in <module>\n    main()\nZeroDivisionError: division by zero",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Traceback (most recent call last)",
		},
		{
			name:          "Go goroutine signature match",
			response:      "panic: runtime error: index out of range\n\ngoroutine 1 [running]:\nmain.main()",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "goroutine",
		},
		{
			name:          "Java NullPointerException match",
			response:      "Exception in thread \"main\" java.lang.NullPointerException\n\tat java.base/java.util.Objects.requireNonNull(Objects.java:208)",
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "NullPointerException",
		},
		{
			name:          ".NET NullReferenceException match",
			response:      `System.NullReferenceException: Object reference not set to an instance of an object.\n   at Bank.Cards.API.Handler.Handle() in /builds/back/src/Bank/Cards/API/Handler.cs:line 50`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "NullReferenceException",
		},
		{
			name:          ".NET generic exception match (not NPE)",
			response:      `System.InvalidOperationException: Operation is not valid due to the current state of the object.\n   at Bank.Cards.API.Handler.Handle() in /builds/back/src/Bank/Cards/API/Handler.cs:line 50`,
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Exception:",
		},
		{
			name:          "NodeJS TypeError match (Null/Undefined)",
			response:      `TypeError: Cannot read properties of null (reading 'wallet')\n   at /builds/back/bank/index.js:5:10`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "Cannot read properties",
		},
		{
			name:          "PHP Member Function on Null match",
			response:      `Fatal error: Uncaught Error: Call to a member function getBalance() on null in /var/www/bank.php:12`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "on null",
		},
		{
			name:          "Go nil pointer dereference match",
			response:      `panic: runtime error: invalid memory address or nil pointer dereference`,
			expectedCount: 1,
			expectedRule:  "swazz/null-pointer-exception",
			contains:      "nil pointer dereference",
		},
		{
			name:          ".NET stack trace - plain documentation text should not match",
			response:      `{"description": "Look at System.Configuration for more details about settings"}`,
			expectedCount: 0,
		},
		{
			name:          "Ruby on Rails stacktrace match",
			response:      "ActionController::RoutingError (No route matches [GET] \"/evil\"):\n  actionpack (6.1.4) lib/action_dispatch/middleware/debug_exceptions.rb:29\n  active_record (6.1.4) lib/active_record/connection_adapters/abstract_adapter.rb:10",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "actionpack",
		},
		{
			name:          "Django framework stacktrace match",
			response:      "Internal Server Error: /api/v1/users\nTraceback (most recent call last):\n  File \"/usr/local/lib/python3.9/site-packages/django/core/handlers/exception.py\", line 47, in inner\n    response = get_response(request)",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Traceback",
		},
		{
			name:          "Spring Boot tomcat stacktrace match",
			response:      "org.apache.catalina.connector.ExecutionException: Servlet execution threw an exception\n\tat org.apache.catalina.core.ApplicationFilterChain.internalDoFilter(ApplicationFilterChain.java:230)",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "org.apache.catalina",
		},
		{
			name:          "NestJS core stacktrace match",
			response:      "Error: Router exception\n    at RouterExplorer.handleRequestException (/node_modules/@nestjs/core/router/router-explorer.js:10:5)\n    at ExceptionFiltersWeb.handle (/node_modules/@nestjs/core/exceptions/exception-filters-web.js:5:10)",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "@nestjs/core",
		},
		{
			name:          "Laravel routing stacktrace match",
			response:      "ErrorException: Route [login] not defined. in /vendor/laravel/framework/src/Illuminate/Routing/UrlGenerator.php:40\nStack trace:\n#0 /vendor/laravel/framework/src/Illuminate/Routing/UrlGenerator.php(40): UrlGenerator->route()",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "Stack trace",
		},
		{
			name:          "Nginx 502 Bad Gateway HTML title match",
			response:      "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>",
			expectedCount: 1,
			expectedRule:  "swazz/stack-trace-leak",
			contains:      "502 Bad Gateway",
		},
		{
			name:          "No match on regular response",
			response:      `{"status":"ok"}`,
			expectedCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			input := &AnalysisInput{
				ResponseBody: []byte(tt.response),
			}
			findings := a.Analyze(input)
			if len(findings) != tt.expectedCount {
				t.Errorf("expected %d findings, got %d", tt.expectedCount, len(findings))
			}
			if len(findings) > 0 {
				if findings[0].RuleID != tt.expectedRule {
					t.Errorf("expected ruleID %s, got %s", tt.expectedRule, findings[0].RuleID)
				}
				if !strings.Contains(findings[0].Evidence, tt.contains) {
					t.Errorf("expected evidence to contain '%s', got '%s'", tt.contains, findings[0].Evidence)
				}
			}
		})
	}
}

