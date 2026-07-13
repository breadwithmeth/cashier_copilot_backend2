export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code = 'HTTP_ERROR',
    public details?: unknown
  ) {
    super(message);
  }
}
