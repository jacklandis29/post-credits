function errorName(error: unknown): string {
  if (error instanceof Error) return error.name || "Error";
  return typeof error;
}

function requestContext(request?: Request) {
  const rayId = request?.headers.get("cf-ray")?.slice(0, 64) || undefined;
  return rayId ? { rayId } : {};
}

export function logServerError(
  route: string,
  error: unknown,
  request?: Request,
): void {
  console.error(JSON.stringify({
    event: "api_error",
    route,
    errorName: errorName(error),
    ...requestContext(request),
  }));
}

export function logSecurityEvent(event: string, request?: Request): void {
  console.log(JSON.stringify({
    event,
    ...requestContext(request),
  }));
}
