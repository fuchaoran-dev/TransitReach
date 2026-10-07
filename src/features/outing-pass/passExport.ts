import QRCode from 'qrcode';
import type { CheckedPassLeg, PersonalPass } from './types';

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

function formatTime(value: string): string {
  return new Intl.DateTimeFormat('en-MY', {
    timeZone: 'Asia/Kuala_Lumpur',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function legLabel(leg: CheckedPassLeg): string {
  if (leg.mode === 'WALK') return `Walk ${Math.round(leg.distanceMeters)} m to ${leg.to.name}`;
  const route = leg.routeShortName ?? leg.routeLongName;
  return `${leg.mode === 'BUS' ? 'Bus' : 'Ride'}${route ? ` ${route}` : ''} to ${leg.to.name}`;
}

function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The pass QR image could not be rendered.'));
    image.src = src;
  });
}

/** Renders an offline-readable PNG containing only this member's pass and the room-only QR. */
export async function renderPassImage(pass: PersonalPass, baseUrl?: string): Promise<Blob> {
  const width = 1200;
  const margin = 72;
  const canvas = document.createElement('canvas');
  const measure = canvas.getContext('2d');
  if (!measure) throw new Error('Image export is unavailable in this browser.');
  measure.font = '30px Manrope, sans-serif';

  const rows = [
    `Leave around ${formatTime(pass.leaveTime)}`,
    `Meet at ${pass.meeting.venue.name} · ${formatTime(pass.meeting.arrivalTime)}`,
    ...pass.legs.map((leg, index) => `${index + 1}. ${legLabel(leg)}`),
    `Estimated arrival ${formatTime(pass.estimatedArrivalTime)} · ${Math.round(pass.arrivalMarginSeconds / 60)} min margin`,
    `Walking total ${Math.round(pass.walking.totalSeconds / 60)} min`,
    ...pass.walking.directions.map((step, index) =>
      `Walk ${index + 1}: ${step.relativeDirection.replace(/_/g, ' ').toLowerCase()}${step.streetName ? ` on ${step.streetName}` : ''} · ${Math.round(step.distanceMeters)} m`,
    ),
    `Weak point: ${pass.weakPoint.label}`,
    `Checked ${formatTime(pass.checkedAt)} · Times are estimates`,
  ];
  const wrapped = rows.map(row => wrapText(measure, row, width - margin * 2));
  const contentHeight = wrapped.reduce((sum, lines) => sum + lines.length * 44 + 22, 0);
  const height = Math.max(1500, 750 + contentHeight);
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Image export is unavailable in this browser.');

  context.fillStyle = '#07111f';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#2dd4bf';
  context.font = '700 30px Manrope, sans-serif';
  context.fillText('TRANSITREACH · PERSONAL OUTING PASS', margin, 90);
  context.fillStyle = '#f8fafc';
  context.font = '800 58px "Plus Jakarta Sans", sans-serif';
  context.fillText(pass.meeting.venue.name, margin, 170, width - margin * 2);
  context.fillStyle = pass.status === 'Ready' ? '#5eead4' : pass.status === 'Check needed' ? '#fda4af' : '#fcd34d';
  context.font = '700 34px Manrope, sans-serif';
  context.fillText(pass.status, margin, 228);

  let y = 310;
  context.fillStyle = '#e2e8f0';
  context.font = '30px Manrope, sans-serif';
  for (const lines of wrapped) {
    for (const line of lines) {
      context.fillText(line, margin, y);
      y += 44;
    }
    y += 22;
  }

  const qrDataUrl = await generateRoomQrDataUrl(pass.roomCode, baseUrl);
  const qr = await loadImage(qrDataUrl);
  const qrSize = 300;
  const qrY = height - qrSize - 100;
  context.fillStyle = '#ffffff';
  context.fillRect(margin - 16, qrY - 16, qrSize + 32, qrSize + 32);
  context.drawImage(qr, margin, qrY, qrSize, qrSize);
  context.fillStyle = '#94a3b8';
  context.font = '26px Manrope, sans-serif';
  context.fillText(`Open room ${pass.roomCode}`, margin + qrSize + 50, qrY + 110);
  context.fillText('Your route is not stored in this QR code.', margin + qrSize + 50, qrY + 160);

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
