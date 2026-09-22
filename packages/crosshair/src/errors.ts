export type CrosshairErrorCode =
  | 'EMPTY_INPUT' | 'INPUT_TOO_LONG' | 'INVALID_CODE' | 'UNSUPPORTED_VERSION'
  | 'UNSUPPORTED_FIELD' | 'INVALID_VALUE' | 'UNSUPPORTED_PROFILE'
  | 'INVALID_RENDER_OPTIONS' | 'INVALID_PNG' | 'UNSUPPORTED_PNG'
  | 'IMAGE_TOO_LARGE' | 'EMPTY_CROSSHAIR' | 'OUTPUT_EXISTS' | 'IO_ERROR';

/**
 * The CLI and every PowerShell-facing caller read `.message` (Chinese, the field the CLI
 * has always shown); `.en` is the same refusal in English, for the App's Crosshair page.
 */
export class CrosshairError extends Error {
  readonly name = 'CrosshairError';
  constructor(readonly code: CrosshairErrorCode, message: string, readonly en: string, readonly field?: string) {
    super(message);
  }
}

export interface CrosshairWarning {
  code: string;
  message: string;
}
