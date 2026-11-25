import { useEffect } from "react";
import { SCALE_MODES, applyScale, autoLevels } from "../../viewer-scales.js";
import { maskAttribution } from "../../attribution.js";

export function useSpokeStudio() {
  useEffect(() => {
    "use strict";
    const $ = (id) => document.getElementById(id),
      canvas = $("view"),
      ctx = canvas.getContext("2d"),
      viewport = $("viewport");
    const mask = document.createElement("canvas"),
      mc = mask.getContext("2d", { willReadFrequently: true }),
      overlay = document.createElement("canvas"),
      oc = overlay.getContext("2d");
    let frames = [],
      images = [],
      adjusted = new Map(),
      index = 0,
      scale = 1,
      tx = 0,
      ty = 0,
      tool = "brush",
      dirty = false,
      busy = false,
      playing = false,
      timer = null,
      stroke = null,
      pan = null,
      points = [],
      undo = [],
      redo = [],
      first = true,
      saving = null,
      revision = 0,
      dataset = "default",
      generation = 0,
      projectName = "",
      projectList = [],
      dashboardVisible = true,
      activeUser = null;
    const controls = ["brightness", "contrast", "gamma", "black", "white"];
    for (const [value, label] of SCALE_MODES) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      $("scaleMode").append(option);
    }
    function status(t) {
      $("status").textContent = t;
    }
    function fail(e) {
      if (dashboardVisible) $("dashboardError").textContent = e.message;
      $("error").textContent = " · " + e.message;
      status("Save/load failed");
      console.error(e);
    }
    function showAttribution() {
      const f = frames[index];
      $("frameAttribution").textContent =
        f && f.image_attribution
          ? "Image uploaded by " +
            f.image_attribution.username +
            " (" +
            f.image_attribution.user_id.slice(0, 8) +
            ")"
          : "";
      const badge = $("maskAttribution"),
        description = maskAttribution(f, {
          visible: $("showMask").checked,
          dirty,
        });
      badge.hidden = description.hidden;
      badge.textContent = description.text;
      badge.title = description.title;
    }
    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Could not load " + url));
        im.src = url;
      });
    }
    function snapshot() {
      undo.push(mc.getImageData(0, 0, mask.width, mask.height));
      if (undo.length > 30) undo.shift();
      redo = [];
    }
    function changed() {
      revision++;
      dirty = true;
      status("Unsaved mask");
      draw();
    }
    function setTool(t) {
      if (stroke || pan) return;
      tool = t;
      points = [];
      for (const name of ["brush", "erase", "polygon"])
        $(name).classList.toggle("active", name === t);
      for (const name of ["brush", "erase", "polygon", "pointer", "pan"]) {
        const button = $("float_" + name);
        button.classList.toggle("active", name === t);
        button.setAttribute("aria-pressed", String(name === t));
      }
      $("brushRail").hidden = !["brush", "erase"].includes(t);
      $("pixelReadout").hidden = t !== "pointer";
      canvas.style.cursor =
        t === "pan" ? "grab" : t === "pointer" ? "default" : "crosshair";
      draw();
    }
    function zoomBy(factor, x = canvas.width / 2, y = canvas.height / 2) {
      if (!images[index]) return;
      const px = (x - tx) / scale,
        py = (y - ty) / scale;
      scale = Math.max(0.05, Math.min(20, scale * factor));
      tx = x - px * scale;
      ty = y - py * scale;
      draw();
    }
    function inspectPixel(p) {
      if (!images[index]) return;
      const x = Math.floor(p[0]),
        y = Math.floor(p[1]);
      if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) {
        $("pixelReadout").textContent = "Move over the image to inspect pixels";
        return;
      }
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const cc = c.getContext("2d");
      cc.drawImage(images[index], x, y, 1, 1, 0, 0, 1, 1);
      const rgba = cc.getImageData(0, 0, 1, 1).data;
      const label = mc.getImageData(x, y, 1, 1).data[0] > 0 ? 1 : 0;
      $("pixelReadout").textContent =
        "x " +
        x +
        " · y " +
        y +
        " · RGB " +
        Array.from(rgba.slice(0, 3)).join(", ") +
        " · mask " +
        label;
    }

    async function save() {
      if (saving) {
        await saving;
        if (dirty) return save();
        return;
      }
      if (!dirty) return;
      const at = index,
        version = revision;
      status("Saving…");
      const copy = document.createElement("canvas");
      copy.width = mask.width;
      copy.height = mask.height;
      copy.getContext("2d").drawImage(mask, 0, 0);
      saving = (async () => {
        const blob = await new Promise((resolve) =>
          copy.toBlob(resolve, "image/png"),
        );
        const r = await fetch("/mask/" + dataset + "/" + at, {
          method: "POST",
          body: blob,
        });
        if (!r.ok) throw new Error((await r.json()).error || "Save failed");
        frames[at].mask_attribution = (await r.json()).attribution;
        frames[at].saved = true;
        if (index === at && revision === version) {
          dirty = false;
          status("Mask saved");
        }
        showAttribution();
      })();
      try {
        await saving;
      } finally {
        saving = null;
      }
      if (dirty) return save();
    }

    function adjustedImage(i) {
      if (adjusted.has(i)) return adjusted.get(i);
      const im = images[i];
      if (!im) return null;
      const c = document.createElement("canvas");
      c.width = im.width;
      c.height = im.height;
      const cc = c.getContext("2d"),
        k = +$("contrast").value,
        g = +$("gamma").value,
        lo = +$("black").value,
        hi = Math.max(lo + 1, +$("white").value);
      cc.drawImage(im, 0, 0);
      const d = cc.getImageData(0, 0, c.width, c.height);
      applyScale(d.data, {
        mode: $("scaleMode").value,
        black: lo,
        white: hi,
        brightness: +$("brightness").value,
        contrast: k,
        gamma: g,
      });
      cc.putImageData(d, 0, 0);
      adjusted.set(i, c);
      return c;
    }
    function draw() {
      showAttribution();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!images[index]) return;
      ctx.setTransform(scale, 0, 0, scale, tx, ty);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(adjustedImage(index), 0, 0);
      const ref = index + +$("reference").value;
      if (
        +$("reference").value &&
        ref >= 0 &&
        ref < frames.length &&
        images[ref]
      ) {
        ctx.globalAlpha = +$("ghost").value;
        ctx.drawImage(adjustedImage(ref), 0, 0);
        ctx.globalAlpha = 1;
      }
      if ($("showMask").checked) {
        overlay.width = mask.width;
        overlay.height = mask.height;
        const d = mc.getImageData(0, 0, mask.width, mask.height);
        for (let j = 0; j < d.data.length; j += 4) {
          const on = d.data[j] > 0;
          d.data[j] = 64;
          d.data[j + 1] = 235;
          d.data[j + 2] = 205;
          d.data[j + 3] = on ? 255 : 0;
        }
        oc.putImageData(d, 0, 0);
        ctx.globalAlpha = +$("opacity").value;
        ctx.drawImage(overlay, 0, 0);
        ctx.globalAlpha = 1;
      }
      if (points.length) {
        ctx.beginPath();
        ctx.moveTo(...points[0]);
        for (const p of points.slice(1)) ctx.lineTo(...p);
        ctx.strokeStyle = "#ffda85";
        ctx.lineWidth = 2 / scale;
        ctx.stroke();
        for (const p of points) {
          ctx.fillStyle = "#ffda85";
          ctx.fillRect(
            p[0] - 3 / scale,
            p[1] - 3 / scale,
            6 / scale,
            6 / scale,
          );
        }
      }
    }
    function fit() {
      if (!images[index]) return;
      scale = Math.min(
        (canvas.width - 40) / images[index].width,
        (canvas.height - 40) / images[index].height,
      );
      tx = (canvas.width - images[index].width * scale) / 2;
      ty = (canvas.height - images[index].height * scale) / 2;
      draw();
    }
    function resize() {
      canvas.width = viewport.clientWidth;
      canvas.height = viewport.clientHeight;
      draw();
    }
    async function gotoFrame(n) {
      if (!frames.length) return;
      n = Math.max(0, Math.min(frames.length - 1, n));
      if (busy || stroke || pan || (n === index && !first)) return;
      busy = true;
      try {
        await save();
        const im =
          images[n] || (await loadImage("/frame/" + dataset + "/" + n));
        images[n] = im;
        const saved = await loadImage("/mask/" + dataset + "/" + n);
        index = n;
        mask.width = im.width;
        mask.height = im.height;
        mc.fillStyle = "#000";
        mc.fillRect(0, 0, mask.width, mask.height);
        mc.drawImage(saved, 0, 0);
        dirty = false;
        undo = [];
        redo = [];
        points = [];
        $("frameSelect").value = n;
        $("timeline").value = n;
        $("counter").textContent = n + 1 + " / " + frames.length;
        $("dimensions").textContent = im.width + " × " + im.height + " px";
        showAttribution();
        status(frames[n].saved ? "Saved mask" : "No mask saved");
        if (first) {
          first = false;
          fit();
        } else draw();
        const gen = generation;
        for (const j of [n - 1, n + 1])
          if (j >= 0 && j < frames.length && !images[j])
            loadImage("/frame/" + dataset + "/" + j)
              .then((x) => {
                if (gen === generation) {
                  images[j] = x;
                  draw();
                }
              })
              .catch(fail);
      } catch (e) {
        stop();
        fail(e);
      } finally {
        busy = false;
      }
    }
    function stop() {
      playing = false;
      clearInterval(timer);
      $("play").textContent = "▶ Play";
    }
    function togglePlay() {
      if (!frames.length || busy) return;
      if (playing) return stop();
      if (index === frames.length - 1) {
        gotoFrame(0);
      }
      playing = true;
      $("play").textContent = "Ⅱ Pause";
      timer = setInterval(
        () => {
          if (index === frames.length - 1) stop();
          else gotoFrame(index + 1);
        },
        1000 / +$("fps").value,
      );
    }
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return [
        (e.clientX - r.left - tx) / scale,
        (e.clientY - r.top - ty) / scale,
      ];
    }
    function paint(a, b) {
      mc.strokeStyle = tool === "erase" ? "#000" : "#fff";
      mc.fillStyle = mc.strokeStyle;
      mc.lineWidth = +$("size").value;
      mc.lineCap = "round";
      mc.beginPath();
      mc.moveTo(...a);
      mc.lineTo(...b);
      mc.stroke();
      mc.beginPath();
      mc.arc(b[0], b[1], mc.lineWidth / 2, 0, Math.PI * 2);
      mc.fill();
      changed();
    }
    canvas.oncontextmenu = (e) => e.preventDefault();
    canvas.onpointerdown = (e) => {
      if (busy) return;
      stop();
      canvas.setPointerCapture(e.pointerId);
      if (
        e.button === 1 ||
        e.button === 2 ||
        (e.button === 0 && tool === "pan")
      ) {
        canvas.style.cursor = "grabbing";
        pan = [e.clientX, e.clientY, tx, ty];
        return;
      }
      if (e.button !== 0) return;
      const p = pos(e);
      if (tool === "pointer") {
        inspectPixel(p);
        return;
      }
      if (p[0] < 0 || p[1] < 0 || p[0] >= mask.width || p[1] >= mask.height)
        return;
      if (tool === "polygon") {
        points.push(p);
        draw();
        return;
      }
      snapshot();
      stroke = p;
      paint(p, p);
    };
    canvas.onpointermove = (e) => {
      if (tool === "pointer" && !pan) inspectPixel(pos(e));
      if (pan) {
        tx = pan[2] + e.clientX - pan[0];
        ty = pan[3] + e.clientY - pan[1];
        draw();
      } else if (stroke) {
        const p = pos(e);
        paint(stroke, p);
        stroke = p;
      }
    };
    function endPointer() {
      const had = stroke;
      stroke = null;
      pan = null;
      canvas.style.cursor =
        tool === "pan" ? "grab" : tool === "pointer" ? "default" : "crosshair";
      if (had) save().catch(fail);
    }
    canvas.onpointerup = endPointer;
    canvas.onpointercancel = endPointer;
    canvas.onlostpointercapture = endPointer;
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        zoomBy(
          Math.exp(-e.deltaY * 0.001),
          e.clientX - r.left,
          e.clientY - r.top,
        );
      },
      { passive: false },
    );
    function fillPolygon() {
      if (points.length < 3 || busy) return;
      snapshot();
      mc.fillStyle = "#fff";
      mc.beginPath();
      mc.moveTo(...points[0]);
      for (const p of points.slice(1)) mc.lineTo(...p);
      mc.closePath();
      mc.fill();
      points = [];
      changed();
      save().catch(fail);
    }
    function history(back) {
      if (busy || stroke) return;
      const from = back ? undo : redo,
        to = back ? redo : undo;
      if (!from.length) return;
      to.push(mc.getImageData(0, 0, mask.width, mask.height));
      mc.putImageData(from.pop(), 0, 0);
      changed();
      save().catch(fail);
    }
    for (const name of ["brush", "erase", "polygon"])
      $(name).onclick = () => setTool(name);
    $("prev").onclick = () => {
      stop();
      gotoFrame(index - 1);
    };
    $("next").onclick = () => {
      stop();
      gotoFrame(index + 1);
    };
    $("play").onclick = togglePlay;
    $("fit").onclick = fit;
    $("save").onclick = () => save().catch(fail);
    $("undo").onclick = () => history(true);
    $("redo").onclick = () => history(false);
    $("frameSelect").onchange = (e) => {
      stop();
      gotoFrame(+e.target.value);
    };
    $("timeline").oninput = (e) => {
      stop();
      gotoFrame(+e.target.value);
    };
    for (const id of controls)
      $(id).oninput = () => {
        $(id + "Value").value = $(id).value;
        adjusted.clear();
        draw();
      };
    $("scaleMode").onchange = () => {
      adjusted.clear();
      draw();
    };
    $("size").oninput = () => {
      $("sizeValue").value = $("size").value + " px";
      $("floatSize").value = $("size").value;
      $("floatSizeValue").value = $("size").value;
    };
    $("floatSize").oninput = () => {
      $("size").value = $("floatSize").value;
      $("size").oninput();
    };
    for (const name of ["brush", "erase", "polygon", "pointer", "pan"])
      $("float_" + name).onclick = () => setTool(name);
    $("float_zoomIn").onclick = () => zoomBy(1.25);
    $("float_zoomOut").onclick = () => zoomBy(0.8);
    $("float_fit").onclick = fit;
    $("fps").oninput = () => {
      $("fpsValue").value = $("fps").value + " fps";
      if (playing) {
        stop();
        togglePlay();
      }
    };
    for (const id of ["opacity", "showMask", "reference", "ghost"])
      $(id).oninput = draw;
    function setAutomaticLevels(method) {
      if (!images[index]) return;
      const source = images[index],
        c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      const context = c.getContext("2d");
      context.drawImage(source, 0, 0);
      const data = context.getImageData(0, 0, c.width, c.height);
      const limits = autoLevels(data.data, method);
      for (const [id, value] of Object.entries(limits)) {
        $("" + id).value = value;
        $("" + id + "Value").value = value;
      }
      adjusted.clear();
      draw();
    }
    $("minmax").onclick = () => setAutomaticLevels("minmax");
    $("zscale").onclick = () => setAutomaticLevels("zscale");
    $("reset").onclick = () => {
      for (const [id, v] of Object.entries({
        brightness: 0,
        contrast: 1,
        gamma: 1,
        black: 0,
        white: 255,
      })) {
        $(id).value = v;
        $(id + "Value").value = v;
      }
      $("scaleMode").value = "linear";
      adjusted.clear();
      draw();
    };
    $("download").onclick = () => {
      if (!frames.length || busy) return;
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = mask.width;
      exportCanvas.height = mask.height;
      const ec = exportCanvas.getContext("2d"),
        d = mc.getImageData(0, 0, mask.width, mask.height);
      for (let j = 0; j < d.data.length; j += 4) {
        const v = d.data[j] > 0 ? 255 : 0;
        d.data[j] = d.data[j + 1] = d.data[j + 2] = v;
        d.data[j + 3] = 255;
      }
      ec.putImageData(d, 0, 0);
      exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob),
          a = document.createElement("a");
        a.href = url;
        a.download = frames[index].name.replace(".png", "_mask.png");
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    };
    document.addEventListener("keydown", (e) => {
      if (dashboardVisible) return;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (
        ["arrowleft", "arrowright", " ", "enter", "[", "]"].includes(k) ||
        ((e.ctrlKey || e.metaKey) && ["z", "s"].includes(k))
      )
        e.preventDefault();
      if (k === "arrowleft" || k === "arrowright") {
        stop();
        gotoFrame(index + (k === "arrowleft" ? -1 : 1));
      } else if (k === " " && !e.repeat) togglePlay();
      else if (k === "b") setTool("brush");
      else if (k === "e") setTool("erase");
      else if (k === "p") setTool("polygon");
      else if (k === "h") setTool("pan");
      else if (k === "v") setTool("pointer");
      else if (k === "+" || k === "=") {
        e.preventDefault();
        zoomBy(1.25);
      } else if (k === "-") {
        e.preventDefault();
        zoomBy(0.8);
      } else if (k === "m") {
        $("showMask").checked = !$("showMask").checked;
        draw();
      } else if (k === "f") fit();
      else if (k === "s") save().catch(fail);
      else if (k === "enter") fillPolygon();
      else if (k === "escape") {
        points = [];
        draw();
      } else if (k === "z" && (e.ctrlKey || e.metaKey)) history(!e.shiftKey);
      else if (k === "[" || k === "]") {
        $("size").value = Math.max(
          1,
          Math.min(100, +$("size").value + (k === "[" ? -1 : 1)),
        );
        $("size").oninput();
      }
    });
    window.addEventListener("beforeunload", (e) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
    new ResizeObserver(resize).observe(viewport);
    function installFrames(list, key) {
      generation++;
      dataset = key;
      frames = list;
      images = [];
      adjusted.clear();
      index = 0;
      first = true;
      undo = [];
      redo = [];
      points = [];
      dirty = false;
      mask.width = mask.height = 0;
      $("frameSelect").replaceChildren();
      $("timeline").max = Math.max(0, frames.length - 1);
      frames.forEach((f, i) => {
        const o = document.createElement("option");
        o.value = i;
        o.textContent = f.name;
        $("frameSelect").append(o);
      });
      $("error").textContent = "";
      showAttribution();
      resize();
    }
    async function preload() {
      const gen = generation,
        key = dataset,
        list = frames;
      for (let i = 0; i < list.length; i++) {
        if (gen !== generation) return;
        if (!images[i]) {
          const im = await loadImage("/frame/" + key + "/" + i);
          if (gen !== generation) return;
          images[i] = im;
        }
      }
      draw();
    }
    async function importImages(files) {
      const selected = Array.from(files)
        .filter((f) => f.name.toLowerCase().endsWith(".png"))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      if (!selected.length) {
        fail(new Error("No PNG images selected"));
        return;
      }
      if (
        new Set(selected.map((f) => f.name.toLowerCase())).size !==
        selected.length
      ) {
        fail(
          new Error(
            "Selected folders contain duplicate filenames. Choose one sequence.",
          ),
        );
        return;
      }
      if (busy || stroke || pan) return;
      stop();
      busy = true;
      generation++;
      $("importFolder").disabled = $("importFiles").disabled = true;
      try {
        await save();
        let r = await fetch("/api/import", {
          method: "POST",
          headers: frames.length ? {} : { "X-Project-Id": dataset },
        });
        if (!r.ok) throw new Error("Could not start import");
        const key = (await r.json()).id;
        for (let i = 0; i < selected.length; i++) {
          status("Importing " + (i + 1) + " / " + selected.length);
          r = await fetch("/import/" + key + "/image", {
            method: "POST",
            headers: {
              "X-Image-Name": encodeURIComponent(
                JSON.stringify(selected[i].name),
              ),
            },
            body: selected[i],
          });
          if (!r.ok) throw new Error((await r.json()).error || "Import failed");
        }
        r = await fetch("/import/" + key + "/finish", { method: "POST" });
        if (!r.ok) throw new Error((await r.json()).error || "Import failed");
        const result = await r.json();
        projectName = result.name || projectName;
        $("projectTitle").textContent = projectName;
        installFrames(result.frames, result.id);
        busy = false;
        await gotoFrame(0);
        preload().catch(fail);
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
        $("importFolder").disabled = $("importFiles").disabled = false;
        $("folderInput").value = $("filesInput").value = "";
      }
    }
    function maskTarget(name) {
      const lower = name.toLowerCase();
      let matches = frames
        .map((f, i) => (f.name.toLowerCase() === lower ? i : -1))
        .filter((i) => i >= 0);
      if (!matches.length) {
        const source = lower.replace(/_mask\.png$/, ".png");
        matches = frames
          .map((f, i) => (f.name.toLowerCase() === source ? i : -1))
          .filter((i) => i >= 0);
      }
      if (matches.length > 1)
        throw new Error("Ambiguous mask filename: " + name);
      return matches.length ? matches[0] : -1;
    }
    async function prepareMask(file, target) {
      const url = URL.createObjectURL(file);
      try {
        const im = await loadImage(url),
          frame = frames[target];
        if (im.width !== frame.width || im.height !== frame.height)
          throw new Error(
            file.name +
              ": dimensions " +
              im.width +
              " × " +
              im.height +
              " do not match " +
              frame.name +
              " (" +
              frame.width +
              " × " +
              frame.height +
              ")",
          );
        const c = document.createElement("canvas");
        c.width = im.width;
        c.height = im.height;
        const cc = c.getContext("2d", { willReadFrequently: true });
        cc.drawImage(im, 0, 0);
        const d = cc.getImageData(0, 0, c.width, c.height);
        for (let j = 0; j < d.data.length; j += 4) {
          const v =
            d.data[j + 3] > 0 &&
            (d.data[j] > 0 || d.data[j + 1] > 0 || d.data[j + 2] > 0)
              ? 255
              : 0;
          d.data[j] = d.data[j + 1] = d.data[j + 2] = v;
          d.data[j + 3] = 255;
        }
        cc.putImageData(d, 0, 0);
        return await new Promise((resolve) => c.toBlob(resolve, "image/png"));
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    async function importMasks(files) {
      if (busy || stroke || pan) return;
      if (!frames.length) {
        fail(new Error("Import images before importing masks"));
        return;
      }
      const selected = Array.from(files).filter((f) =>
        f.name.toLowerCase().endsWith(".png"),
      );
      if (!selected.length) return;
      stop();
      busy = true;
      $("importMasks").disabled = true;
      let applied = 0;
      try {
        const mappings = selected.map((file) => ({
          file,
          target: maskTarget(file.name),
        }));
        if (mappings.length === 1 && mappings[0].target < 0) {
          mappings[0].target = index;
          mappings[0].currentFallback = true;
        }
        const unmatched = mappings.filter((m) => m.target < 0);
        if (unmatched.length)
          throw new Error(
            "No image matches: " +
              unmatched.map((m) => m.file.name).join(", ") +
              ". Use image.png or image_mask.png filenames.",
          );
        if (new Set(mappings.map((m) => m.target)).size !== mappings.length)
          throw new Error(
            "Multiple masks match the same image. Select one mask per frame.",
          );
        const prepared = [];
        for (let i = 0; i < mappings.length; i++) {
          status("Checking mask " + (i + 1) + " / " + mappings.length);
          prepared.push({
            ...mappings[i],
            blob: await prepareMask(mappings[i].file, mappings[i].target),
          });
        }
        const existing = prepared.filter(
          (m) => frames[m.target].saved || (m.target === index && dirty),
        ).length;
        const fallback = prepared[0].currentFallback
          ? "Apply " +
            prepared[0].file.name +
            " to the current frame " +
            frames[index].name +
            "?\n"
          : "";
        if (
          !confirm(
            fallback +
              "Import " +
              prepared.length +
              " binary mask(s)?" +
              (existing
                ? "\nThis replaces " + existing + " existing mask(s)."
                : "") +
              "\nBlack/transparent pixels become background; nonzero visible pixels become spokes.",
          )
        )
          return;
        await save();
        for (const m of prepared) {
          status("Importing mask " + (applied + 1) + " / " + prepared.length);
          const r = await fetch("/mask/" + dataset + "/" + m.target, {
            method: "POST",
            body: m.blob,
          });
          if (!r.ok)
            throw new Error((await r.json()).error || "Mask import failed");
          frames[m.target].mask_attribution = (await r.json()).attribution;
          frames[m.target].saved = true;
          showAttribution();
          applied++;
        }
        if (prepared.some((m) => m.target === index)) {
          const im = await loadImage("/mask/" + dataset + "/" + index);
          mc.fillStyle = "#000";
          mc.fillRect(0, 0, mask.width, mask.height);
          mc.drawImage(im, 0, 0);
          undo = [];
          redo = [];
          points = [];
          dirty = false;
          draw();
        }
        $("error").textContent = "";
        status("Imported " + applied + " mask(s)");
      } catch (e) {
        fail(
          new Error(
            (applied ? applied + " mask(s) imported before error. " : "") +
              e.message,
          ),
        );
      } finally {
        busy = false;
        $("importMasks").disabled = false;
        $("masksInput").value = "";
        if (!applied && !$("error").textContent)
          status(dirty ? "Unsaved mask" : "Mask import cancelled");
      }
    }
    $("importMasks").onclick = () => {
      if (busy) return;
      if (!frames.length) {
        fail(new Error("Import images before importing masks"));
        return;
      }
      $("masksInput").click();
    };
    $("masksInput").onchange = (e) => importMasks(e.target.files);
    async function collectPngFiles(directory) {
      const files = [];
      for await (const entry of directory.values()) {
        if (entry.kind === "directory")
          files.push(...(await collectPngFiles(entry)));
        else if (
          entry.kind === "file" &&
          entry.name.toLowerCase().endsWith(".png")
        )
          files.push(await entry.getFile());
      }
      return files;
    }
    function fallbackFolderPicker() {
      const input = $("folderInput");
      if (!("webkitdirectory" in input)) {
        fail(
          new Error(
            "Folder selection is unavailable in this browser. Use Import images to select the PNGs inside your folder.",
          ),
        );
        return;
      }
      input.webkitdirectory = true;
      input.removeAttribute("accept");
      input.click();
    }
    $("importFolder").onclick = async () => {
      if (busy) return;
      if (typeof window.showDirectoryPicker !== "function") {
        fallbackFolderPicker();
        return;
      }
      try {
        const directory = await window.showDirectoryPicker({
          id: "spoke-images",
          mode: "read",
        });
        await importImages(await collectPngFiles(directory));
      } catch (e) {
        if (e.name === "AbortError") return;
        if (e.name === "SecurityError" || e.name === "NotAllowedError") {
          fallbackFolderPicker();
          return;
        }
        fail(e);
      }
    };
    $("importFiles").onclick = () => {
      if (!busy) $("filesInput").click();
    };
    $("folderInput").onchange = (e) => importImages(e.target.files);
    $("filesInput").onchange = (e) => importImages(e.target.files);
    function showScreen(dashboard) {
      dashboardVisible = dashboard;
      $("dashboard").hidden = !dashboard;
      $("editor").hidden = dashboard;
      for (const id of ["importFolder", "importFiles", "importMasks"])
        $(id).hidden = dashboard;
      $("projectsButton").hidden = dashboard;
      $("projectTitle").textContent = dashboard ? "Projects" : projectName;
      $("createButton").hidden = !dashboard;
      $("themePill").hidden = !dashboard;
      $("status").hidden = dashboard;
      status(dashboard ? "Projects saved locally" : "Import images to begin");
    }
    function renderProjects() {
      const grid = $("projectGrid");
      grid.replaceChildren();
      const search = $("projectSearch").value.toLowerCase();
      const visible = projectList.filter((p) =>
        p.name.toLowerCase().includes(search),
      );
      $("projectTotal").textContent =
        projectList.length + " project" + (projectList.length === 1 ? "" : "");
      if (!visible.length) {
        const empty = document.createElement("p");
        empty.textContent = search
          ? "No projects match your search."
          : "Create your first project to get started.";
        grid.append(empty);
      }
      for (const p of visible) {
        const shell = document.createElement("article");
        shell.className = "project-shell";
        const card = document.createElement("button");
        card.type = "button";
        card.className = "project-card";
        card.setAttribute(
          "aria-label",
          "Open " +
            p.name +
            ", " +
            p.annotated +
            " of " +
            p.count +
            " images have saved masks",
        );
        const head = document.createElement("span");
        head.className = "card-head";
        const title = document.createElement("span");
        title.className = "card-title";
        title.textContent = p.name;
        title.title = p.name;
        const counts = document.createElement("span");
        counts.className = "card-counts";
        const ratio = document.createElement("span");
        ratio.textContent = p.annotated + " / " + p.count;
        ratio.title = "Images with saved masks / total images";
        const stats = document.createElement("span");
        stats.className = "card-stats";
        for (const [icon, value, cls, label] of [
          ["✓", p.annotated, "saved-icon", "Saved masks"],
          [
            "−",
            Math.max(0, p.count - p.annotated),
            "pending-icon",
            "Images without masks",
          ],
        ]) {
          const item = document.createElement("span");
          item.title = label;
          const mark = document.createElement("span");
          mark.className = cls;
          mark.textContent = icon;
          mark.setAttribute("aria-hidden", "true");
          item.append(mark, document.createTextNode(" " + value));
          stats.append(item);
        }
        counts.append(ratio, stats);
        head.append(title, counts);
        const description = document.createElement("span");
        description.className = "card-description";
        description.textContent = p.count
          ? "Binary segmentation of a PNG image sequence."
          : "Ready for image import.";
        const foot = document.createElement("span");
        foot.className = "card-foot";
        const date = document.createElement("span");
        date.textContent =
          new Date(p.updated).toLocaleDateString(undefined, {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }) +
          ", " +
          new Date(p.updated).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
        date.title = "Last updated";
        const badge = document.createElement("span");
        badge.className = "sequence-icon";
        badge.textContent = "◉";
        badge.setAttribute("aria-hidden", "true");
        foot.append(date, badge);
        card.append(head, description, foot);
        card.onclick = () => openProject(p.id);
        const menu = document.createElement("details");
        menu.className = "project-menu";
        const trigger = document.createElement("summary");
        trigger.textContent = "⋯";
        trigger.setAttribute("aria-label", "Options for " + p.name);
        const actions = document.createElement("div");
        actions.className = "project-menu-items";
        for (const [label, action] of [
          ["Rename", "rename"],
          ["Delete", "delete"],
        ]) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          button.className = action === "delete" ? "delete-project" : "";
          button.onclick = () => {
            menu.open = false;
            editProject(p, action);
          };
          actions.append(button);
        }
        menu.append(trigger, actions);
        shell.append(card, menu);
        grid.append(shell);
      }
    }

    async function editProject(project, action) {
      if (busy) return;
      let name;
      if (action === "rename") {
        name = prompt("Rename project", project.name);
        if (name === null) return;
        name = name.trim();
        if (!name || name.length > 120) {
          $("dashboardError").textContent =
            "Enter a project name of 1–120 characters.";
          return;
        }
        if (name === project.name) return;
      } else if (
        !confirm(
          'Delete project "' +
            project.name +
            '" from the dashboard?\nIts cloud files will move to Recently Deleted for 30 days.',
        )
      )
        return;
      busy = true;
      try {
        const r = await fetch("/api/projects/" + project.id + "/" + action, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(action === "rename" ? { name } : {}),
        });
        if (!r.ok)
          throw new Error((await r.json()).error || "Project update failed");
        if (project.id === dataset) {
          if (action === "rename") projectName = name;
          else {
            generation++;
            frames = [];
            images = [];
            dirty = false;
            undo = [];
            redo = [];
            points = [];
          }
        }
        $("dashboardError").textContent = "";
        await refreshProjects();
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    }
    document.addEventListener("click", (e) => {
      for (const menu of document.querySelectorAll(".project-menu[open]"))
        if (!menu.contains(e.target)) menu.open = false;
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape")
        for (const menu of document.querySelectorAll(".project-menu[open]"))
          menu.open = false;
    });
    async function refreshProjects() {
      const r = await fetch("/api/projects");
      if (!r.ok) throw new Error("Could not load projects");
      projectList = await r.json();
      projectList.sort((a, b) => b.updated.localeCompare(a.updated));
      renderProjects();
    }
    async function showDashboard() {
      if (busy || stroke || pan) return;
      stop();
      busy = true;
      try {
        await save();
        generation++;
        await refreshProjects();
        showScreen(true);
        $("dashboardError").textContent = "";
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    }
    async function openProject(key) {
      if (busy || stroke || pan) return;
      stop();
      busy = true;
      try {
        await save();
        const r = await fetch("/api/projects/" + key);
        if (!r.ok) throw new Error("Could not open project");
        const project = await r.json();
        projectName = project.name;
        installFrames(project.frames, project.id);
        showScreen(false);
        busy = false;
        resize();
        if (frames.length) {
          await gotoFrame(0);
          preload().catch(fail);
        } else {
          draw();
          $("counter").textContent = "0 images";
          $("dimensions").textContent = "";
          status("Import a folder or PNG images into this project");
        }
      } catch (e) {
        fail(e);
      } finally {
        busy = false;
      }
    }
    $("projectsButton").onclick = showDashboard;
    $("projectSearch").oninput = renderProjects;
    $("createButton").onclick = () => {
      if (busy) return;
      $("createError").textContent = "";
      $("createDialog").showModal();
      $("newProjectName").focus();
    };
    $("cancelCreate").onclick = () => $("createDialog").close();
    $("createProject").onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      const name = $("newProjectName").value.trim();
      if (!name) return;
      busy = true;
      try {
        const r = await fetch("/api/projects", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name }),
        });
        const result = await r.json();
        if (!r.ok) throw new Error(result.error || "Could not create project");
        $("newProjectName").value = "";
        $("createDialog").close();
        busy = false;
        await openProject(result.id);
      } catch (error) {
        $("createError").textContent = error.message;
      } finally {
        busy = false;
      }
    };
    function showAuth(login) {
      $("loginForm").hidden = !login;
      $("signupForm").hidden = login;
      $("showLogin").classList.toggle("active", login);
      $("showSignup").classList.toggle("active", !login);
      $("authError").textContent = "";
    }
    $("showLogin").onclick = () => showAuth(true);
    $("showSignup").onclick = () => showAuth(false);
    const passwordEye =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z"/><circle cx="12" cy="12" r="2.5"/></svg>';
    const passwordEyeOff =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.6 6.1A11 11 0 0 1 12 6c6.5 0 10 6 10 6a18 18 0 0 1-2.2 2.8M6.2 6.2C3.4 8.1 2 12 2 12s3.5 6 10 6c1.8 0 3.4-.5 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>';
    for (const button of document.querySelectorAll("[data-password-toggle]")) {
      const input = $(button.dataset.passwordToggle);
      const update = () => {
        const visible = input.type === "text";
        button.innerHTML = visible ? passwordEyeOff : passwordEye;
        button.setAttribute(
          "aria-label",
          visible ? "Hide password" : "Show password",
        );
        button.setAttribute("aria-pressed", String(visible));
        button.title = visible ? "Hide password" : "Show password";
      };
      button.onclick = () => {
        input.type = input.type === "password" ? "text" : "password";
        update();
        input.focus({ preventScroll: true });
      };
      update();
    }
    function startAuthenticated(user) {
      activeUser = user;
      $("authScreen").hidden = true;
      $("userBadge").hidden = false;
      $("logoutButton").hidden = false;
      $("userBadge").textContent = user.username + " · " + user.id.slice(0, 8);
      refreshProjects().catch(fail);
    }
    async function login(event, url) {
      event.preventDefault();
      const button = event.target.querySelector("button[type=submit]");
      button.disabled = true;
      $("authError").textContent = "";
      try {
        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              Object.fromEntries(new FormData(event.target)),
            ),
          }),
          result = await r.json();
        if (!r.ok) throw new Error(result.error || "Authentication failed");
        startAuthenticated(result.user);
      } catch (error) {
        $("authError").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    }
    $("loginForm").onsubmit = (e) => login(e, "/api/login");
    $("signupForm").onsubmit = (e) => login(e, "/api/signup");
    $("logoutButton").onclick = async () => {
      if (busy) return;
      busy = true;
      try {
        await save();
        const r = await fetch("/api/auth/logout", { method: "POST" });
        if (!r.ok) throw new Error("Could not log out");
        location.reload();
      } catch (error) {
        fail(error);
      } finally {
        busy = false;
      }
    };
    async function initialize() {
      const r = await fetch("/api/auth"),
        result = await r.json();
      if (!r.ok) throw new Error("Could not initialize login");
      if (result.user) startAuthenticated(result.user);
      else {
        $("authScreen").hidden = false;
        $("signupEmail").focus();
      }
    }
    setTool("brush");
    showScreen(true);
    showAuth(false);
    initialize().catch((error) => ($("authError").textContent = error.message));
  }, []);
}
