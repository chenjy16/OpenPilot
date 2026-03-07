# Available Tools

## readFile
Read the contents of a file from disk.
- Parameters: `path` (string, required)

## writeFile
Write content to a file on disk.
- Parameters: `path` (string, required), `content` (string, required)

## httpRequest
Make an HTTP request to a URL.
- Parameters: `url` (string, required), `method` (GET|POST|PUT|DELETE), `headers` (object), `body` (string)

## shellExecute
Execute a shell command. Dangerous operations require user approval.
- Parameters: `command` (string, required), `cwd` (string), `timeoutMs` (number, max 30000)

## browserNavigate
Navigate to a URL and return page title and text content.
- Parameters: `url` (string, required), `waitForSelector` (string)

## browserScreenshot
Take a screenshot of the current browser page. Returns base64 PNG.
- Parameters: `fullPage` (boolean)

## browserClick
Click an element on the current page by CSS selector.
- Parameters: `selector` (string, required)

## browserEvaluate
Execute JavaScript in the browser page context.
- Parameters: `code` (string, required)

## applyPatch
Apply a unified diff patch to a file. Supports creating new files.
- Parameters: `patch` (string, required), `basePath` (string)

## memorySearch
Search past conversation messages using full-text search.
- Parameters: `query` (string, required), `limit` (number, default 10)

## memoryGet
Read the USER.md long-term memory file.

## memoryUpdate
Update the USER.md long-term memory file.
- Parameters: `content` (string, required), `mode` (append|replace, default append)

## spawnSubAgent
Spawn a child Agent for a delegated sub-task. Max depth: 3 levels.
- Parameters: `task` (string, required), `model` (string)
