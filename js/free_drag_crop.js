import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

// Utility: Safe parsing of Aspect Ratio
const parseRatio = (r) => {
    if (!r) return 1; if (typeof r === 'number') return r;
    try {
        const s = String(r).replace(/\//g, ":"), p = s.split(":");
        if (p.length === 2) {
            const n = parseFloat(p[0]), d = parseFloat(p[1]);
            return (n > 0 && d > 0) ? n / d : 1;
        }
        return parseFloat(s) || 1;
    } catch (e) { return 1; }
};


app.registerExtension({
    name: "FreeDragCrop.Antigravity",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "FreeDragCrop") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            onNodeCreated?.apply(this, arguments);
            const node = this;

            // 1. Properties & State
            node.properties = node.properties || {};
            node.properties.dragStart = node.properties.dragStart || [0, 0];
            node.properties.dragEnd = node.properties.dragEnd || [512, 512];
            node.properties.actualImageWidth = 512;
            node.properties.actualImageHeight = 512;

            node.image = new Image();
            node.imageLoaded = false;
            node.dragging = false;
            node.dragMode = null;
            node._isSyncing = false;
            node._lastRedraw = 0;

            // Ensure we don't add duplicate preview widgets
            const existing = node.widgets?.find(w => w.name === "crop_preview");
            if (existing) {
                const idx = node.widgets.indexOf(existing);
                node.widgets.splice(idx, 1);
            }

            node.image.onload = () => {
                // Properties actualImageWidth/Height already updated in onExecuted for accuracy
                const iw = node.properties.actualImageWidth || node.image.width || 1;
                const ih = node.properties.actualImageHeight || node.image.height || 1;
                const ow = node.properties.actualImageWidth, oh = node.properties.actualImageHeight;


                node.imageLoaded = true;
                node.properties.actualImageWidth = iw;
                node.properties.actualImageHeight = ih;

                // If resolution changed (new image connected), reset to full image
                if (ow !== iw || oh !== ih) {
                    node.applyAspectRatio("Full");
                }
                node.setDirtyCanvas(true);
            };


            // Double-buffering for image loading to prevent "No Image" flash
            node.imageLoader = new Image();
            node.imageLoader.onload = () => {
                node.image.src = node.imageLoader.src;
                // node.image.onload (above) will handle the swap and dirty canvas
            };


            // 2. Logic Methods
            node.syncWidgetsFromProperties = function () {
                if (this._isSyncing || !this.widgets || !this.properties.dragStart) return;
                this._isSyncing = true;
                try {
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                    const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                    const find = (n) => this.widgets.find(w => w.name === n);

                    const wl = find("crop_left"), wr = find("crop_right"), wt = find("crop_top"), wb = find("crop_bottom");
                    const ww = find("crop_current_width"), wh = find("crop_current_height");

                    if (wl) wl.value = Math.round(x1);
                    if (wr) wr.value = Math.round(iw - x2);
                    if (wt) wt.value = Math.round(y1);
                    if (wb) wb.value = Math.round(ih - y2);
                    if (ww) ww.value = Math.round(Math.abs(x2 - x1));
                    if (wh) wh.value = Math.round(Math.abs(y2 - y1));
                } finally {
                    this._isSyncing = false;
                }
            };

            node.syncPropertiesFromWidgets = function () {
                if (this._isSyncing || !this.widgets) return;
                const find = (n) => this.widgets.find(w => w.name === n);
                const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                const l = find("crop_left")?.value || 0, r = find("crop_right")?.value || 0;
                const t = find("crop_top")?.value || 0, b = find("crop_bottom")?.value || 0;
                this.properties.dragStart = [l, t];
                this.properties.dragEnd = [iw - r, ih - b];
                this.setDirtyCanvas(true);
            };

            node.applyAspectRatio = function (val) {
                if (!this.imageLoaded || this._isSyncing || !this.widgets) return;
                this._isSyncing = true;
                try {
                    const iw = this.image.width, ih = this.image.height;
                    const arWidget = this.widgets.find(w => w.name === "aspect_ratio");
                    if (val && val !== "Full" && arWidget) arWidget.value = val;

                    if (val === "Full") {
                        this.properties.dragStart = [0, 0];
                        this.properties.dragEnd = [iw, ih];
                    } else {
                        const ratio = parseRatio(val || arWidget?.value || "1:1");
                        let nw, nh;
                        if (iw / ih > ratio) { nh = ih * 0.8; nw = nh * ratio; } else { nw = iw * 0.8; nh = nw / ratio; }
                        const nx = (iw - nw) / 2, ny = (ih - nh) / 2;
                        this.properties.dragStart = [Math.round(nx), Math.round(ny)];
                        this.properties.dragEnd = [Math.round(nx + nw), Math.round(ny + nh)];
                    }

                    // Direct property sync
                    const find = (n) => this.widgets.find(w => w.name === n);
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                    const wl = find("crop_left"), wr = find("crop_right"), wt = find("crop_top"), wb = find("crop_bottom");
                    const ww = find("crop_current_width"), wh = find("crop_current_height");
                    if (wl) wl.value = Math.round(x1); if (wr) wr.value = Math.round(iw - x2);
                    if (wt) wt.value = Math.round(y1); if (wb) wb.value = Math.round(ih - y2);
                    if (ww) ww.value = Math.round(Math.abs(x2 - x1)); if (wh) wh.value = Math.round(Math.abs(y2 - y1));
                    this.setDirtyCanvas(true);
                } finally {
                    this._isSyncing = false;
                }
            };

            node.onWidgetChanged = function (name, val) {
                if (this._isSyncing || !this.widgets) return;
                const find = (n) => this.widgets.find(w => w.name === n);

                if (["crop_left", "crop_right", "crop_top", "crop_bottom"].includes(name)) {
                    this.syncPropertiesFromWidgets();
                } else if (name === "crop_current_width" || name === "crop_current_height") {
                    const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                    const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
                    let nw = name === "crop_current_width" ? val : Math.abs(x2 - x1);
                    let nh = name === "crop_current_height" ? val : Math.abs(y2 - y1);
                    if (find("ratio_lock")?.value) {
                        const r = parseRatio(find("aspect_ratio")?.value || "1:1");
                        if (name === "crop_current_width") nh = nw / r; else nw = nh * r;
                    }
                    this.properties.dragStart = [cx - nw / 2, cy - nh / 2];
                    this.properties.dragEnd = [cx + nw / 2, cy + nh / 2];
                    this.syncWidgetsFromProperties();
                    this.setDirtyCanvas(true);
                } else if (name === "aspect_ratio") {
                    const presetWidget = find("Ratio Presets");
                    if (presetWidget) {
                        const isKnown = presetWidget.options.values.includes(val);
                        if (presetWidget.value !== val) presetWidget.value = isKnown ? val : "Custom";
                    }
                    this.applyAspectRatio(val);
                } else if (name === "ratio_lock") {
                    if (val) this.applyAspectRatio();
                }
            };

            // 3. Mouse Interaction
            node.convertToImageSpace = function (pos) {
                if (!this.previewArea) return null;
                const p = this.previewArea;
                return [(pos[0] - p.x) / p.scale, (pos[1] - p.y) / p.scale];
            };

            node.getHitArea = function (imgPos) {
                const [x1, y1] = this.properties.dragStart, [x2, y2] = this.properties.dragEnd;
                const [ix, iy] = imgPos, threshold = 15 / (this.previewArea?.scale || 1);
                const nearL = Math.abs(ix - x1) < threshold, nearR = Math.abs(ix - x2) < threshold;
                const nearT = Math.abs(iy - y1) < threshold, nearB = Math.abs(iy - y2) < threshold;
                const inX = ix > Math.min(x1, x2) && ix < Math.max(x1, x2);
                const inY = iy > Math.min(y1, y2) && iy < Math.max(y1, y2);
                if (nearL && nearT) return "tl"; if (nearR && nearT) return "tr";
                if (nearL && nearB) return "bl"; if (nearR && nearB) return "br";
                if (nearT && inX) return "t"; if (nearB && inX) return "b";
                if (nearL && inY) return "l"; if (nearR && inY) return "r";
                if (inX && inY) return "move";
                return null;
            };

            node.onMouseDown = function (e, pos) {
                if (!this.imageLoaded) return false;
                const imgPos = this.convertToImageSpace(pos);
                if (!imgPos) return false;
                const hit = this.getHitArea(imgPos);
                if (hit) {
                    this.dragging = true; this.dragMode = hit; this.dragStartImg = imgPos;
                    this.origStart = [...this.properties.dragStart]; this.origEnd = [...this.properties.dragEnd];
                    return true;
                }
                return false;
            };

            node.onMouseMove = function (e, pos) {
                const imgPos = this.convertToImageSpace(pos);
                if (!this.dragging) {
                    // Only change cursor if mouse is over the interactive preview area
                    // and not panning (left/middle button NOT pressed)
                    if (imgPos && e.buttons === 0) {
                        const hit = this.getHitArea(imgPos);
                        if (hit) {
                            const cursors = {
                                move: "move",
                                tl: "nwse-resize", br: "nwse-resize", tr: "nesw-resize", bl: "nesw-resize",
                                t: "ns-resize", b: "ns-resize", l: "ew-resize", r: "ew-resize"
                            };
                            if (app.canvas.canvas.style.cursor !== cursors[hit]) {
                                app.canvas.canvas.style.cursor = cursors[hit];
                            }
                            // Don't return true on hover only - allow standard LiteGraph/ComfyUI events to pass
                        }
                    } else if (app.canvas.canvas.style.cursor !== "default") {
                        app.canvas.canvas.style.cursor = "default";
                    }
                    return false;
                }


                if (e.buttons === 0) { this.onMouseUp(e); return false; }
                if (!imgPos) return;

                const dx = imgPos[0] - this.dragStartImg[0], dy = imgPos[1] - this.dragStartImg[1];
                let [nx1, ny1] = [...this.origStart], [nx2, ny2] = [...this.origEnd];
                const iw = this.properties.actualImageWidth, ih = this.properties.actualImageHeight;
                const find = (n) => this.widgets?.find(w => w.name === n);
                const isLocked = find("ratio_lock")?.value;
                const ratio = isLocked ? parseRatio(find("aspect_ratio")?.value || "1:1") : 1;

                if (this.dragMode === "move") {
                    const w = nx2 - nx1, h = ny2 - ny1;
                    nx1 = Math.max(0, Math.min(iw - w, nx1 + dx));
                    ny1 = Math.max(0, Math.min(ih - h, ny1 + dy));
                    nx2 = nx1 + w; ny2 = ny1 + h;
                } else {
                    if (this.dragMode.includes("l")) nx1 += dx; if (this.dragMode.includes("r")) nx2 += dx;
                    if (this.dragMode.includes("t")) ny1 += dy; if (this.dragMode.includes("b")) ny2 += dy;
                    if (isLocked) {
                        let nw = nx2 - nx1, nh = ny2 - ny1;
                        if (this.dragMode === "l" || this.dragMode === "r") { nh = nw / ratio; ny2 = ny1 + nh; }
                        else if (this.dragMode === "t" || this.dragMode === "b") { nw = nh * ratio; nx2 = nx1 + nw; }
                        else {
                            if (Math.abs(dx) * ratio > Math.abs(dy)) { nh = nw / ratio; if (this.dragMode.includes("t")) ny1 = ny2 - nh; else ny2 = ny1 + nh; }
                            else { nw = nh * ratio; if (this.dragMode.includes("l")) nx1 = nx2 - nw; else nx2 = nx1 + nw; }
                        }
                        if (nx1 < 0) { const d = -nx1; nx1 = 0; if (this.dragMode.includes("t")) ny1 += d / ratio; else ny2 -= d / ratio; }
                        if (ny1 < 0) { const d = -ny1; ny1 = 0; if (this.dragMode.includes("l")) nx1 += d * ratio; else nx2 -= d * ratio; }
                        if (nx2 > iw) { const d = nx2 - iw; nx2 = iw; if (this.dragMode.includes("t")) ny1 += d / ratio; else ny2 -= d / ratio; }
                        if (ny2 > ih) { const d = ny2 - ih; ny2 = ih; if (this.dragMode.includes("l")) nx1 += d * ratio; else nx2 -= d * ratio; }
                    }
                }
                nx1 = Math.max(0, Math.min(iw - 1, nx1)); ny1 = Math.max(0, Math.min(ih - 1, ny1));
                nx2 = Math.max(nx1 + 1, Math.min(iw, nx2)); ny2 = Math.max(ny1 + 1, Math.min(ih, ny2));

                const newStart = [Math.round(nx1), Math.round(ny1)];
                const newEnd = [Math.round(nx2), Math.round(ny2)];

                if (newStart[0] !== this.properties.dragStart[0] ||
                    newStart[1] !== this.properties.dragStart[1] ||
                    newEnd[0] !== this.properties.dragEnd[0] ||
                    newEnd[1] !== this.properties.dragEnd[1]) {

                    this.properties.dragStart = newStart;
                    this.properties.dragEnd = newEnd;

                    // SILENT UPDATE: Don't sync widgets during drag to prevent high-frequency DOM/Flow updates
                    // The canvas will still redraw naturally through LiteGraph's interaction loop
                }
                return true;
            };



            node.onMouseUp = function (e) {
                if (this.dragging) {
                    this.dragging = false; this.dragMode = null;
                    app.canvas.canvas.style.cursor = "default";
                    // Only sync to widgets and trigger full redraw on release
                    this.syncWidgetsFromProperties();
                    this.setDirtyCanvas(true);
                    return true;
                }
                return false;
            };

            // Use ComfyUI's native preview mechanism (like SaveImage/PreviewImage)
            // Handle execution result
            node.onExecuted = function (message) {
                if (message?.images && message.images.length > 0) {
                    const img = message.images[0];
                    const url = api.apiURL(`/view?filename=${encodeURIComponent(img.filename)}&type=${img.type}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
                    this.backendUrl = url;

                    if (message.original_size) {
                        this.properties.actualImageWidth = message.original_size[0];
                        this.properties.actualImageHeight = message.original_size[1];
                    }

                    if (this.imageLoader.src !== url) {

                        // Cleanup old object URL if it existed (though here strictly api URLs)
                        this.imageLoader.src = url;
                    }
                }
            };



            node.onDrawBackground = function () {
                if (this.dragging) return;
                // No more auto-backtracking! 
                // Canvas only updates via onExecuted or Manual "Reload" button.
            };

            // 4. UI Setup
            node.addCustomWidget({
                type: "custom_canvas", name: "crop_preview",
                draw(ctx, node, width, y) {
                    try {
                        const margin = 10, drawW = width - margin * 2;
                        const drawH = Math.max(150, node.size[1] - y - margin * 2);
                        if (!isFinite(drawH) || drawH <= 0 || !isFinite(drawW) || drawW <= 0) return;

                        const startY = y + margin;
                        ctx.fillStyle = "#161616"; ctx.fillRect(margin, startY, drawW, drawH);

                        if (!node.imageLoaded || !node.image.width) {
                            ctx.fillStyle = "#666"; ctx.textAlign = "center";
                            ctx.fillText("Loading...", margin + drawW / 2, startY + drawH / 2);
                            return;
                        }

                        const imgAR = node.image.width / node.image.height;
                        const areaAR = drawW / drawH;
                        let pw, ph, px, py;

                        if (imgAR > areaAR) {
                            pw = drawW; ph = drawW / imgAR;
                            px = margin; py = startY + (drawH - ph) / 2;
                        } else {
                            ph = drawH; pw = drawH * imgAR;
                            px = margin + (drawW - pw) / 2; py = startY;
                        }

                        // Scale is based on the original image dimensions for accurate mapping
                        const originalW = node.properties.actualImageWidth || node.image.width || 1;
                        const scale = pw / originalW;

                        node.previewArea = { x: px, y: py, scale, width: pw, height: ph };

                        ctx.drawImage(node.image, px, py, pw, ph);
                        const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
                        const rx = px + x1 * scale, ry = py + y1 * scale, rw = (x2 - x1) * scale, rh = (y2 - y1) * scale;

                        ctx.save();
                        ctx.fillStyle = "rgba(0,0,0,0.6)";
                        ctx.beginPath();
                        ctx.rect(px, py, pw, ph);
                        ctx.rect(rx, ry, rw, rh);
                        ctx.fill("evenodd");
                        ctx.restore();

                        ctx.strokeStyle = "#0f0"; ctx.lineWidth = 2;
                        ctx.strokeRect(rx, ry, rw, rh);

                        // Center crosshair
                        ctx.strokeStyle = "rgba(255,255,255,0.5)";
                        ctx.beginPath();
                        ctx.moveTo(rx + rw / 2 - 10, ry + rh / 2); ctx.lineTo(rx + rw / 2 + 10, ry + rh / 2);
                        ctx.moveTo(rx + rw / 2, ry + rh / 2 - 10); ctx.lineTo(rx + rw / 2, ry + rh / 2 + 10);
                        ctx.stroke();

                        // Image Info Overlay (Pixel & Percentage)
                        const iw = node.image.width || 1, ih = node.image.height || 1;
                        const cw = Math.round(x2 - x1), ch = Math.round(y2 - y1);
                        const perW = Math.round((cw / iw) * 100), perH = Math.round((ch / ih) * 100);

                        ctx.save();
                        ctx.font = "bold 14px Arial"; ctx.textAlign = "center";

                        // Text Outline for readability without background box
                        ctx.strokeStyle = "black";
                        ctx.lineWidth = 3;
                        ctx.strokeText(`${perW} × ${perH} %`, px + pw / 2, py + ph / 2 + 5);
                        ctx.strokeText(`${cw} × ${ch} px`, px + pw / 2, py + ph / 2 + 22);

                        ctx.fillStyle = "#aaff00";
                        ctx.fillText(`${perW} × ${perH} %`, px + pw / 2, py + ph / 2 + 5);
                        ctx.fillText(`${cw} × ${ch} px`, px + pw / 2, py + ph / 2 + 22);
                        ctx.restore();
                    } catch (e) {
                        console.error("FreeDragCrop draw error:", e);
                    }
                },
                computeSize(width) { return [width, -1]; }
            });

            node.addWidget("combo", "Ratio Presets", "Custom", (v) => {
                if (v && v !== "Custom" && !node._isSyncing) {
                    const arWidget = node.widgets?.find(w => w.name === "aspect_ratio");
                    if (arWidget) { arWidget.value = v; node.applyAspectRatio(v); }
                }
            }, { values: ["1:1", "4:3", "3:4", "16:9", "9:16", "2:3", "3:2", "21:9", "Custom"] });
            const apIdx = node.widgets.findIndex(w => w.name === "aspect_ratio");
            if (apIdx !== -1) { const pWidget = node.widgets.pop(); node.widgets.splice(apIdx + 1, 0, pWidget); }

            node.addWidget("button", "Reset: Full Image", null, () => node.applyAspectRatio("Full"));
            node.addWidget("button", "Center Selection", null, () => {
                if (!node.imageLoaded) return;
                const iw = node.image.width, ih = node.image.height;
                const [x1, y1] = node.properties.dragStart, [x2, y2] = node.properties.dragEnd;
                const cw = x2 - x1, ch = y2 - y1;
                node.properties.dragStart = [(iw - cw) / 2, (ih - ch) / 2];
                node.properties.dragEnd = [node.properties.dragStart[0] + cw, node.properties.dragStart[1] + ch];
                node.syncWidgetsFromProperties(); node.setDirtyCanvas(true);
            });
            node.addWidget("button", "Apply Ratio & Center", null, () => node.applyAspectRatio());
            // Widget already added inside the custom function above - removing the redundant addCustomWidget(canvasWidget)

            node.size = [420, 910];
        };
    }
});
