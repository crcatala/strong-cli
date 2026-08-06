/**
 * Typed error classes for CLI operations.
 *
 * Exit codes follow clig.dev conventions:
 * - 0: Success
 * - 1: General errors
 * - 2: Usage errors (invalid arguments, missing required options)
 */
export class CliError extends Error {
  constructor(
    message: string,
    public code: string,
    public exitCode = 1,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CliError'
  }

  toJSON(): Record<string, unknown> {
    return {
      error: true,
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
    }
  }
}

/** Usage error - invalid arguments, missing options. Exit code 2. */
export class UsageError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'USAGE_ERROR', 2, details)
    this.name = 'UsageError'
  }
}

/** Configuration error - missing/invalid config or credentials. */
export class ConfigError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFIG_ERROR', 1, details)
    this.name = 'ConfigError'
  }
}

/** Auth error - failed login, missing/expired credentials. */
export class AuthError extends CliError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'AUTH_ERROR', 1, details)
    this.name = 'AuthError'
  }
}

/** API error - non-2xx response from the Strong backend. */
export class ApiError extends CliError {
  constructor(
    message: string,
    public statusCode?: number,
    details?: Record<string, unknown>,
  ) {
    super(message, 'API_ERROR', 1, { statusCode, ...details })
    this.name = 'ApiError'
  }
}

export function isCliError(error: unknown): error is CliError {
  return error instanceof CliError
}
