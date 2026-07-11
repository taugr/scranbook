import type { StoredPhoto } from './schema';

const maximumSourceBytes = 25 * 1024 * 1024;
const acceptedTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
]);

export class ImageValidationError extends Error {}

function validateImage(file: Blob) {
  if (file.size === 0) throw new ImageValidationError('That image is empty.');
  if (file.size > maximumSourceBytes) {
    throw new ImageValidationError('Choose an image smaller than 25 MB.');
  }
  if (file.type && !acceptedTypes.has(file.type.toLowerCase())) {
    throw new ImageValidationError('Choose a JPEG, PNG, WebP, or HEIC image.');
  }
}

async function canvasBlob(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error('The browser could not encode the image.')),
      'image/jpeg',
      quality,
    );
  });
}

export async function processImage(
  file: Blob,
  options: { maxDimension: number; quality: number },
): Promise<StoredPhoto> {
  validateImage(file);
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  const scale = Math.min(
    1,
    options.maxDimension / Math.max(bitmap.width, bitmap.height),
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Image processing is not available in this browser.');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await canvasBlob(canvas, options.quality);
  return {
    id: crypto.randomUUID(),
    blob,
    mimeType: 'image/jpeg',
    width,
    height,
    byteSize: blob.size,
    createdAt: new Date().toISOString(),
  };
}

export async function rotatePhoto(photo: StoredPhoto): Promise<StoredPhoto> {
  const bitmap = await createImageBitmap(photo.blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.height;
  canvas.height = bitmap.width;
  const context = canvas.getContext('2d');
  if (!context)
    throw new Error('Image rotation is not available in this browser.');
  context.translate(canvas.width / 2, canvas.height / 2);
  context.rotate(Math.PI / 2);
  context.drawImage(bitmap, -bitmap.width / 2, -bitmap.height / 2);
  bitmap.close();
  const blob = await canvasBlob(canvas, 0.88);
  return {
    ...photo,
    blob,
    width: canvas.width,
    height: canvas.height,
    byteSize: blob.size,
  };
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error('Could not read image.'));
    reader.readAsDataURL(blob);
  });
}
