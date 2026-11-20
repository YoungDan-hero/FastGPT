import { Box, IconButton, usePrefersReducedMotion } from '@chakra-ui/react';
import { useSafeTranslation } from '@fastgpt/web/hooks/useSafeTranslation';
import { useEffect, useRef, useState } from 'react';
import type { AppListFilterScene } from './filters/utils';

const fullTurn = Math.PI * 2;
const contourCount = 32;
const outlineSamples = 112;

const makeOutline = (scene: AppListFilterScene) => {
  const power = scene === 'agent' ? 2.65 : 0.73;
  return Array.from({ length: outlineSamples }, (_, index) => {
    const angle = (index / outlineSamples) * fullTurn;
    const x = Math.cos(angle);
    const y = Math.sin(angle);

    return {
      angle,
      x: Math.sign(x) * Math.abs(x) ** power,
      y: Math.sign(y) * Math.abs(y) ** power
    };
  });
};

/** 用渐变轮廓和少量高光表现持续变化的光线，画布保持透明。 */
const paintArtwork = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  seconds: number,
  outline: ReturnType<typeof makeOutline>
) => {
  const scale = Math.min(width * 0.94, height);
  const x = width * 0.51 + scale * 0.025 * Math.sin(seconds * 0.65);
  const y = height * 0.49 + scale * 0.021 * Math.sin(seconds * 0.79);

  context.clearRect(0, 0, width, height);
  context.save();
  context.translate(x, y);

  const light = context.createRadialGradient(-scale * 0.08, -scale * 0.1, 0, 0, 0, scale * 0.54);
  light.addColorStop(0, 'rgba(184, 208, 255, 0.36)');
  light.addColorStop(0.47, 'rgba(215, 228, 255, 0.28)');
  light.addColorStop(0.78, 'rgba(216, 245, 244, 0.14)');
  light.addColorStop(1, 'rgba(232, 242, 252, 0)');
  context.fillStyle = light;
  context.fillRect(-scale * 0.58, -scale * 0.58, scale * 1.16, scale * 1.16);

  const ribbon = context.createLinearGradient(
    -scale * 0.38,
    -scale * 0.26,
    scale * 0.42,
    scale * 0.28
  );
  ribbon.addColorStop(0, 'rgba(123, 161, 238, 0.13)');
  ribbon.addColorStop(0.26, 'rgba(78, 103, 214, 0.72)');
  ribbon.addColorStop(0.51, 'rgba(95, 151, 233, 0.57)');
  ribbon.addColorStop(0.76, 'rgba(77, 176, 186, 0.66)');
  ribbon.addColorStop(1, 'rgba(163, 211, 230, 0.19)');
  context.strokeStyle = ribbon;
  context.lineJoin = 'round';

  for (let index = 0; index < contourCount; index++) {
    const layer = index / (contourCount - 1);
    const depth = layer - 0.5;
    const drift = seconds * 0.8 - layer * 3.3;
    const rotation = depth * 0.77 + 0.13 * Math.sin(drift);
    const radius = scale * (0.26 + layer * 0.15 + 0.024 * Math.sin(drift));
    const cosine = Math.cos(rotation);
    const sine = Math.sin(rotation);

    context.lineWidth = 0.7 + 0.35 * Math.sin(layer * Math.PI);
    context.globalAlpha = 0.22 + 0.5 * Math.sin(layer * Math.PI);
    context.beginPath();

    outline.forEach((point, pointIndex) => {
      const ripple = 1 + 0.04 * Math.sin(point.angle * 3 + drift);
      const px = point.x * radius * ripple;
      const py = point.y * radius * ripple * 0.87;
      const nextX = px * cosine - py * sine + scale * depth * 0.16;
      const nextY = px * sine + py * cosine + scale * depth * 0.12;

      if (pointIndex === 0) {
        context.moveTo(nextX, nextY);
      } else {
        context.lineTo(nextX, nextY);
      }
    });

    context.closePath();
    context.stroke();
  }

  context.globalAlpha = 1;
  context.rotate(-0.37);
  context.strokeStyle = 'rgba(107, 157, 211, 0.26)';
  context.lineWidth = 0.85;
  context.beginPath();
  context.ellipse(0, 0, scale * 0.48, scale * 0.32, 0, 0.13, Math.PI * 1.3);
  context.stroke();

  // 高光沿外沿缓慢掠过，静止时留在同一位置。
  const progress = ((seconds * 0.41) / (Math.PI * 1.22)) % 1;
  const angle = 0.13 + progress * Math.PI * 1.22;
  const trailX = Math.cos(angle) * scale * 0.48;
  const trailY = Math.sin(angle) * scale * 0.32;
  const highlight = context.createRadialGradient(trailX, trailY, 0, trailX, trailY, 6);
  highlight.addColorStop(0, 'rgba(86, 134, 245, 0.77)');
  highlight.addColorStop(1, 'rgba(86, 134, 245, 0)');
  context.globalAlpha = Math.sin(progress * Math.PI);
  context.fillStyle = highlight;
  context.fillRect(trailX - 6, trailY - 6, 12, 12);
  context.restore();
};

const WorkspaceArtwork = ({ scene }: { scene: AppListFilterScene }) => {
  const { t } = useSafeTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsed = useRef(1.25);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const outline = makeOutline(scene);
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastTimestamp: number | undefined;

    const paint = () => paintArtwork(context, width, height, elapsed.current, outline);
    const resize = () => {
      ({ width, height } = canvas.getBoundingClientRect());
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * pixelRatio));
      canvas.height = Math.max(1, Math.round(height * pixelRatio));
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      if (width > 0 && height > 0) paint();
    };

    const animate = (timestamp: number) => {
      // 后台恢复时避免直接跳过一整段动画。
      elapsed.current += Math.min(timestamp - (lastTimestamp ?? timestamp), 40) / 1000;
      lastTimestamp = timestamp;
      if (width > 0 && height > 0) paint();
      frame = window.requestAnimationFrame(animate);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    if (!paused && !prefersReducedMotion) {
      frame = window.requestAnimationFrame(animate);
    }

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [paused, prefersReducedMotion, scene]);

  const playbackLabel = t(
    paused ? 'app:resume_workspace_animation' : 'app:pause_workspace_animation'
  );

  return (
    <Box
      position={'relative'}
      w={'full'}
      maxW={'760px'}
      h={{ base: 'clamp(240px, 62vw, 420px)', md: 'clamp(360px, 40vw, 560px)' }}
    >
      <Box as={'canvas'} ref={canvasRef} display={'block'} w={'full'} h={'full'} aria-hidden />
      {!prefersReducedMotion && (
        <IconButton
          position={'absolute'}
          right={2}
          bottom={2}
          variant={'transparentBase'}
          w={10}
          h={10}
          minW={10}
          borderRadius={'full'}
          color={'myGray.500'}
          aria-label={playbackLabel}
          title={playbackLabel}
          onClick={() => setPaused((previous) => !previous)}
          icon={
            paused ? (
              <Box
                borderBlock={'6px solid transparent'}
                borderLeft={'9px solid currentColor'}
                ml={'2px'}
                aria-hidden
              />
            ) : (
              <Box w={'9px'} h={'10px'} borderInline={'2px solid currentColor'} aria-hidden />
            )
          }
        />
      )}
    </Box>
  );
};

export default WorkspaceArtwork;
