import { useLayoutEffect, useRef, useState } from "react";
import type { DrawingPoint, DrawingStroke } from "./types";

type InkCanvasProps = {
  className: string;
  strokes: DrawingStroke[];
};

type CanvasPoint = {
  x: number;
  y: number;
  pressure: number;
};

const MAX_PIXEL_RATIO = 3;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const pointDistance = (a: CanvasPoint, b: CanvasPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

const smoothCenterLine = (points: CanvasPoint[]) => {
  if (points.length < 3) return points;

  return points.map((point, index) => {
    if (index === 0 || index === points.length - 1) return point;
    const previous = points[index - 1];
    const next = points[index + 1];
    return {
      x: previous.x * 0.18 + point.x * 0.64 + next.x * 0.18,
      y: previous.y * 0.18 + point.y * 0.64 + next.y * 0.18,
      pressure:
        previous.pressure * 0.16 + point.pressure * 0.68 + next.pressure * 0.16,
    };
  });
};

const toCanvasPoints = (
  points: DrawingPoint[],
  width: number,
  height: number,
): CanvasPoint[] => {
  const mapped = points.map((point) => ({
    x: (point.x / 100) * width,
    y: (point.y / 100) * height,
    pressure: clamp(point.pressure ?? 0.5, 0.08, 1),
  }));

  const distinct = mapped.filter(
    (point, index) => index === 0 || pointDistance(point, mapped[index - 1]) >= 0.12,
  );
  return smoothCenterLine(distinct);
};

const drawStroke = (
  context: CanvasRenderingContext2D,
  stroke: DrawingStroke,
  canvasWidth: number,
  canvasHeight: number,
) => {
  const points = toCanvasPoints(stroke.points, canvasWidth, canvasHeight);
  if (!points.length) return;

  const widthAt = (point: CanvasPoint) =>
    stroke.tool === "marker"
      ? stroke.width
      : stroke.width * (0.5 + clamp(point.pressure, 0.08, 1) * 0.82);

  context.save();
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.tool === "marker" ? 0.32 : 1;
  context.lineCap = "round";
  context.lineJoin = "round";

  if (points.length === 1) {
    const radius = Math.max(0.65, widthAt(points[0]) / 2);
    context.beginPath();
    context.arc(points[0].x, points[0].y, radius, 0, Math.PI * 2);
    context.fill();
    context.restore();
    return;
  }

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    context.lineWidth = Math.max(1.3, (widthAt(previous) + widthAt(point)) / 2);
    context.beginPath();
    context.moveTo(previous.x, previous.y);
    context.lineTo(point.x, point.y);
    context.stroke();
  }
  context.restore();
};

export default function InkCanvas({ className, strokes }: InkCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const measure = () => {
      const rect = canvas.getBoundingClientRect();
      const nextWidth = Math.max(1, Math.round(rect.width));
      const nextHeight = Math.max(1, Math.round(rect.height));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !size.width || !size.height) return;

    const pixelRatio = Math.min(MAX_PIXEL_RATIO, Math.max(1, window.devicePixelRatio || 1));
    const pixelWidth = Math.round(size.width * pixelRatio);
    const pixelHeight = Math.round(size.height * pixelRatio);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;

    const context = canvas.getContext("2d", { alpha: true });
    if (!context) return;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    for (const stroke of strokes) {
      drawStroke(context, stroke, size.width, size.height);
    }
  }, [size, strokes]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
