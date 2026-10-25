import { AppError } from "../http.js";

// Only emit bounded codes/field locations. Never log provider response bodies,
// prompts, HTML, headers, endpoints or credentials.
export function languageFailure(error) {
  if (error instanceof AppError) return error.code;
  if (error?.name === "ZodError") {
    const htmlCode = error.issues?.map(issue => issue.message).find(message => /^HTML_[A-Z_]+$/.test(message));
    return htmlCode || "LANGUAGE_RESULT_INVALID";
  }
  if (error?.name === "HtmlDocumentError" && /^[A-Z][A-Z0-9_]{1,100}$/.test(error.code || "")) return error.code;
  if (["LanguageResultError", "NativeSheetEditError", "NativeDocumentEditError"].includes(error?.name)) return "LANGUAGE_RESULT_INVALID";
  if (error?.status === 429) return "LANGUAGE_PROVIDER_RATE_LIMITED";
  if ([401, 403].includes(error?.status)) return "LANGUAGE_PROVIDER_AUTH_FAILED";
  if (error?.status >= 500 && error?.status <= 599) return "LANGUAGE_PROVIDER_UNAVAILABLE";
  if (["APIConnectionTimeoutError", "TimeoutError"].includes(error?.name)) return "LANGUAGE_TIMEOUT";
  if (["APIConnectionError", "AbortError"].includes(error?.name) || ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "ENOTFOUND"].includes(error?.code)) return "LANGUAGE_PROVIDER_CONNECTION_FAILED";
  if (error?.status >= 400 && error?.status <= 499) return "LANGUAGE_PROVIDER_REQUEST_REJECTED";
  return "LANGUAGE_RESULT_UNAVAILABLE";
}

export function languageFailureDiagnostic(error) {
  return { errorCode: languageFailure(error), ...(Number.isInteger(error?.status) ? { httpStatus: error.status } : {}),
    ...(error?.name === "ZodError" ? { issues: (error.issues || []).slice(0, 5).map(issue => ({
      code: /^[a-z_]+$/.test(issue.code || "") ? issue.code : "custom",
      path: (issue.path || []).slice(0, 6).map(part => typeof part === "number" ? part : ["html", "width", "height", "id", "title", "pages", "theme", "notes", "hidden"].includes(part) ? part : "field"),
    })) } : {}),
  };
}
