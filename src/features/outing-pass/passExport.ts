import QRCode from 'qrcode';
import type { PersonalPass } from './types';
import { drawPassCanvas } from './passImageRenderer';

const ROOM_PATTERN = /^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{8}$/;

export function createRoomQrData(roomCode: string, baseUrl?: string): string {
  if (!ROOM_PATTERN.test(roomCode)) throw new Error('The room reference is invalid.');
  const fallback = typeof window === 'undefined' ? 'https://transitreach.invalid/' : window.location.href;
  const url = new URL(baseUrl ?? fallback);
  url.search = '';
  url.hash = '';
  url.searchParams.set('meet', roomCode);
  return url.toString();
}

/** A scannable QR image whose payload contains only the opaque room invitation URL. */
export function generateRoomQrDataUrl(roomCode: string, baseUrl?: string): Promise<string> {
  return QRCode.toDataURL(createRoomQrData(roomCode, baseUrl), {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

/** All graphics use the private pass's recorded geometry; no external tiles are fetched. */
export async function renderPassImage(pass: PersonalPass, baseUrl?: string): Promise<Blob> {
  if (document.fonts) await document.fonts.ready;
  const qrUrl = await generateRoomQrDataUrl(pass.roomCode, baseUrl);
  const qr = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The pass QR image could not be rendered.'));
    image.src = qrUrl;
  });
  const canvas = drawPassCanvas(pass, qr);
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The pass image could not be created.')), 'image/png');
  });
}

export async function downloadPassImage(pass: PersonalPass, baseUrl?: string): Promise<void> {
  const blob = await renderPassImage(pass, baseUrl);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `transitreach-${pass.roomCode.toLowerCase()}-pass.png`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser time to consume the Blob URL before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
