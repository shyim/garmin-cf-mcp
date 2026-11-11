// Inline photos only: no remote URLs, filesystem access, or persistent storage.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_BASE64_LENGTH = 4 * Math.ceil(MAX_IMAGE_BYTES / 3);

export function decodeActivityImage(imageBase64: string, filename: string): Blob {
  if (filename.length > 128 || !/^[^/\\\x00-\x1f\x7f]+\.(jpe?g|png)$/i.test(filename))
    throw new Error("filename must be a basename ending in .jpg, .jpeg or .png (max 128 characters)");
  if (!imageBase64 || imageBase64.length > MAX_IMAGE_BASE64_LENGTH ||
      imageBase64.length % 4 !== 0 ||
      /[^A-Za-z0-9+/=]/.test(imageBase64))
    throw new Error("image_base64 must be padded standard Base64 without a data URL prefix; maximum decoded size is 5 MiB");
  let binary: string;
  try {
    binary = atob(imageBase64);
  } catch {
    throw new Error("Invalid Base64 image");
  }
  if (btoa(binary) !== imageBase64 || binary.length > MAX_IMAGE_BYTES)
    throw new Error("Invalid Base64 or image larger than 5 MiB");
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (/\.png$/i.test(filename) ? !png : !jpeg)
    throw new Error("Image signature does not match the JPEG/PNG filename");
  return new Blob([bytes], { type: png ? "image/png" : "image/jpeg" });
}

/** Activity detail uses metadataDTO; feed/search responses use a different shape. */
export function activityImageIds(activity: unknown): string[] {
  const images = (activity as { metadataDTO?: { activityImages?: unknown } } | null)?.metadataDTO?.activityImages;
  if (!Array.isArray(images)) throw new Error("Activity response is missing metadataDTO.activityImages");
  return images.map((image) => {
    const id = image?.imageId;
    if ((typeof id !== "string" && typeof id !== "number") || String(id) === "")
      throw new Error("Activity image is missing imageId");
    return String(id);
  });
}
