export type ErrorDetail =
  | string
  | {
      code?: string;
      details?: string;
      message?: string;
    };

export interface ShutdownResponse {
  message: string;
}
