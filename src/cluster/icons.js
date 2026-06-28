export function drawLightning(ctx, x, y, size, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.moveTo(4, 0);
  ctx.lineTo(-2, 13);
  ctx.lineTo(6, 13);
  ctx.lineTo(2, 24);
  ctx.lineTo(14, 9);
  ctx.lineTo(7, 9);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export function drawAutodriveIcon(ctx, x, y, size, active) {
  ctx.save();
  ctx.globalAlpha = active ? 1 : 0.3;
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';

  const s = size / 24;
  ctx.translate(x, y);
  ctx.scale(s, s);

  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(12, 4 - i * 3, 4 + i * 3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.moveTo(5, 18);
  ctx.lineTo(5, 14);
  ctx.quadraticCurveTo(5, 10, 12, 10);
  ctx.quadraticCurveTo(19, 10, 19, 14);
  ctx.lineTo(19, 18);
  ctx.lineTo(16, 18);
  ctx.lineTo(16, 15);
  ctx.lineTo(8, 15);
  ctx.lineTo(8, 18);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
