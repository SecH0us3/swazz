🧪 [testing improvement] Add error path test for HTTP client failures

🎯 **What:** The previous testing coverage lacked a test to verify how the CLI's request runner (`packages/container/internal/runner/runner.go`) behaves when the HTTP client (`http.Client.Do`) encounters an immediate failure (e.g., DNS resolution failure or network timeout).
📊 **Coverage:** A new test case `TestExecuteRequest_ErrorPath` was added to `packages/container/internal/runner/runner_test.go` that provides an invalid URL format to ensure an immediate failure. The test verifies that the `executeRequest` method correctly surfaces the error by populating the `Status` and `Error` fields of the returned `FuzzResult`.
✨ **Result:** Enhanced test suite reliability by ensuring critical HTTP communication errors are appropriately captured and formatted within the runner logic, preventing unhandled edge cases during fuzzing.
