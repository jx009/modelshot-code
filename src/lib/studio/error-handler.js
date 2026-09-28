/**
 * Studio error types with user-friendly messages
 */
export const StudioErrorType = {
  // Network errors
  NETWORK_ERROR: "NETWORK_ERROR",
  TIMEOUT: "TIMEOUT",

  // Image loading errors
  IMAGE_LOAD_FAILED: "IMAGE_LOAD_FAILED",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  INVALID_IMAGE_FORMAT: "INVALID_IMAGE_FORMAT",

  // Segmentation errors
  SEGMENTATION_FAILED: "SEGMENTATION_FAILED",
  SEGMENTATION_TIMEOUT: "SEGMENTATION_TIMEOUT",
  SEGMENTATION_NO_SELECTION: "SEGMENTATION_NO_SELECTION",
  SEGMENTATION_INVALID_MASK: "SEGMENTATION_INVALID_MASK",

  // Move/Transform errors
  MOVE_INVALID_OFFSET: "MOVE_INVALID_OFFSET",
  TRANSFORM_OUT_OF_BOUNDS: "TRANSFORM_OUT_OF_BOUNDS",

  // General errors
  UNKNOWN_ERROR: "UNKNOWN_ERROR",
  INSUFFICIENT_CREDITS: "INSUFFICIENT_CREDITS"
};

/**
 * User-friendly error messages (Chinese)
 */
const ERROR_MESSAGES_ZH = {
  [StudioErrorType.NETWORK_ERROR]: "网络连接失败，请检查网络后重试",
  [StudioErrorType.TIMEOUT]: "操作超时，请重试",

  [StudioErrorType.IMAGE_LOAD_FAILED]: "图片加载失败，请重新上传",
  [StudioErrorType.IMAGE_TOO_LARGE]: "图片过大，请上传小于 10MB 的图片",
  [StudioErrorType.INVALID_IMAGE_FORMAT]: "不支持的图片格式，请使用 JPG、PNG 或 WEBP",

  [StudioErrorType.SEGMENTATION_FAILED]: "抠图失败，请调整选区后重试",
  [StudioErrorType.SEGMENTATION_TIMEOUT]: "抠图超时，图片过大或服务器繁忙",
  [StudioErrorType.SEGMENTATION_NO_SELECTION]: "请先框选要抠图的区域",
  [StudioErrorType.SEGMENTATION_INVALID_MASK]: "选区无效，请重新框选",

  [StudioErrorType.MOVE_INVALID_OFFSET]: "移动位置无效",
  [StudioErrorType.TRANSFORM_OUT_OF_BOUNDS]: "变换超出画布范围",

  [StudioErrorType.UNKNOWN_ERROR]: "操作失败，请重试",
  [StudioErrorType.INSUFFICIENT_CREDITS]: "积分不足，请充值后继续"
};

/**
 * User-friendly error messages (English)
 */
const ERROR_MESSAGES_EN = {
  [StudioErrorType.NETWORK_ERROR]: "Network connection failed, please check and retry",
  [StudioErrorType.TIMEOUT]: "Operation timed out, please retry",

  [StudioErrorType.IMAGE_LOAD_FAILED]: "Failed to load image, please re-upload",
  [StudioErrorType.IMAGE_TOO_LARGE]: "Image too large, please upload images under 10MB",
  [StudioErrorType.INVALID_IMAGE_FORMAT]: "Unsupported image format, please use JPG, PNG or WEBP",

  [StudioErrorType.SEGMENTATION_FAILED]: "Segmentation failed, please adjust selection and retry",
  [StudioErrorType.SEGMENTATION_TIMEOUT]: "Segmentation timed out, image too large or server busy",
  [StudioErrorType.SEGMENTATION_NO_SELECTION]: "Please select an area to segment first",
  [StudioErrorType.SEGMENTATION_INVALID_MASK]: "Invalid selection, please reselect",

  [StudioErrorType.MOVE_INVALID_OFFSET]: "Invalid move offset",
  [StudioErrorType.TRANSFORM_OUT_OF_BOUNDS]: "Transform exceeds canvas bounds",

  [StudioErrorType.UNKNOWN_ERROR]: "Operation failed, please retry",
  [StudioErrorType.INSUFFICIENT_CREDITS]: "Insufficient credits, please recharge to continue"
};

/**
 * Parse error from API response or exception
 * @param {Error | Response | string} error - Error object, response, or error code
 * @returns {{type: string, message: string, details?: any}}
 */
export function parseStudioError(error, locale = "zh") {
  const messages = locale === "zh" ? ERROR_MESSAGES_ZH : ERROR_MESSAGES_EN;

  // String error code
  if (typeof error === "string") {
    const type = StudioErrorType[error] || StudioErrorType.UNKNOWN_ERROR;
    return {
      type,
      message: messages[type]
    };
  }

  // Network error
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return {
      type: StudioErrorType.NETWORK_ERROR,
      message: messages[StudioErrorType.NETWORK_ERROR]
    };
  }

  // Timeout error
  if (error.name === "AbortError" || error.message?.includes("timeout")) {
    return {
      type: StudioErrorType.TIMEOUT,
      message: messages[StudioErrorType.TIMEOUT]
    };
  }

  // API response error
  if (error.code) {
    const type = StudioErrorType[error.code] || StudioErrorType.UNKNOWN_ERROR;
    return {
      type,
      message: error.message || messages[type],
      details: error.details
    };
  }

  // Generic error
  return {
    type: StudioErrorType.UNKNOWN_ERROR,
    message: messages[StudioErrorType.UNKNOWN_ERROR],
    details: error.message
  };
}

/**
 * Create enhanced error for segmentation operation
 * @param {Response} response - Fetch response
 * @returns {Promise<Error>}
 */
export async function createSegmentationError(response) {
  let body;
  try {
    body = await response.json();
  } catch {
    body = { code: "SEGMENTATION_FAILED" };
  }

  const error = new Error(body.message || "Segmentation failed");
  error.code = body.code || "SEGMENTATION_FAILED";
  error.details = body.details;
  error.status = response.status;

  return error;
}

/**
 * Validate image file before upload
 * @param {File} file - Image file
 * @returns {{valid: boolean, error?: {type: string, message: string}}}
 */
export function validateImageFile(file, locale = "zh") {
  const messages = locale === "zh" ? ERROR_MESSAGES_ZH : ERROR_MESSAGES_EN;
  const maxSize = 10 * 1024 * 1024; // 10MB
  const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp"];

  if (!validTypes.includes(file.type)) {
    return {
      valid: false,
      error: {
        type: StudioErrorType.INVALID_IMAGE_FORMAT,
        message: messages[StudioErrorType.INVALID_IMAGE_FORMAT]
      }
    };
  }

  if (file.size > maxSize) {
    return {
      valid: false,
      error: {
        type: StudioErrorType.IMAGE_TOO_LARGE,
        message: messages[StudioErrorType.IMAGE_TOO_LARGE]
      }
    };
  }

  return { valid: true };
}
