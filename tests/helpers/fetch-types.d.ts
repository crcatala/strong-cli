/**
 * Test-only global type for the fetch API.
 *
 * @types/node (22.x) declares fetch/Request/Response/RequestInit as globals
 * but keeps `RequestInfo` module-scoped (undici-types). Test files annotate
 * mock fetches with `RequestInfo`, so declare it globally here. This file is
 * only included by tsconfig.test.json (src never references RequestInfo by
 * name; the main tsconfig excludes tests).
 */
type RequestInfo = string | URL | Request
