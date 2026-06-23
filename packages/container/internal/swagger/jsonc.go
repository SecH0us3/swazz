package swagger

// StripJSONC removes single-line (//) and multi-line (/* */) comments from JSON data,
// replacing comment characters with spaces (or preserving newlines/carriage returns)
// to keep the byte offsets of the remaining JSON exactly the same for accurate error reporting.
func StripJSONC(data []byte) []byte {
	res := make([]byte, len(data))
	state := 0 // 0: normal, 1: string, 2: string_escape, 3: slash (potential comment), 4: line_comment, 5: block_comment, 6: block_comment_star

	for i := 0; i < len(data); i++ {
		b := data[i]
		switch state {
		case 0: // normal
			if b == '"' {
				state = 1 // string
				res[i] = b
			} else if b == '/' {
				state = 3 // potential comment
				res[i] = ' '
			} else {
				res[i] = b
			}
		case 1: // string
			if b == '\\' {
				state = 2 // string escape
				res[i] = b
			} else if b == '"' {
				state = 0 // normal
				res[i] = b
			} else {
				res[i] = b
			}
		case 2: // string escape
			state = 1
			res[i] = b
		case 3: // potential comment (previous char was '/')
			if b == '/' {
				state = 4 // line comment
				res[i] = ' '
			} else if b == '*' {
				state = 5 // block comment
				res[i] = ' '
			} else {
				// Not a comment! Restore the previous '/' and current char
				state = 0
				res[i-1] = '/'
				res[i] = b
			}
		case 4: // line comment
			if b == '\n' {
				state = 0
				res[i] = '\n'
			} else if b == '\r' {
				res[i] = '\r'
			} else {
				res[i] = ' '
			}
		case 5: // block comment
			if b == '*' {
				state = 6 // block comment potential end
				res[i] = ' '
			} else if b == '\n' {
				res[i] = '\n'
			} else if b == '\r' {
				res[i] = '\r'
			} else {
				res[i] = ' '
			}
		case 6: // block comment potential end (previous char was '*')
			if b == '/' {
				state = 0
				res[i] = ' '
			} else if b == '*' {
				res[i] = ' '
			} else if b == '\n' {
				state = 5
				res[i] = '\n'
			} else if b == '\r' {
				state = 5
				res[i] = '\r'
			} else {
				state = 5
				res[i] = ' '
			}
		}
	}

	// Edge case: if we ended in state 3 (a single trailing slash, not followed by / or *)
	if state == 3 {
		res[len(data)-1] = '/'
	}

	return res
}
