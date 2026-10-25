import { AppError } from "../http.js";

// Receive one paid request incrementally. Only a fully finished response may
// be validated/published; partial JSON and reasoning never become artifacts.
export async function collectLanguageStream(stream, { signal, maxBytes, diagnostics, startedAt }) {
  let text = "", finished = false;
  try {
    signal?.throwIfAborted();
    if (!stream?.[Symbol.asyncIterator]) throw new AppError("LANGUAGE_STREAM_UNSUPPORTED", 502);
    for await (const chunk of stream) {
      signal?.throwIfAborted();
      diagnostics.chunksReceived++;
      diagnostics.firstChunkMs ??= Date.now() - startedAt;
      const choices = chunk?.choices;
      if (!Array.isArray(choices)) throw new AppError("LANGUAGE_RESULT_INVALID", 502);
      if (!choices.length) continue; // Optional usage-only chunk.
      if (choices.length !== 1 || choices[0].index !== 0) throw new AppError("LANGUAGE_RESULT_INVALID", 502);
      const choice = choices[0], delta = choice.delta;
      if (delta?.refusal || delta?.tool_calls?.length || delta?.function_call) throw new AppError("LANGUAGE_RESULT_INCOMPLETE", 502);
      if (delta?.content != null) {
        if (typeof delta.content !== "string") throw new AppError("LANGUAGE_RESULT_INVALID", 502);
        diagnostics.contentBytes += Buffer.byteLength(delta.content);
        if (diagnostics.contentBytes > maxBytes) throw new AppError("LANGUAGE_RESULT_TOO_LARGE", 502);
        text += delta.content;
      }
      if (choice.finish_reason != null) {
        if (choice.finish_reason !== "stop") throw new AppError("LANGUAGE_RESULT_INCOMPLETE", 502);
        finished = true;
        break;
      }
    }
    // The SDK may finish iteration silently on abort. Never accept its prefix.
    signal?.throwIfAborted();
    if (!finished) throw new AppError("LANGUAGE_STREAM_INTERRUPTED", 502);
    if (!text.trim()) throw new AppError("LANGUAGE_RESULT_INVALID", 502);
    return text;
  } finally { stream?.controller?.abort(); }
}
