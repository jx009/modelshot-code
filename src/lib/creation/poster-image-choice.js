// Small UI-only helpers; the homepage must not load schemas or editor engines.
export const POSTER_IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"];
export function posterImageSize(width, height) {
  return width / height > 1.15 ? "1536x1024" : width / height < 0.87 ? "1024x1536" : "1024x1024";
}
export function posterImageChoice(caps, dimensions, provider) {
  const [width, height] = dimensions.split("x").map(Number), size = posterImageSize(width, height);
  const quote = provider ? caps?.imageModels?.find(model => model.id === provider) : caps?.posterImage;
  return quote && Number.isSafeInteger(quote.prices?.[size]) && quote.prices[size] >= 0 && quote.prices[size] <= 200000 ? { size, expectedCost: quote.prices[size], ...(quote.provider ? { provider: quote.provider } : {}) } : null;
}
