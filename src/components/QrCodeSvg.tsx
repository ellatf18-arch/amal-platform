import React, { useMemo } from 'react';
import QRCode from 'qrcode';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
  title?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 160,
  fgColor = '#111827',
  bgColor = '#FFFFFF',
  title = 'QR Code',
}) => {
  const matrix = useMemo(() => {
    try {
      const qr = QRCode.create(value || 'https://amal.hospitality/menu', {
        errorCorrectionLevel: 'M',
      });
      const dim = qr.modules.size;
      const cells: { x: number; y: number }[] = [];
      for (let y = 0; y < dim; y++) {
        for (let x = 0; x < dim; x++) {
          if (qr.modules.get(y, x)) {
            cells.push({ x, y });
          }
        }
      }
      return { dim, cells };
    } catch {
      return { dim: 21, cells: [] };
    }
  }, [value]);

  const margin = 2;
  const viewBoxSize = matrix.dim + margin * 2;

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${viewBoxSize} ${viewBoxSize}`}
      role="img"
      aria-label={title}
      className="block shrink-0"
      shapeRendering="crispEdges"
    >
      <rect x={0} y={0} width={viewBoxSize} height={viewBoxSize} fill={bgColor} />
      {matrix.cells.map((cell, idx) => (
        <rect
          key={idx}
          x={cell.x + margin}
          y={cell.y + margin}
          width={1}
          height={1}
          fill={fgColor}
        />
      ))}
    </svg>
  );
};
