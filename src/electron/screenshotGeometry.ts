export type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export function scaleSelectionToImage(
  selection: Rect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): Rect {
  if (
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    image.width <= 0 ||
    image.height <= 0
  ) {
    throw new Error("Screenshot dimensions must be positive.");
  }
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const x = Math.max(0, Math.round(selection.x * scaleX));
  const y = Math.max(0, Math.round(selection.y * scaleY));
  return {
    x,
    y,
    width: Math.max(
      2,
      Math.min(image.width - x, Math.round(selection.width * scaleX)),
    ),
    height: Math.max(
      2,
      Math.min(image.height - y, Math.round(selection.height * scaleY)),
    ),
  };
}
