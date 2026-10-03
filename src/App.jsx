
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Undo2, Redo2, Pen, Eraser, Highlighter,
  Hand, Minus, Plus, Maximize, RotateCcw
} from "lucide-react";
import "./App.css";

const COLORS = [
  "#FFFFFF", "#5795FF", "#FF8EAE",
  "#FFD166", "#65D6A3", "#C29AFF"
];

const MIN_ZOOM = 0.08;
const MAX_ZOOM = 12;

export default function App() {
  const canvasRef = useRef(null);
  const pathsRef = useRef([]);
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 });
  const drawingRef = useRef(null);
  const panRef = useRef(null);
  const spaceRef = useRef(false);
  const redoRef = useRef([]);
  const sizeRef = useRef({ width: 0, height: 0 });

  const [paths, setPaths] = useState([]);
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = useState("Pen");
  const [color, setColor] = useState("#FFFFFF");
  const [toolSizes, setToolSizes] = useState({
    Pen: 3,
    Eraser: 15,
    Highlighter: 8,
  });

  const [sizePopup, setSizePopup] = useState(null);

  const thickness = toolSizes[tool] ?? 3;

  const setThickness = (value) => {
    setToolSizes((prev) => ({
      ...prev,
      [tool]: typeof value === "function"
        ? value(prev[tool] ?? 3)
        : value,
    }));
  };
  const [isPanning, setIsPanning] = useState(false);

  const syncPaths = useCallback((next) => {
    pathsRef.current = next;
    setPaths(next);
  }, []);

  const syncView = useCallback((next) => {
    viewRef.current = next;
    setView(next);
  }, []);

  // Resize the canvas to fit the available screen
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.round(rect.width * dpr));
      const height = Math.max(1, Math.round(rect.height * dpr));

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        sizeRef.current = { width: rect.width, height: rect.height };
      }
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    return () => observer.disconnect();
  }, []);

  // Render all strokes at the current zoom and position
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const { x, y, zoom } = view;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Dark infinite workspace
    ctx.fillStyle = "#111216";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw subtle dots for spatial orientation
    const spacing = 40;
    const scaled = spacing * zoom;
    if (scaled >= 14) {
      const startX = ((x % scaled) + scaled) % scaled;
      const startY = ((y % scaled) + scaled) % scaled;

      ctx.fillStyle = "#292A32";
      for (let px = startX; px < canvas.width / dpr; px += scaled) {
        for (let py = startY; py < canvas.height / dpr; py += scaled) {
          ctx.beginPath();
          ctx.arc(px * dpr, py * dpr, 1 * dpr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Transform world coordinates to screen coordinates
    ctx.setTransform(
      dpr * zoom, 0, 0, dpr * zoom,
      dpr * x, dpr * y
    );

    paths.forEach((path) => {
      if (!path.points.length) return;

      ctx.beginPath();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = path.color;
      ctx.lineWidth = path.width;
      ctx.globalAlpha = path.tool === "Highlighter" ? 0.35 : 1;

      if (path.points.length === 1) {
        const p = path.points[0];
        ctx.arc(p.x, p.y, path.width / 2, 0, Math.PI * 2);
        ctx.fillStyle = path.color;
        ctx.fill();
      } else {
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      }
    });

    ctx.globalAlpha = 1;
  }, [paths, view]);

  // Spacebar enables temporary panning
  useEffect(() => {
    const down = (e) => {
      if (e.code === "Space" && !e.repeat &&
        !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName)) {
        e.preventDefault();
        spaceRef.current = true;
      }
    };
    const up = (e) => {
      if (e.code === "Space") spaceRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", up);
    };
  }, []);

  const localPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const worldPoint = (e) => {
    const p = localPoint(e);
    const v = viewRef.current;
    return {
      x: (p.x - v.x) / v.zoom,
      y: (p.y - v.y) / v.zoom
    };
  };

  const handlePointerDown = (e) => {
    if (e.button === 2) e.preventDefault();

    const pan = spaceRef.current || e.button === 1 || e.button === 2 ||
      tool === "Hand";

    e.currentTarget.setPointerCapture(e.pointerId);

    if (pan) {
      const p = localPoint(e);
      panRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        x: viewRef.current.x,
        y: viewRef.current.y
      };
      setIsPanning(true);
      return;
    }

    if (e.button !== 0) return;

    const p = worldPoint(e);
    const drawColor = tool === "Eraser" ? "#111216" : color;
    const width = thickness;

    const newPath = {
      tool,
      color: drawColor,
      width,
      points: [p]
    };

    drawingRef.current = true;
    redoRef.current = [];
    syncPaths([...pathsRef.current, newPath]);
  };

  const handlePointerMove = (e) => {
    if (panRef.current) {
      const pan = panRef.current;
      syncView({
        ...viewRef.current,
        x: pan.x + e.clientX - pan.pointerX,
        y: pan.y + e.clientY - pan.pointerY
      });
      return;
    }

    if (!drawingRef.current) return;

    const p = worldPoint(e);
    const existing = pathsRef.current;
    if (!existing.length) return;

    const next = [...existing];
    const last = next[next.length - 1];
    next[next.length - 1] = {
      ...last,
      points: [...last.points, p]
    };
    syncPaths(next);
  };

  const handlePointerUp = () => {
    drawingRef.current = false;
    panRef.current = null;
    setIsPanning(false);
  };

  // Zoom towards the cursor position
  const handleWheel = (e) => {
    e.preventDefault();

    const p = localPoint(e);
    const old = viewRef.current;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old.zoom * factor));

    const worldX = (p.x - old.x) / old.zoom;
    const worldY = (p.y - old.y) / old.zoom;

    syncView({
      zoom,
      x: p.x - worldX * zoom,
      y: p.y - worldY * zoom
    });
  };

  const undo = () => {
    const current = pathsRef.current;
    if (!current.length) return;
    redoRef.current = [...redoRef.current, current[current.length - 1]];
    syncPaths(current.slice(0, -1));
  };

  const redo = () => {
    const current = pathsRef.current;
    const redoStack = redoRef.current;
    if (!redoStack.length) return;
    const restored = redoStack[redoStack.length - 1];
    redoRef.current = redoStack.slice(0, -1);
    syncPaths([...current, restored]);
  };

  const changeZoom = (factor) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const p = { x: rect.width / 2, y: rect.height / 2 };
    const old = viewRef.current;
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, old.zoom * factor));
    const worldX = (p.x - old.x) / old.zoom;
    const worldY = (p.y - old.y) / old.zoom;

    syncView({
      zoom,
      x: p.x - worldX * zoom,
      y: p.y - worldY * zoom
    });
  };

  const resetView = () => syncView({ x: 0, y: 0, zoom: 1 });

  return (
    <div className="notee-app">
      <header className="drawing-toolbar">
        <div className="toolbar-group">
          <button className="tool-btn" onClick={undo} title="Undo">
            <Undo2 size={19} />
          </button>
          <button className="tool-btn" onClick={redo} title="Redo">
            <Redo2 size={19} />
          </button>
        </div>

        <div className="toolbar-divider" />
        <div className="toolbar-group">
          {[
            { name: "Pen", icon: Pen },
            { name: "Eraser", icon: Eraser },
            { name: "Highlighter", icon: Highlighter },
            { name: "Hand", icon: Hand },
          ].map(({ name, icon: Icon }) => (
            <button
              key={name}
              title={name}
              onClick={() => {
                setTool(name);
                if (name === "Hand") {
                  setSizePopup(null);
                } else {
                  setSizePopup((prev) => prev === name ? null : name);
                }
              }}
              className={`tool-btn ${tool === name ? "selected" : ""}`}
            >
              <Icon size={19} strokeWidth={1.8} />
            </button>
          ))}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group colors">
          {COLORS.map((c) => (
            <button
              key={c}
              title={c}
              onClick={() => {
                setColor(c);
                if (tool === "Eraser" || tool === "Hand") setTool("Pen");
              }}
              className={`color-btn ${color === c ? "color-selected" : ""}`}
              style={{ "--swatch": c }}
            />
          ))}
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group">
          <button
            className="tool-btn"
            title="Decrease pen size"
            onClick={() => setThickness((s) => Math.max(1, s - 1))}
          >
            <Minus size={15} />
          </button>
          <span className="stroke-label">{thickness}px</span>
          <button
            className="tool-btn"
            title="Increase pen size"
            onClick={() => setThickness((s) => Math.min(30, s + 1))}
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="toolbar-divider" />

        <div className="toolbar-group zoom-controls">
          <button className="tool-btn" onClick={() => changeZoom(1 / 1.25)} title="Zoom out">
            <Minus size={17} />
          </button>
          <span className="zoom-label">{Math.round(view.zoom * 100)}%</span>
          <button className="tool-btn" onClick={() => changeZoom(1.25)} title="Zoom in">
            <Plus size={17} />
          </button>
          <button className="tool-btn" onClick={resetView} title="Reset view">
            <RotateCcw size={17} />
          </button>
        </div>
      </header>

      {sizePopup && (
        <div className="size-popover">
          <div className="size-popover-header">
            <span>{sizePopup} Size</span>
            <span>{toolSizes[sizePopup]}px</span>
          </div>

          <input
            type="range"
            min="1"
            max="30"
            step="1"
            value={toolSizes[sizePopup]}
            onChange={(e) => {
              const value = Number(e.target.value);
              setToolSizes((prev) => ({
                ...prev,
                [sizePopup]: value,
              }));
            }}
            className="size-slider"
          />

          <div className="size-slider-labels">
            <span>1px</span>
            <span>30px</span>
          </div>

          <div className="brush-preview">
            <div
              className={`brush-dot ${sizePopup === "Highlighter" ? "highlighter-preview" : ""}`}
              style={{
                width: `${Math.min(toolSizes[sizePopup], 30)}px`,
                height: `${Math.min(toolSizes[sizePopup], 30)}px`,
              }}
            />
          </div>
        </div>
      )}

      <main className="canvas-wrapper">
        <canvas
          ref={canvasRef}
          className={`infinite-canvas ${isPanning || tool === "Hand" ? "panning" : ""}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onLostPointerCapture={handlePointerUp}
          onWheel={handleWheel}
          onContextMenu={(e) => e.preventDefault()}
        />
        {/* <div className="canvas-hint">
          Space + drag to move · Scroll to zoom
        </div> */}
      </main>
    </div>
  );
}