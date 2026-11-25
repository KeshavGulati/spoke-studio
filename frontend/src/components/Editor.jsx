import React from "react";
import ToolIcon from "./ToolIcon.jsx";

const floatingTools = [
  ["brush", "Brush · B", true],
  ["erase", "Eraser · E", false],
  ["pointer", "Inspect pixels · V", false],
  ["pan", "Pan · H", false],
  ["zoomIn", "Zoom in · +", null],
  ["fit", "Fit image · F", null],
  ["zoomOut", "Zoom out · −", null],
  ["polygon", "Polygon · P", false],
];

function RangeControl({ id, label, output, ...props }) {
  return (
    <label>
      {label}{" "}
      {output !== undefined && <output id={`${id}Value`}>{output}</output>}
      <input id={id} type="range" {...props} />
    </label>
  );
}

export default function Editor() {
  return (
    <main id="editor" hidden>
      <aside>
        <h2>Annotate</h2>
        <div className="tools">
          <button id="brush" className="active">
            Brush · B
          </button>
          <button id="erase">Eraser · E</button>
          <button id="polygon">Polygon · P</button>
        </div>
        <RangeControl
          id="size"
          label="Brush diameter"
          output="12 px"
          min="1"
          max="100"
          defaultValue="12"
        />
        <div className="tools">
          <button id="undo">Undo</button>
          <button id="redo">Redo</button>
          <button id="save">Save · S</button>
        </div>
        <label>
          <input id="showMask" type="checkbox" defaultChecked /> Show mask · M
        </label>
        <RangeControl
          id="opacity"
          label="Mask opacity"
          min="0"
          max="1"
          step=".05"
          defaultValue=".45"
        />

        <h2>Image display</h2>
        <label>
          Scale
          <select id="scaleMode" aria-label="Image scale distribution" />
        </label>
        <RangeControl
          id="brightness"
          label="Brightness"
          output="0"
          min="-100"
          max="100"
          defaultValue="0"
        />
        <RangeControl
          id="contrast"
          label="Contrast"
          output="1"
          min=".1"
          max="5"
          step=".05"
          defaultValue="1"
        />
        <RangeControl
          id="gamma"
          label="Gamma"
          output="1"
          min=".2"
          max="4"
          step=".05"
          defaultValue="1"
        />
        <RangeControl
          id="black"
          label="Black level"
          output="0"
          min="0"
          max="254"
          defaultValue="0"
        />
        <RangeControl
          id="white"
          label="White level"
          output="255"
          min="1"
          max="255"
          defaultValue="255"
        />
        <h2>Automatic levels</h2>
        <div className="tools">
          <button id="minmax">Min / max</button>
          <button
            id="zscale"
            title="Compute robust display limits from the current frame"
          >
            ZScale
          </button>
        </div>
        <button id="reset">Reset display</button>

        <h2>Motion reference</h2>
        <select id="reference" defaultValue="0">
          <option value="0">No overlay</option>
          <option value="-1">Previous frame</option>
          <option value="1">Next frame</option>
        </select>
        <RangeControl
          id="ghost"
          label="Reference opacity"
          min="0"
          max="1"
          step=".05"
          defaultValue=".35"
        />
        <small>
          Overlay uses source pixel coordinates; frames are not registered.
        </small>
        <RangeControl
          id="fps"
          label="Playback speed"
          output="6 fps"
          min="1"
          max="20"
          defaultValue="6"
        />
      </aside>

      <section>
        <div className="toolbar">
          <button id="prev">← Previous</button>
          <button id="play">▶ Play</button>
          <button id="next">Next →</button>
          <select id="frameSelect" aria-label="Frame" />
          <button id="fit">Fit · F</button>
          <button id="download">Download mask</button>
          <span id="counter" />
        </div>
        <div id="viewport">
          <canvas id="view" />
          <span id="maskAttribution" role="status" aria-live="polite" hidden />
          <div className="floating-tools">
            <div id="brushRail" className="brush-rail">
              <span className="brush-dot large" aria-hidden="true" />
              <input
                id="floatSize"
                type="range"
                min="1"
                max="100"
                defaultValue="12"
                aria-label="Brush diameter in source pixels"
                title="Brush diameter"
              />
              <span className="brush-dot small" aria-hidden="true" />
              <output id="floatSizeValue">12</output>
            </div>
            <div
              className="tool-rail"
              role="toolbar"
              aria-label="Image annotation tools"
              aria-orientation="vertical"
            >
              {floatingTools.map(([name, label, pressed]) => (
                <button
                  type="button"
                  id={`float_${name}`}
                  key={name}
                  title={label}
                  aria-label={label}
                  aria-pressed={pressed === null ? undefined : pressed}
                  className={pressed ? "active" : undefined}
                >
                  <ToolIcon name={name} />
                </button>
              ))}
            </div>
          </div>
          <output id="pixelReadout" hidden />
        </div>
        <div className="toolbar">
          <input
            id="timeline"
            aria-label="Frame timeline"
            type="range"
            min="0"
            defaultValue="0"
          />
          <span id="dimensions" />
        </div>
        <footer>
          <kbd>← →</kbd> frames · <kbd>Space</kbd> playback · scroll to zoom ·
          middle/right drag to pan · <kbd>[ ]</kbd> brush size ·{" "}
          <kbd>Enter</kbd>
          fill polygon · <kbd>Esc</kbd> cancel · <kbd>Ctrl Z</kbd> undo
          <small id="frameAttribution" />
          <span id="error" />
        </footer>
      </section>
    </main>
  );
}
