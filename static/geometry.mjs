export function videoRect(container, sourceWidth, sourceHeight) {
  const scale = Math.min(container.width / sourceWidth, container.height / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { left: container.left + (container.width - width) / 2,
    top: container.top + (container.height - height) / 2, width, height };
}

export function sourcePoint(clientX, clientY, container, sourceWidth, sourceHeight) {
  const rect = videoRect(container, sourceWidth, sourceHeight);
  if (clientX < rect.left || clientY < rect.top || clientX >= rect.left + rect.width || clientY >= rect.top + rect.height) return null;
  return { x: Math.min(sourceWidth - 1, Math.floor((clientX - rect.left) * sourceWidth / rect.width)),
    y: Math.min(sourceHeight - 1, Math.floor((clientY - rect.top) * sourceHeight / rect.height)) };
}

export function maskBounds(mask, width, height) {
  let left = width, top = height, right = -1, bottom = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x]) {
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y); count++;
      }
    }
  }
  return count ? { left, top, width: right - left + 1, height: bottom - top + 1, count } : null;
}

